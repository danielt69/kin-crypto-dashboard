/**
 * Shared API contract between server and web.
 *
 * These types describe the JSON that actually crosses the wire, so both sides
 * import them from this package instead of re-declaring (and drifting).
 */

/** One coin's current state, as served by GET /api/coins and the SSE stream. */
export interface Coin {
  /** CoinGecko id, e.g. "bitcoin". Primary key across the whole system. */
  id: string;
  symbol: string;
  name: string;
  /** Icon URL (hosted by CoinGecko's CDN). */
  image: string;
  priceUsd: number;
  /** 24h change in percent. CoinGecko occasionally returns null for new listings. */
  change24h: number | null;
  marketCap: number | null;
  /** Market-cap rank, 1-based. */
  rank: number;
  /** When our server last wrote this row (ISO 8601). */
  updatedAt: string;
}

/**
 * Freshness metadata attached to every market payload.
 *
 * Derived from the last *successful* upstream fetch, not the last attempt —
 * a failing upstream keeps serving last-known-good data with honest flags.
 */
export interface SnapshotMeta {
  /** ISO timestamp of the last successful CoinGecko fetch, null before the first one. */
  lastSuccessAt: string | null;
  /** Milliseconds since lastSuccessAt at the time the payload was produced. */
  ageMs: number | null;
  /** True while the upstream is failing (we are in backoff, serving last-known-good). */
  degraded: boolean;
  /** True when ageMs exceeds the staleness threshold (2 x refresh interval). */
  stale: boolean;
}

/** Payload of GET /api/coins and of every SSE "snapshot" event. */
export interface MarketSnapshot {
  data: Coin[];
  meta: SnapshotMeta;
}

/** One historical price point from our own price_snapshots table. */
export interface HistoryPoint {
  priceUsd: number;
  /** When our refresh loop recorded this point (ISO 8601). */
  fetchedAt: string;
}

/** Payload of GET /api/coins/:id/history. */
export interface CoinHistory {
  coin: Coin;
  points: HistoryPoint[];
}

/** Payload of GET /health. */
export interface HealthStatus {
  status: 'ok';
  degraded: boolean;
  lastSuccessAt: string | null;
}

/** History windows the API accepts, mapped to their length in ms. */
export const HISTORY_WINDOWS = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
} as const;

export type HistoryWindow = keyof typeof HISTORY_WINDOWS;
