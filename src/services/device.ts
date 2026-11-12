import * as Battery from 'expo-battery';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Network from 'expo-network';
import { Platform } from 'react-native';
import { useApp } from '@/store';
import { notifyNow } from './notify';

let started = false;
let warnedLow = false;

/** Battery, connectivity and compass monitors. All values shown in the UI come from these real readings. */
export async function startDeviceMonitors() {
  if (started) return;
  started = true;
  const { set } = useApp.getState();

  // ---- battery
  try {
    if (await Battery.isAvailableAsync()) {
      const p = await Battery.getPowerStateAsync();
      set({ battery: p.batteryLevel >= 0 ? p.batteryLevel : null, charging: p.batteryState === Battery.BatteryState.CHARGING || p.batteryState === Battery.BatteryState.FULL, lowPowerMode: !!p.lowPowerMode });
      Battery.addBatteryLevelListener(({ batteryLevel }) => {
        set({ battery: batteryLevel >= 0 ? batteryLevel : null });
        checkLowBattery();
      });
      Battery.addBatteryStateListener(({ batteryState }) => set({ charging: batteryState === Battery.BatteryState.CHARGING || batteryState === Battery.BatteryState.FULL }));
      Battery.addLowPowerModeListener(({ lowPowerMode }) => set({ lowPowerMode }));
      // Level listeners are throttled by the OS; poll occasionally so the figure never goes stale.
      setInterval(async () => {
        const lvl = await Battery.getBatteryLevelAsync().catch(() => -1);
        if (lvl >= 0) set({ battery: lvl });
        checkLowBattery();
      }, 120_000);
    }
  } catch {
    set({ battery: null });
  }

  // ---- connectivity
  try {
    const n = await Network.getNetworkStateAsync();
    set({ online: n.isInternetReachable ?? n.isConnected ?? null });
    Network.addNetworkStateListener((e) => set({ online: e.isInternetReachable ?? e.isConnected ?? null }));
  } catch {
    set({ online: null });
  }
}

function checkLowBattery() {
  const s = useApp.getState();
  const threshold = s.user?.settings.lowBatteryWarn ?? 0.2;
  if (s.battery == null) return;
  if (s.battery > threshold + 0.05) warnedLow = false;
  if (s.trek && !s.charging && s.battery <= threshold && !warnedLow) {
    warnedLow = true;
    void notifyNow('Battery low', `${Math.round(s.battery * 100)}% left. Consider heading back or switching to battery-saver tracking. Recording continues.`);
  }
}

// ---- compass ---------------------------------------------------------------------------------

let headingSub: Location.LocationSubscription | null = null;
let headingUsers = 0;

/** Reference-counted: the magnetometer only runs while a screen that shows a compass is mounted. */
export async function retainCompass(): Promise<() => void> {
  headingUsers++;
  // expo-location has no compass on web (it only logs a warning), and registering one there used to
  // consume a watcher id that broke position updates. Report it honestly as unavailable instead.
  if (Platform.OS === 'web') {
    useApp.getState().set({ compassAvailable: false });
    return () => { headingUsers = Math.max(0, headingUsers - 1); };
  }
  if (!headingSub) {
    try {
      headingSub = await Location.watchHeadingAsync((h) => {
        if (h.magHeading == null || Number.isNaN(h.magHeading) || h.magHeading < 0) return;
        useApp.getState().set({ heading: { mag: h.magHeading, true: h.trueHeading != null && h.trueHeading >= 0 ? h.trueHeading : null, accuracy: h.accuracy ?? 0 }, compassAvailable: true });
      });
      // If no reading arrives shortly, the device has no usable magnetometer (or it is blocked).
      setTimeout(() => {
        if (useApp.getState().heading == null) useApp.getState().set({ compassAvailable: false });
      }, 3000);
    } catch {
      useApp.getState().set({ compassAvailable: false });
    }
  }
  return () => {
    headingUsers = Math.max(0, headingUsers - 1);
    if (headingUsers === 0) {
      headingSub?.remove();
      headingSub = null;
    }
  };
}

// ---- haptics ---------------------------------------------------------------------------------

type Tap = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';
export function haptic(kind: Tap = 'light') {
  if (Platform.OS === 'web' || useApp.getState().user?.settings.haptics === false) return;
  const run =
    kind === 'success' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    : kind === 'warning' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    : kind === 'error' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    : Haptics.impactAsync(kind === 'heavy' ? Haptics.ImpactFeedbackStyle.Heavy : kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  run.catch(() => undefined);
}
