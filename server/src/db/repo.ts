import type { Coin, HistoryPoint } from '@kin/types';
import type { Pool } from 'pg';

/** A coin as produced by the upstream fetcher; updated_at is set by the write. */
export type CoinUpdate = Omit<Coin, 'updatedAt'>;

/** Persisted feed health (mirrors the single feed_status row). */
export interface FeedStatus {
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  degraded: boolean;
}

/**
 * Everything the app needs from storage, as an interface so the refresh loop
 * and routes can be unit-tested against an in-memory fake (see server tests).
 */
export interface MarketRepo {
  /** One refresh tick's writes, atomically: upsert current state, append snapshots, mark feed healthy. */
  saveMarketTick(coins: CoinUpdate[], fetchedAt: Date): Promise<void>;
  /** Mark the feed degraded after an upstream failure (keeps existing data untouched). */
  recordFailure(error: string, at: Date): Promise<void>;
  /** Current top coins, rank order. The last-known-good read path. */
  getCoins(): Promise<Coin[]>;
  getCoin(id: string): Promise<Coin | null>;
  /** Snapshot points for one coin since a timestamp, oldest first. */
  getHistory(coinId: string, since: Date): Promise<HistoryPoint[]>;
  getFeedStatus(): Promise<FeedStatus>;
  /** Retention sweep; returns rows deleted. */
  deleteSnapshotsBefore(cutoff: Date): Promise<number>;
}

interface CoinRow {
  id: string;
  symbol: string;
  name: string;
  image: string;
  price_usd: number;
  change_24h: number | null;
  market_cap: number | null;
  rank: number;
  updated_at: Date;
}

function toCoin(row: CoinRow): Coin {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    image: row.image,
    priceUsd: row.price_usd,
    change24h: row.change_24h,
    marketCap: row.market_cap,
    rank: row.rank,
    updatedAt: row.updated_at.toISOString(),
  };
}

export function createPgMarketRepo(pool: Pool): MarketRepo {
  return {
    async saveMarketTick(coins, fetchedAt) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Multi-row upsert in one statement: flatten coins into a parameter
        // list and build ($1,$2,...),($9,$10,...) placeholders.
        const cols = 8;
        const values = coins.flatMap((c) => [
          c.id, c.symbol, c.name, c.image, c.priceUsd, c.change24h, c.marketCap, c.rank,
        ]);
        const rows = coins
          .map((_, i) => {
            const p = (n: number) => `$${i * cols + n}`;
            return `(${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, $${coins.length * cols + 1})`;
          })
          .join(', ');
        await client.query(
          `INSERT INTO coins (id, symbol, name, image, price_usd, change_24h, market_cap, rank, updated_at)
           VALUES ${rows}
           ON CONFLICT (id) DO UPDATE SET
             symbol = EXCLUDED.symbol,
             name = EXCLUDED.name,
             image = EXCLUDED.image,
             price_usd = EXCLUDED.price_usd,
             change_24h = EXCLUDED.change_24h,
             market_cap = EXCLUDED.market_cap,
             rank = EXCLUDED.rank,
             updated_at = EXCLUDED.updated_at`,
          [...values, fetchedAt]
        );

        // Append the same tick to the time series.
        const snapRows = coins
          .map((_, i) => {
            const p = (n: number) => `$${i * 4 + n}`;
            return `(${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, $${coins.length * 4 + 1})`;
          })
          .join(', ');
        const snapValues = coins.flatMap((c) => [c.id, c.priceUsd, c.change24h, c.marketCap]);
        await client.query(
          `INSERT INTO price_snapshots (coin_id, price_usd, change_24h, market_cap, fetched_at)
           VALUES ${snapRows}`,
          [...snapValues, fetchedAt]
        );

        await client.query(
          `UPDATE feed_status
             SET last_success_at = $1, degraded = false, last_error = NULL
           WHERE id = 1`,
          [fetchedAt]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async recordFailure(error, at) {
      await pool.query(
        `UPDATE feed_status
           SET last_error_at = $1, last_error = $2, degraded = true
         WHERE id = 1`,
        [at, error]
      );
    },

    async getCoins() {
      const res = await pool.query<CoinRow>('SELECT * FROM coins ORDER BY rank ASC');
      return res.rows.map(toCoin);
    },

    async getCoin(id) {
      const res = await pool.query<CoinRow>('SELECT * FROM coins WHERE id = $1', [id]);
      const row = res.rows[0];
      return row ? toCoin(row) : null;
    },

    async getHistory(coinId, since) {
      // Range scan on idx_snapshots_coin_time — never touches the upstream.
      const res = await pool.query<{ price_usd: number; fetched_at: Date }>(
        `SELECT price_usd, fetched_at
           FROM price_snapshots
          WHERE coin_id = $1 AND fetched_at >= $2
          ORDER BY fetched_at ASC`,
        [coinId, since]
      );
      return res.rows.map((r) => ({ priceUsd: r.price_usd, fetchedAt: r.fetched_at.toISOString() }));
    },

    async getFeedStatus() {
      const res = await pool.query<{
        last_success_at: Date | null;
        last_error_at: Date | null;
        last_error: string | null;
        degraded: boolean;
      }>('SELECT last_success_at, last_error_at, last_error, degraded FROM feed_status WHERE id = 1');
      const row = res.rows[0];
      return {
        lastSuccessAt: row?.last_success_at ?? null,
        lastErrorAt: row?.last_error_at ?? null,
        lastError: row?.last_error ?? null,
        degraded: row?.degraded ?? false,
      };
    },

    async deleteSnapshotsBefore(cutoff) {
      const res = await pool.query('DELETE FROM price_snapshots WHERE fetched_at < $1', [cutoff]);
      return res.rowCount ?? 0;
    },
  };
}
