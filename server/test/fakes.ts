import type { Coin, HistoryPoint } from '@kin/types';
import type { CoinUpdate, FeedStatus, MarketRepo } from '../src/db/repo.js';

/** Minimal valid coin for tests; override what the test cares about. */
export function makeCoin(overrides: Partial<CoinUpdate> = {}): CoinUpdate {
  return {
    id: 'bitcoin',
    symbol: 'btc',
    name: 'Bitcoin',
    image: 'https://example.test/btc.png',
    priceUsd: 50_000,
    change24h: 1.5,
    marketCap: 1_000_000_000_000,
    rank: 1,
    ...overrides,
  };
}

/**
 * In-memory MarketRepo with the same semantics as the pg implementation.
 * Lets tests exercise the loop and routes with no database.
 */
export class FakeMarketRepo implements MarketRepo {
  coins = new Map<string, Coin>();
  snapshots: Array<{ coinId: string; priceUsd: number; fetchedAt: Date }> = [];
  feed: FeedStatus = { lastSuccessAt: null, lastErrorAt: null, lastError: null, degraded: false };

  /** Test helper: pretend the DB already holds data from a previous run. */
  seedCoins(coins: CoinUpdate[], updatedAt: Date): void {
    for (const c of coins) {
      this.coins.set(c.id, { ...c, updatedAt: updatedAt.toISOString() });
    }
    this.feed.lastSuccessAt = updatedAt;
  }

  seedSnapshot(coinId: string, priceUsd: number, fetchedAt: Date): void {
    this.snapshots.push({ coinId, priceUsd, fetchedAt });
  }

  async saveMarketTick(coins: CoinUpdate[], fetchedAt: Date): Promise<void> {
    for (const c of coins) {
      this.coins.set(c.id, { ...c, updatedAt: fetchedAt.toISOString() });
      this.snapshots.push({ coinId: c.id, priceUsd: c.priceUsd, fetchedAt });
    }
    this.feed = { ...this.feed, lastSuccessAt: fetchedAt, degraded: false, lastError: null };
  }

  async recordFailure(error: string, at: Date): Promise<void> {
    this.feed = { ...this.feed, lastErrorAt: at, lastError: error, degraded: true };
  }

  async getCoins(): Promise<Coin[]> {
    return [...this.coins.values()].sort((a, b) => a.rank - b.rank);
  }

  async getCoin(id: string): Promise<Coin | null> {
    return this.coins.get(id) ?? null;
  }

  async getHistory(coinId: string, since: Date): Promise<HistoryPoint[]> {
    return this.snapshots
      .filter((s) => s.coinId === coinId && s.fetchedAt >= since)
      .sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime())
      .map((s) => ({ priceUsd: s.priceUsd, fetchedAt: s.fetchedAt.toISOString() }));
  }

  async getFeedStatus(): Promise<FeedStatus> {
    return { ...this.feed };
  }

  async deleteSnapshotsBefore(cutoff: Date): Promise<number> {
    const before = this.snapshots.length;
    this.snapshots = this.snapshots.filter((s) => s.fetchedAt >= cutoff);
    return before - this.snapshots.length;
  }
}

/** Silent logger so expected failures don't clutter test output. */
export const quietLog = { info: () => {}, warn: () => {}, error: () => {} };
