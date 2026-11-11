/**
 * The one seam between the game and anything that costs real money or shows
 * a real ad. The game only ever talks to this interface, so swapping the
 * simulated implementation for StoreKit / Play Billing / an ad SDK (for
 * example through Capacitor plugins) does not touch game code.
 */
export interface PurchaseResult {
  ok: boolean;
  productId: string;
}

export interface Platform {
  readonly name: string;
  /** True when purchases and ads are fake. The UI says so when this is set. */
  readonly simulated: boolean;
  /** The store's display price for a product, already localised ("$4.99"). Empty if unknown. */
  price(productId: string): string;
  /** Start a real-money purchase. Resolves once the store confirms or the player cancels. */
  purchase(productId: string): Promise<PurchaseResult>;
  /** Show a rewarded video. Resolves true only if the player earned the reward. */
  showRewardedAd(placement: string): Promise<boolean>;
}

/**
 * Product ids, and what each one grants, are defined in src/sim/store.ts
 * (PRODUCTS). The real store must be set up with the same ids.
 */
export const AD_PLACEMENTS = {
  revive: 'revive',
  chest: 'free_chest',
  energy: 'energy',
} as const;
