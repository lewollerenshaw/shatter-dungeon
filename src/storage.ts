/**
 * In the native app the save is also kept in the device's own key-value
 * store. A web view's localStorage can be cleared by the system when storage
 * runs low, and the save now holds things people paid for.
 */
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/** Before the save is loaded: if localStorage has lost it, bring it back from the device store. */
export async function restoreFromDevice(key: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (localStorage.getItem(key) !== null) return;
    const { value } = await Preferences.get({ key });
    if (value !== null) localStorage.setItem(key, value);
  } catch (err) {
    console.warn('[storage] could not read the device copy of the save', err);
  }
}

/** After every save: copy it to the device store. Fire and forget. */
export function mirrorToDevice(key: string, value: string): void {
  if (!Capacitor.isNativePlatform()) return;
  Preferences.set({ key, value }).catch((err: unknown) => console.warn('[storage] could not write the device copy of the save', err));
}
