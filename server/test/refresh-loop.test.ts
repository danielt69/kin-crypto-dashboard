import { describe, expect, it, vi } from 'vitest';
import { RefreshLoop } from '../src/refresh-loop.js';
import { FakeMarketRepo, makeCoin, quietLog } from './fakes.js';

const INTERVAL = 20_000;
const MAX_BACKOFF = 300_000;

function makeLoop(opts: {
  fetchMarkets: () => Promise<ReturnType<typeof makeCoin>[]>;
  repo?: FakeMarketRepo;
  now?: () => Date;
}) {
  const repo = opts.repo ?? new FakeMarketRepo();
  const loop = new RefreshLoop({
    fetchMarkets: opts.fetchMarkets,
    repo,
    intervalMs: INTERVAL,
    maxBackoffMs: MAX_BACKOFF,
    snapshotRetentionMs: 24 * 60 * 60 * 1000,
    now: opts.now ?? (() => new Date('2026-07-02T12:00:00Z')),
    log: quietLog,
  });
  return { loop, repo };
}

describe('failure fallback (the core resilience guarantee)', () => {
  it('keeps serving last-known-good data when the upstream starts failing', async () => {
    let failing = false;
    const fetchMarkets = vi.fn(async () => {
      if (failing) throw new Error('CoinGecko responded 429');
      return [makeCoin(), makeCoin({ id: 'ethereum', name: 'Ethereum', rank: 2 })];
    });
    const { loop } = makeLoop({ fetchMarkets });

    await loop.tick(); // healthy tick populates cache + DB
    failing = true;
    await expect(loop.tick()).resolves.toBeUndefined(); // no exception bubbles

    const snapshot = loop.snapshot();
    expect(snapshot.data).toHaveLength(2); // data survived the failure
    expect(snapshot.data[0]?.id).toBe('bitcoin');
    expect(snapshot.meta.degraded).toBe(true); // and we are honest about it
  });

  it('serves DB data on a cold start even if the upstream is down from boot', async () => {
    const repo = new FakeMarketRepo();
    repo.seedCoins([makeCoin()], new Date('2026-07-02T11:00:00Z'));
    const fetchMarkets = vi.fn(async (): Promise<never> => {
      throw new Error('upstream down');
    });
    const { loop } = makeLoop({ fetchMarkets, repo });

    await loop.init(); // warm start from "previous run's" data
    await loop.tick(); // first tick fails

    const snapshot = loop.snapshot();
    expect(snapshot.data).toHaveLength(1);
    expect(snapshot.meta.degraded).toBe(true);
    expect(snapshot.meta.lastSuccessAt).toBe('2026-07-02T11:00:00.000Z');
  });

  it('recovers cleanly: next success clears degraded and resumes normal cadence', async () => {
    let failing = true;
    const fetchMarkets = vi.fn(async () => {
      if (failing) throw new Error('boom');
      return [makeCoin()];
    });
    const { loop } = makeLoop({ fetchMarkets });

    await loop.tick();
    await loop.tick();
    expect(loop.snapshot().meta.degraded).toBe(true);

    failing = false;
    await loop.tick();
    expect(loop.snapshot().meta.degraded).toBe(false);
    expect(loop.nextDelayMs()).toBe(INTERVAL);
  });

  it('persists the failure to feed_status so restarts stay honest', async () => {
    const { loop, repo } = makeLoop({
      fetchMarkets: async () => {
        throw new Error('CoinGecko responded 500');
      },
    });
    await loop.tick();
    expect(repo.feed.degraded).toBe(true);
    expect(repo.feed.lastError).toContain('500');
  });
});

describe('backoff schedule', () => {
  it('doubles per consecutive failure and caps at maxBackoffMs', async () => {
    const { loop } = makeLoop({
      fetchMarkets: async () => {
        throw new Error('down');
      },
    });

    const expected = [20_000, 40_000, 80_000, 160_000, 300_000, 300_000];
    for (const delay of expected) {
      await loop.tick();
      expect(loop.nextDelayMs()).toBe(delay);
    }
  });
});
