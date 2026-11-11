import { describe, expect, it } from 'vitest';
import { NativePlatform, type AdGateway, type StoreGateway } from '../src/platform/native';
import { SimulatedPlatform } from '../src/platform/simulated';
import { PRODUCTS } from '../src/sim/store';

const IDS = PRODUCTS.map((p) => p.id);
const quiet = (): void => undefined;

function fakeStore(over: Partial<StoreGateway> = {}): StoreGateway & { bought: string[] } {
  const bought: string[] = [];
  return {
    bought,
    init: async (ids) => Object.fromEntries(ids.map((id) => [id, `£${id.length}.99`])),
    buy: async (id) => {
      bought.push(id);
      return 'bought';
    },
    ...over,
  };
}

function fakeAds(over: Partial<AdGateway> = {}): AdGateway & { shown: string[] } {
  const shown: string[] = [];
  return {
    shown,
    init: async () => undefined,
    showRewarded: async (placement) => {
      shown.push(placement);
      return true;
    },
    ...over,
  };
}

describe('native platform', () => {
  it('shows the store\'s prices and sells what the store lists', async () => {
    const store = fakeStore();
    const p = new NativePlatform(store, fakeAds(), IDS, quiet);
    expect(p.simulated).toBe(false);
    expect(p.price('gems_small')).toBe(''); // nothing known before the store answers
    expect(await p.purchase('gems_small')).toEqual({ ok: false, productId: 'gems_small' });
    await p.ready();
    expect(p.price('gems_small')).toBe('£10.99');
    expect(await p.purchase('gems_small')).toEqual({ ok: true, productId: 'gems_small' });
    expect(store.bought).toEqual(['gems_small']);
  });

  it('a cancelled or failed purchase grants nothing', async () => {
    const cancelled = new NativePlatform(fakeStore({ buy: async () => 'cancelled' }), null, IDS, quiet);
    await cancelled.ready();
    expect((await cancelled.purchase('gems_small')).ok).toBe(false);

    const broken = new NativePlatform(
      fakeStore({
        buy: async () => {
          throw new Error('card declined');
        },
      }),
      null,
      IDS,
      quiet,
    );
    await broken.ready();
    expect((await broken.purchase('gems_small')).ok).toBe(false);
  });

  it('will not sell a product the store does not list', async () => {
    const store = fakeStore({ init: async () => ({ gems_small: '$0.99' }) });
    const p = new NativePlatform(store, null, IDS, quiet);
    await p.ready();
    expect(p.price('starter_pack')).toBe('');
    expect((await p.purchase('starter_pack')).ok).toBe(false);
    expect((await p.purchase('made_up')).ok).toBe(false);
    expect(store.bought).toEqual([]);
  });

  it('runs one purchase at a time', async () => {
    let release: (v: 'bought') => void = () => undefined;
    const store = fakeStore({ buy: () => new Promise((resolve) => (release = resolve)) });
    const p = new NativePlatform(store, null, IDS, quiet);
    await p.ready();
    const first = p.purchase('gems_small');
    expect((await p.purchase('gems_large')).ok).toBe(false);
    release('bought');
    expect((await first).ok).toBe(true);
    // And is free again afterwards.
    const again = p.purchase('gems_large');
    release('bought');
    expect((await again).ok).toBe(true);
  });

  it('stays usable with no store or a store that fails to start', async () => {
    const none = new NativePlatform(null, fakeAds(), IDS, quiet);
    await none.ready();
    expect(none.price('gems_small')).toBe('');
    expect((await none.purchase('gems_small')).ok).toBe(false);
    expect(none.adsAvailable).toBe(true);

    const down = new NativePlatform(
      fakeStore({
        init: async () => {
          throw new Error('no network');
        },
      }),
      fakeAds(),
      IDS,
      quiet,
    );
    await expect(down.ready()).resolves.toBeUndefined();
    expect((await down.purchase('gems_small')).ok).toBe(false);
    expect(down.adsAvailable).toBe(true);
  });

  it('pays an ad reward only when the network says it was earned', async () => {
    const ads = fakeAds();
    const p = new NativePlatform(null, ads, IDS, quiet);
    expect(p.adsAvailable).toBe(false);
    expect(await p.showRewardedAd('revive')).toBe(false); // not connected yet
    await p.ready();
    expect(p.adsAvailable).toBe(true);
    expect(await p.showRewardedAd('revive')).toBe(true);
    expect(ads.shown).toEqual(['revive']);

    const skipped = new NativePlatform(null, fakeAds({ showRewarded: async () => false }), IDS, quiet);
    await skipped.ready();
    expect(await skipped.showRewardedAd('energy')).toBe(false);

    const noFill = new NativePlatform(
      null,
      fakeAds({
        showRewarded: async () => {
          throw new Error('no fill');
        },
      }),
      IDS,
      quiet,
    );
    await noFill.ready();
    expect(await noFill.showRewardedAd('energy')).toBe(false);
  });

  it('offers no ads when the ad network is missing or fails to start', async () => {
    const none = new NativePlatform(fakeStore(), null, IDS, quiet);
    await none.ready();
    expect(none.adsAvailable).toBe(false);
    expect(await none.showRewardedAd('revive')).toBe(false);

    const down = new NativePlatform(
      null,
      fakeAds({
        init: async () => {
          throw new Error('blocked');
        },
      }),
      IDS,
      quiet,
    );
    await down.ready();
    expect(down.adsAvailable).toBe(false);
  });
});

describe('simulated platform', () => {
  it('has a price for every product and always has ads', async () => {
    const p = new SimulatedPlatform();
    await p.ready();
    expect(p.simulated).toBe(true);
    expect(p.adsAvailable).toBe(true);
    for (const id of IDS) expect(p.price(id)).toMatch(/^\$\d+\.\d\d$/);
  });
});
