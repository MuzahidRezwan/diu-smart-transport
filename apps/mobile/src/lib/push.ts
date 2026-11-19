import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Asks for permission once and registers this device for notices and bus updates. */
export async function registerForPush(): Promise<void> {
  if (!Device.isDevice) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Bus updates', importance: Notifications.AndroidImportance.HIGH });
  }
  const { status } = await Notifications.getPermissionsAsync();
  const granted = status === 'granted' || (await Notifications.requestPermissionsAsync()).status === 'granted';
  if (!granted) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await api('/me/devices', { body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
}
