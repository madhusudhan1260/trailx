import { getDb } from '@/db';
import { getUser, saveUser, type User } from '@/db/repo';
import { useApp } from '@/store';
import { startDeviceMonitors } from './device';
import { configureNotifications } from './notify';
import { checkOverdue, resumePendingBle } from './sos';
import { hookAppState, restoreTracking } from './tracking';

let booting: Promise<void> | null = null;

/** One-time startup: open the database, restore any trek in progress, start device monitors. */
export function boot(): Promise<void> {
  if (!booting) {
    booting = (async () => {
      const db = await getDb();
      useApp.getState().set({ user: await getUser(db) });
      await configureNotifications();
      await restoreTracking();
      hookAppState();
      void startDeviceMonitors();
      void resumePendingBle().catch(() => undefined);
      setInterval(() => void checkOverdue().catch(() => undefined), 30_000);
      useApp.getState().set({ ready: true });
    })();
    booting.catch(() => (booting = null));
  }
  return booting;
}

export async function updateUser(patch: Partial<User>): Promise<void> {
  const cur = useApp.getState().user;
  if (!cur) return;
  const next = { ...cur, ...patch, settings: { ...cur.settings, ...(patch.settings ?? {}) } };
  await saveUser(await getDb(), next);
  useApp.getState().set({ user: next });
}
