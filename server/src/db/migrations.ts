import type { Pool } from 'pg';

/**
 * Idempotent, ordered DDL run on every boot. At this project size a full
 * migration framework would be ceremony; IF NOT EXISTS gives the same
 * guarantee (safe to run repeatedly, safe with a fresh volume).
 */
const MIGRATIONS: string[] = [
  // Denormalized current state, one row per coin. This table IS the
  // last-known-good source when the upstream is unavailable.
  `CREATE TABLE IF NOT EXISTS coins (
    id          TEXT PRIMARY KEY,            -- CoinGecko id, e.g. "bitcoin"
    symbol      TEXT NOT NULL,
    name        TEXT NOT NULL,
    image       TEXT NOT NULL,
    price_usd   NUMERIC NOT NULL,
    change_24h  NUMERIC,                     -- null for brand-new listings
    market_cap  NUMERIC,
    rank        INT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  // Append-only time series, written once per refresh tick, read by the
  // history endpoint. Never queried without a coin_id + time bound.
  `CREATE TABLE IF NOT EXISTS price_snapshots (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    coin_id     TEXT NOT NULL REFERENCES coins(id),
    price_usd   NUMERIC NOT NULL,
    change_24h  NUMERIC,
    market_cap  NUMERIC,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  // Matches the only read pattern: "this coin, most recent window".
  `CREATE INDEX IF NOT EXISTS idx_snapshots_coin_time
     ON price_snapshots (coin_id, fetched_at DESC)`,

  // Single-row feed health. CHECK(id = 1) makes "single-row" a DB-level
  // invariant instead of an application convention.
  `CREATE TABLE IF NOT EXISTS feed_status (
    id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_success_at TIMESTAMPTZ,
    last_error_at   TIMESTAMPTZ,
    last_error      TEXT,
    degraded        BOOLEAN NOT NULL DEFAULT false
  )`,

  `INSERT INTO feed_status (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
];

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    for (const sql of MIGRATIONS) {
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}
