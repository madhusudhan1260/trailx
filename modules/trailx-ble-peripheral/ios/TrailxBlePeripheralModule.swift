import CoreBluetooth
import ExpoModulesCore

/// iOS counterpart of the Android GATT server. NOTE: written against the CoreBluetooth API but
/// not yet compiled or run on a device from this repository — see docs/TESTING.md.
public class TrailxBlePeripheralModule: Module {
  private let delegate = PeripheralDelegate()

  public func definition() -> ModuleDefinition {
    Name("TrailxBlePeripheral")

    Events("onWrite", "onSubscribers", "onAdvertising")

    OnCreate {
      self.delegate.emit = { [weak self] name, body in self?.sendEvent(name, body) }
    }

    AsyncFunction("isSupported") { () -> Bool in
      return true
    }

    AsyncFunction("start") { (serviceUuid: String, rxUuid: String, txUuid: String) in
      self.delegate.start(service: CBUUID(string: serviceUuid), rx: CBUUID(string: rxUuid), tx: CBUUID(string: txUuid))
    }

    AsyncFunction("stop") {
      self.delegate.stop()
    }

    AsyncFunction("notify") { (base64: String) -> Int in
      guard let data = Data(base64Encoded: base64) else { return 0 }
      return self.delegate.notify(data)
    }

    OnDestroy {
      self.delegate.stop()
    }
  }
}

final class PeripheralDelegate: NSObject, CBPeripheralManagerDelegate {
  var emit: ((String, [String: Any?]) -> Void)?
  private var manager: CBPeripheralManager?
  private var txCharacteristic: CBMutableCharacteristic?
  private var pending: (service: CBUUID, rx: CBUUID, tx: CBUUID)?
  private var subscriberCount = 0

  func start(service: CBUUID, rx: CBUUID, tx: CBUUID) {
    stop()
    pending = (service, rx, tx)
    manager = CBPeripheralManager(delegate: self, queue: nil)
  }

  func stop() {
    manager?.stopAdvertising()
    manager?.removeAllServices()
    manager = nil
    txCharacteristic = nil
    subscriberCount = 0
  }

  func notify(_ data: Data) -> Int {
    guard let m = manager, let tx = txCharacteristic, subscriberCount > 0 else { return 0 }
    return m.updateValue(data, for: tx, onSubscribedCentrals: nil) ? subscriberCount : 0
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    guard peripheral.state == .poweredOn, let p = pending else {
      if peripheral.state != .poweredOn && peripheral.state != .unknown && peripheral.state != .resetting {
        emit?("onAdvertising", ["advertising": false, "error": "Bluetooth is not available (state \(peripheral.state.rawValue))"])
      }
      return
    }
    let rx = CBMutableCharacteristic(type: p.rx, properties: [.write, .writeWithoutResponse], value: nil, permissions: [.writeable])
    let tx = CBMutableCharacteristic(type: p.tx, properties: [.notify], value: nil, permissions: [.readable])
    let service = CBMutableService(type: p.service, primary: true)
    service.characteristics = [rx, tx]
    txCharacteristic = tx
    peripheral.add(service)
    peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [p.service]])
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    emit?("onAdvertising", ["advertising": error == nil, "error": error?.localizedDescription])
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    for r in requests {
      if let v = r.value {
        emit?("onWrite", ["device": r.central.identifier.uuidString, "value": v.base64EncodedString()])
      }
    }
    if let first = requests.first { peripheral.respond(to: first, withResult: .success) }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
    subscriberCount += 1
    emit?("onSubscribers", ["count": subscriberCount])
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
    subscriberCount = max(0, subscriberCount - 1)
    emit?("onSubscribers", ["count": subscriberCount])
  }
}
