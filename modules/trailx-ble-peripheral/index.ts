import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export interface WriteEvent {
  device: string;
  /** base64 fragment */
  value: string;
}

interface NativePeripheral {
  isSupported(): Promise<boolean>;
  start(serviceUuid: string, rxUuid: string, txUuid: string): Promise<void>;
  stop(): Promise<void>;
  notify(base64: string): Promise<number>;
  addListener(event: 'onWrite', l: (e: WriteEvent) => void): EventSubscription;
  addListener(event: 'onSubscribers', l: (e: { count: number }) => void): EventSubscription;
  addListener(event: 'onAdvertising', l: (e: { advertising: boolean; error: string | null }) => void): EventSubscription;
}

/** Null on web, in Expo Go, or in any build that does not contain the native module. */
export const Peripheral = requireOptionalNativeModule<NativePeripheral>('TrailxBlePeripheral');
