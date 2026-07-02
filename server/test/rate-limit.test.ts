import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { RefreshLoop } from '../src/refresh-loop.js';
import { FakeMarketRepo, makeCoin, quietLog } from './fakes.js';

let app: FastifyInstance;
afterEach(() => app?.close());

describe('rate-limit invariant: request volume never creates upstream traffic', () => {
  it('50 concurrent /api/coins calls cause ZERO extra upstream fetches', async () => {
    const fetchMarkets = vi.fn(async () => [makeCoin()]);
    const repo = new FakeMarketRepo();
    const loop = new RefreshLoop({
      fetchMarkets,
      repo,
      intervalMs: 20_000,
      maxBackoffMs: 300_000,
      snapshotRetentionMs: 86_400_000,
      log: quietLog,
    });
    app = buildApp({ loop, repo });

    // Exactly one fetch, driven by the loop — never by requests.
    await loop.tick();
    expect(fetchMarkets).toHaveBeenCalledTimes(1);

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => app.inject({ url: '/api/coins' }))
    );

    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
    }
    // The invariant this whole architecture exists for:
    expect(fetchMarkets).toHaveBeenCalledTimes(1);
  });

  it('requests before the first tick still work (empty data, honest meta)', async () => {
    const fetchMarkets = vi.fn(async () => [makeCoin()]);
    const loop = new RefreshLoop({
      fetchMarkets,
      repo: new FakeMarketRepo(),
      intervalMs: 20_000,
      maxBackoffMs: 300_000,
      snapshotRetentionMs: 86_400_000,
      log: quietLog,
    });
    app = buildApp({ loop, repo: new FakeMarketRepo() });

    const res = await app.inject({ url: '/api/coins' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [],
      meta: { lastSuccessAt: null, ageMs: null, degraded: false, stale: false },
    });
    expect(fetchMarkets).not.toHaveBeenCalled();
  });
});
