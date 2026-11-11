import type { RawFix } from '@/core/types';

/**
 * Optional integration layer for EXTERNAL satellite communicators.
 *
 * Important facts this layer is built around:
 *  - A phone's GPS chip only RECEIVES signals. It cannot transmit to satellites.
 *  - Phone-native satellite SOS (where a handset supports it) is operated by the OS vendor and
 *    exposes no public API to third-party apps, so TRAILX cannot trigger it.
 *  - Dedicated communicators (inReach, ZOLEO, SPOT, …) can only be driven through their
 *    manufacturers' SDKs or documented protocols, each under its own licence and subscription.
 *
 * TRAILX therefore ships with NO provider registered. An adapter for a specific device implements
 * `SatelliteProvider` against that manufacturer's SDK and registers itself here; the SOS flow then
 * offers it as a channel. Until then the app reports, truthfully, that no satellite link exists.
 */

export interface SatelliteSendResult {
  /** The device accepted the message for transmission. */
  accepted: boolean;
  /** Only true if the manufacturer's service reports the message reached the network. */
  confirmed: boolean;
  reference?: string;
  error?: string;
}

export interface SatelliteProvider {
  readonly id: string;
  readonly displayName: string;
  /** Whether a paired, powered communicator is reachable right now. */
  isReady(): Promise<boolean>;
  /** Human-readable link state, e.g. "Paired · no sky view". */
  status(): Promise<string>;
  /** Maximum characters the device can carry in one message. */
  readonly maxMessageLength: number;
  send(message: string, position: RawFix | null): Promise<SatelliteSendResult>;
}

const providers = new Map<string, SatelliteProvider>();

export function registerSatelliteProvider(p: SatelliteProvider) {
  providers.set(p.id, p);
}

export function satelliteProviders(): SatelliteProvider[] {
  return [...providers.values()];
}

export async function readySatelliteProvider(): Promise<SatelliteProvider | null> {
  for (const p of providers.values()) if (await p.isReady().catch(() => false)) return p;
  return null;
}
