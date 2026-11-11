import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getDb } from '@/db';
import { updatePlan, type SafetyPlan } from '@/db/repo';

/** Local notifications only — they are scheduled on the device and fire with no network. */

let configured = false;
export async function configureNotifications() {
  if (configured || Platform.OS === 'web') return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('safety', {
      name: 'Safety alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400],
      lightColor: '#FF6A1F',
    });
  }
}

export async function notificationsAllowed(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  return (await Notifications.getPermissionsAsync()).granted;
}

export async function requestNotifications(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  await configureNotifications();
  return (await Notifications.requestPermissionsAsync()).granted;
}

export async function scheduleOverdueNotification(plan: SafetyPlan): Promise<void> {
  if (Platform.OS === 'web' || !plan.expectedReturnAt || plan.expectedReturnAt <= Date.now()) return;
  if (!(await notificationsAllowed())) return;
  await configureNotifications();
  if (plan.notificationId) await Notifications.cancelScheduledNotificationAsync(plan.notificationId).catch(() => undefined);
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'You are past your expected return time',
      body: 'Open TRAILX to check in or to prepare an emergency message. Your contacts have NOT been notified.',
      sound: true,
      data: { kind: 'overdue' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(plan.expectedReturnAt), channelId: 'safety' },
  });
  await updatePlan(await getDb(), plan.id, { notificationId: id });
}

export async function cancelOverdueNotification(plan: SafetyPlan): Promise<void> {
  if (Platform.OS === 'web' || !plan.notificationId) return;
  await Notifications.cancelScheduledNotificationAsync(plan.notificationId).catch(() => undefined);
}

export async function notifyNow(title: string, body: string): Promise<void> {
  if (Platform.OS === 'web' || !(await notificationsAllowed())) return;
  await configureNotifications();
  await Notifications.scheduleNotificationAsync({ content: { title, body, sound: true }, trigger: Platform.OS === 'android' ? { channelId: 'safety' } : null });
}
