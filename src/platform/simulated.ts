import type { Platform, PurchaseResult } from './platform';

/** How long the pretend rewarded ad runs. */
export const SIMULATED_AD_MS = 1600;

/** Pretend prices, in the shape a real store would return them. */
const PRICES: Record<string, string> = {
  starter_pack: '$2.99',
  gems_small: '$0.99',
  gems_medium: '$4.99',
  gems_large: '$9.99',
  battle_pass: '$4.99',
};

/** Stand-in store: every purchase succeeds and every ad pays out. No money moves. */
export class SimulatedPlatform implements Platform {
  readonly name = 'simulated';
  readonly simulated = true;
  readonly adsAvailable = true;

  ready(): Promise<void> {
    return Promise.resolve();
  }

  price(productId: string): string {
    return PRICES[productId] ?? '';
  }

  purchase(productId: string): Promise<PurchaseResult> {
    console.info(`[simulated store] purchase ${productId}`);
    return new Promise((resolve) => setTimeout(() => resolve({ ok: true, productId }), 400));
  }

  showRewardedAd(placement: string): Promise<boolean> {
    console.info(`[simulated ads] rewarded ad: ${placement}`);
    return new Promise((resolve) => setTimeout(() => resolve(true), SIMULATED_AD_MS));
  }
}
