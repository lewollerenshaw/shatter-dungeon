/**
 * The real store and ad SDKs behind the gateway interfaces in native.ts.
 * Only loaded inside the native app (see index.ts), so the web build and the
 * tests never touch these plugins.
 */
import { AdMob, AdmobConsentStatus, RewardAdPluginEvents } from '@capacitor-community/admob';
import type { PluginListenerHandle } from '@capacitor/core';
import { PRODUCT_CATEGORY, Purchases, type PurchasesStoreProduct } from '@revenuecat/purchases-capacitor';
import type { AdGateway, StoreGateway } from './native';

/** RevenueCat: one SDK over StoreKit and Play Billing, with receipts checked on its servers. */
export function revenueCatStore(apiKey: string): StoreGateway {
  const products = new Map<string, PurchasesStoreProduct>();
  return {
    async init(productIds) {
      await Purchases.configure({ apiKey });
      const found = await Purchases.getProducts({ productIdentifiers: productIds, type: PRODUCT_CATEGORY.NON_SUBSCRIPTION });
      const prices: Record<string, string> = {};
      for (const p of found.products) {
        products.set(p.identifier, p);
        prices[p.identifier] = p.priceString;
      }
      return prices;
    },
    async buy(productId) {
      const product = products.get(productId);
      if (!product) throw new Error(`unknown product ${productId}`);
      try {
        await Purchases.purchaseStoreProduct({ product });
        return 'bought';
      } catch (err) {
        const e = err as { userCancelled?: boolean | null; code?: string | number } | null;
        // Backing out of the sheet is not an error.
        if (e?.userCancelled || String(e?.code) === '1') return 'cancelled';
        throw err;
      }
    },
  };
}

/** AdMob rewarded video. One ad unit serves every placement. */
export function adMobAds(adUnitId: string, testing: boolean): AdGateway {
  let asked = false;

  /** Consent and tracking prompts, once, the first time the player chooses to watch an ad. */
  async function askOnce(): Promise<void> {
    if (asked) return;
    asked = true;
    try {
      const consent = await AdMob.requestConsentInfo();
      if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) await AdMob.showConsentForm();
      const tracking = await AdMob.trackingAuthorizationStatus();
      if (tracking.status === 'notDetermined') await AdMob.requestTrackingAuthorization();
    } catch (err) {
      // Declined or unavailable prompts are not a reason to refuse the ad.
      console.warn('[platform] consent prompt failed', err);
    }
  }

  return {
    async init() {
      await AdMob.initialize({ initializeForTesting: testing });
    },
    async showRewarded() {
      await askOnce();
      const handles: PluginListenerHandle[] = [];
      let earned = false;
      try {
        // The reward and the close arrive as separate events, in that order.
        const closed = new Promise<boolean>((resolve) => {
          void (async () => {
            handles.push(
              await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
                earned = true;
              }),
              await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => resolve(earned)),
              await AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => resolve(false)),
            );
          })();
        });
        await AdMob.prepareRewardVideoAd({ adId: adUnitId, isTesting: testing });
        // Its own promise only settles when a reward is earned, so the outcome comes from the events.
        AdMob.showRewardVideoAd().catch(() => undefined);
        return await closed;
      } finally {
        for (const h of handles) void h.remove();
      }
    },
  };
}
