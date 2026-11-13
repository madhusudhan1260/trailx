package expo.modules.trailxbleperipheral

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

/**
 * Makes this phone discoverable to other TRAILX devices and accepts their writes.
 *
 *  - RX characteristic (write): peers write message fragments here.
 *  - TX characteristic (notify): this device pushes fragments (acknowledgements) to subscribed peers.
 *
 * All protocol logic (encryption, duplicate detection, hop limits) lives in TypeScript; this
 * module is only the radio.
 */
@SuppressLint("MissingPermission") // runtime permissions are requested from JS before start()
class TrailxBlePeripheralModule : Module() {
  private var server: BluetoothGattServer? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var advertiseCallback: AdvertiseCallback? = null
  private var txCharacteristic: BluetoothGattCharacteristic? = null
  private val subscribers = LinkedHashMap<String, BluetoothDevice>()

  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "React context is not available", null)

  private fun manager(): BluetoothManager? = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager

  override fun definition() = ModuleDefinition {
    Name("TrailxBlePeripheral")

    Events("onWrite", "onSubscribers", "onAdvertising")

    AsyncFunction("isSupported") {
      val adapter = manager()?.adapter
      adapter != null && adapter.isEnabled && adapter.isMultipleAdvertisementSupported
    }

    AsyncFunction("start") { serviceUuid: String, rxUuid: String, txUuid: String ->
      stopInternal()
      val mgr = manager() ?: throw CodedException("ERR_BLE_UNAVAILABLE", "Bluetooth is not available on this device", null)
      val adapter = mgr.adapter ?: throw CodedException("ERR_BLE_UNAVAILABLE", "Bluetooth is not available on this device", null)
      if (!adapter.isEnabled) throw CodedException("ERR_BLE_OFF", "Bluetooth is switched off", null)
      val adv = adapter.bluetoothLeAdvertiser ?: throw CodedException("ERR_BLE_NO_ADVERTISER", "This device cannot act as a BLE peripheral", null)

      val service = BluetoothGattService(UUID.fromString(serviceUuid), BluetoothGattService.SERVICE_TYPE_PRIMARY)
      val rx = BluetoothGattCharacteristic(
        UUID.fromString(rxUuid),
        BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
        BluetoothGattCharacteristic.PERMISSION_WRITE
      )
      val tx = BluetoothGattCharacteristic(
        UUID.fromString(txUuid),
        BluetoothGattCharacteristic.PROPERTY_NOTIFY,
        BluetoothGattCharacteristic.PERMISSION_READ
      )
      tx.addDescriptor(BluetoothGattDescriptor(CCCD, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
      service.addCharacteristic(rx)
      service.addCharacteristic(tx)

      val gatt = mgr.openGattServer(context, serverCallback) ?: throw CodedException("ERR_BLE_SERVER", "Could not open a GATT server", null)
      gatt.addService(service)
      server = gatt
      txCharacteristic = tx

      val settings = AdvertiseSettings.Builder()
        .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_POWER) // battery-conscious
        .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
        .setConnectable(true)
        .setTimeout(0)
        .build()
      val data = AdvertiseData.Builder()
        .setIncludeDeviceName(false) // never broadcast the owner's device name
        .addServiceUuid(ParcelUuid(UUID.fromString(serviceUuid)))
        .build()
      val cb = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
          sendEvent("onAdvertising", mapOf("advertising" to true, "error" to null))
        }
        override fun onStartFailure(errorCode: Int) {
          sendEvent("onAdvertising", mapOf("advertising" to false, "error" to "Advertising failed (code $errorCode)"))
        }
      }
      advertiseCallback = cb
      advertiser = adv
      adv.startAdvertising(settings, data, cb)
    }

    AsyncFunction("stop") { stopInternal() }

    /** Sends one fragment to every subscribed peer. Returns how many peers it was queued for. */
    AsyncFunction("notify") { base64: String ->
      val gatt = server ?: return@AsyncFunction 0
      val ch = txCharacteristic ?: return@AsyncFunction 0
      val value = Base64.decode(base64, Base64.NO_WRAP)
      var count = 0
      for (device in subscribers.values.toList()) {
        val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          gatt.notifyCharacteristicChanged(device, ch, false, value) == android.bluetooth.BluetoothStatusCodes.SUCCESS
        } else {
          @Suppress("DEPRECATION")
          ch.value = value
          @Suppress("DEPRECATION")
          gatt.notifyCharacteristicChanged(device, ch, false)
        }
        if (ok) count++
      }
      count
    }

    OnDestroy { stopInternal() }
  }

  private fun stopInternal() {
    try {
      advertiseCallback?.let { advertiser?.stopAdvertising(it) }
    } catch (_: Throwable) {
    }
    advertiseCallback = null
    advertiser = null
    try {
      server?.close()
    } catch (_: Throwable) {
    }
    server = null
    txCharacteristic = null
    subscribers.clear()
  }

  private val serverCallback = object : BluetoothGattServerCallback() {
    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        if (subscribers.remove(device.address) != null) sendEvent("onSubscribers", mapOf("count" to subscribers.size))
      }
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
      preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
    ) {
      if (value != null && !preparedWrite) {
        sendEvent("onWrite", mapOf("device" to device.address, "value" to Base64.encodeToString(value, Base64.NO_WRAP)))
      }
      if (responseNeeded) {
        val status = if (preparedWrite) BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED else BluetoothGatt.GATT_SUCCESS
        server?.sendResponse(device, requestId, status, offset, null)
      }
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor,
      preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
    ) {
      if (descriptor.uuid == CCCD && value != null) {
        if (value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) subscribers[device.address] = device
        else subscribers.remove(device.address)
        sendEvent("onSubscribers", mapOf("count" to subscribers.size))
      }
      if (responseNeeded) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
    }

    override fun onDescriptorReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, descriptor: BluetoothGattDescriptor) {
      val v = if (subscribers.containsKey(device.address)) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE else BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
      server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, v)
    }
  }
}
