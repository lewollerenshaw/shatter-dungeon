import { Capacitor } from '@capacitor/core';
import { PRODUCTS } from '../sim/store';
import { NativePlatform } from './native';
import type { Platform } from './platform';
import { SimulatedPlatform } from './simulated';

/**
 * Google's public sample ad units. They only ever serve test ads, so a build
 * without your own ids cannot earn money or break AdMob's rules by accident.
 */
const TEST_REWARDED: Record<string, string> = {
  ios: 'ca-app-pub-3940256099942544/1712485313',
  android: 'ca-app-pub-3940256099942544/5224354917',
};

/**
 * Pick the platform for where the game is running.
 *
 * - In a browser: the simulated store and ads.
 * - In the native app: RevenueCat and AdMob, configured from .env (see
 *   .env.example). Without a RevenueCat key purchases are simply off.
 * - In the native app with VITE_SIMULATE_STORE=1: the simulated platform, for
 *   trying the app on a device before the store accounts exist. Never ship that.
 */
export async function createPlatform(): Promise<Platform> {
  const env = import.meta.env;
  if (!Capacitor.isNativePlatform() || env.VITE_SIMULATE_STORE === '1') return new SimulatedPlatform();

  const os = Capacitor.getPlatform();
  const { adMobAds, revenueCatStore } = await import('./gateways');
  const storeKey = (os === 'ios' ? env.VITE_RC_IOS_KEY : env.VITE_RC_ANDROID_KEY) as string | undefined;
  const adUnit = (os === 'ios' ? env.VITE_ADMOB_REWARDED_IOS : env.VITE_ADMOB_REWARDED_ANDROID) as string | undefined;
  return new NativePlatform(
    storeKey ? revenueCatStore(storeKey) : null,
    adMobAds(adUnit || TEST_REWARDED[os], !adUnit),
    PRODUCTS.map((p) => p.id),
  );
}
