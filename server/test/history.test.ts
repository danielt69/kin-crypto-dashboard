import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { RefreshLoop } from '../src/refresh-loop.js';
import { FakeMarketRepo, makeCoin, quietLog } from './fakes.js';

const NOW = new Date('2026-07-02T12:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

let app: FastifyInstance;
afterEach(() => app?.close());

function setup() {
  const repo = new FakeMarketRepo();
  repo.seedCoins([makeCoin()], minsAgo(1));
  // Points both inside and outside the 1h window, inserted out of order.
  repo.seedSnapshot('bitcoin', 50_200, minsAgo(10));
  repo.seedSnapshot('bitcoin', 50_100, minsAgo(30));
  repo.seedSnapshot('bitcoin', 49_900, minsAgo(90)); // outside 1h
  repo.seedSnapshot('ethereum', 3_000, minsAgo(5)); // different coin

  const fetchMarkets = vi.fn(async () => [makeCoin()]);
  const loop = new RefreshLoop({
    fetchMarkets,
    repo,
    intervalMs: 20_000,
    maxBackoffMs: 300_000,
    snapshotRetentionMs: 86_400_000,
    now: () => NOW,
    log: quietLog,
  });
  app = buildApp({ loop, repo, now: () => NOW });
  return { app, fetchMarkets };
}

describe('GET /api/coins/:id/history', () => {
  it('returns only in-window points for the coin, oldest first', async () => {
    const { app } = setup();
    const res = await app.inject({ url: '/api/coins/bitcoin/history?window=1h' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.coin.id).toBe('bitcoin');
    // The 90-minute-old point and the ethereum point are excluded.
    expect(body.points).toEqual([
      { priceUsd: 50_100, fetchedAt: minsAgo(30).toISOString() },
      { priceUsd: 50_200, fetchedAt: minsAgo(10).toISOString() },
    ]);
  });

  it('triggers ZERO upstream calls — history is served from our snapshots', async () => {
    const { app, fetchMarkets } = setup();
    await app.inject({ url: '/api/coins/bitcoin/history?window=1h' });
    expect(fetchMarkets).not.toHaveBeenCalled();
  });

  it('404s for a coin we have never seen', async () => {
    const { app } = setup();
    const res = await app.inject({ url: '/api/coins/dogecoin/history' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects windows outside the whitelist', async () => {
    const { app } = setup();
    const res = await app.inject({ url: '/api/coins/bitcoin/history?window=7d' });
    expect(res.statusCode).toBe(400);
  });
});
