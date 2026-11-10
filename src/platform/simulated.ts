import type { Platform, PurchaseResult } from './platform';

/** How long the pretend rewarded ad runs. */
export const SIMULATED_AD_MS = 1600;

/** Stand-in store: every purchase succeeds and every ad pays out. No money moves. */
export class SimulatedPlatform implements Platform {
  readonly name = 'simulated';
  readonly simulated = true;

  purchase(productId: string): Promise<PurchaseResult> {
    console.info(`[simulated store] purchase ${productId}`);
    return new Promise((resolve) => setTimeout(() => resolve({ ok: true, productId }), 400));
  }

  showRewardedAd(placement: string): Promise<boolean> {
    console.info(`[simulated ads] rewarded ad: ${placement}`);
    return new Promise((resolve) => setTimeout(() => resolve(true), SIMULATED_AD_MS));
  }
}
