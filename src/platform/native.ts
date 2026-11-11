import type { Platform, PurchaseResult } from './platform';

/**
 * What the native platform needs from a store SDK. The real one is RevenueCat
 * (gateways.ts); tests use a fake.
 */
export interface StoreGateway {
  /** Connect to the store and look the products up. Resolves to display prices by product id. */
  init(productIds: string[]): Promise<Record<string, string>>;
  /** Run the purchase sheet. Rejects if the purchase fails for any reason other than the player backing out. */
  buy(productId: string): Promise<'bought' | 'cancelled'>;
}

/** What the native platform needs from an ad SDK. The real one is AdMob. */
export interface AdGateway {
  init(): Promise<void>;
  /** Load and show one rewarded ad. Resolves true only if the reward was earned. */
  showRewarded(placement: string): Promise<boolean>;
}

/**
 * Purchases and ads on a phone. Each half degrades on its own: with no store
 * (no API key, or it failed to connect) nothing can be bought and prices are
 * blank; with no ad network the ad options are not offered. Nothing here ever
 * hands out a reward that the store or the ad network did not confirm.
 */
export class NativePlatform implements Platform {
  readonly name = 'native';
  readonly simulated = false;
  private prices: Record<string, string> = {};
  private adsUp = false;
  private buying = false;
  private showing = false;

  constructor(
    private store: StoreGateway | null,
    private ads: AdGateway | null,
    private productIds: string[],
    private log: (message: string, err?: unknown) => void = (m, e) => console.warn(`[platform] ${m}`, e ?? ''),
  ) {}

  get adsAvailable(): boolean {
    return this.adsUp;
  }

  async ready(): Promise<void> {
    await Promise.all([this.connectStore(), this.connectAds()]);
  }

  private async connectStore(): Promise<void> {
    if (!this.store) {
      this.log('no store configured: purchases are off');
      return;
    }
    try {
      this.prices = await this.store.init(this.productIds);
      const missing = this.productIds.filter((id) => !this.prices[id]);
      if (missing.length > 0) this.log(`store has no product for: ${missing.join(', ')}`);
    } catch (err) {
      this.prices = {};
      this.log('store failed to start: purchases are off', err);
    }
  }

  private async connectAds(): Promise<void> {
    if (!this.ads) return;
    try {
      await this.ads.init();
      this.adsUp = true;
    } catch (err) {
      this.log('ads failed to start', err);
    }
  }

  price(productId: string): string {
    return this.prices[productId] ?? '';
  }

  async purchase(productId: string): Promise<PurchaseResult> {
    const refused: PurchaseResult = { ok: false, productId };
    // One purchase sheet at a time, and only for products the store actually listed.
    if (!this.store || !this.prices[productId] || this.buying) return refused;
    this.buying = true;
    try {
      return { ok: (await this.store.buy(productId)) === 'bought', productId };
    } catch (err) {
      this.log(`purchase of ${productId} failed`, err);
      return refused;
    } finally {
      this.buying = false;
    }
  }

  async showRewardedAd(placement: string): Promise<boolean> {
    if (!this.ads || !this.adsUp || this.showing) return false;
    this.showing = true;
    try {
      return await this.ads.showRewarded(placement);
    } catch (err) {
      this.log(`rewarded ad (${placement}) failed`, err);
      return false;
    } finally {
      this.showing = false;
    }
  }
}
