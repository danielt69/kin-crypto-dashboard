/** All runtime configuration in one place, read once at boot. */
export interface Config {
  port: number;
  databaseUrl: string;
  /** Cadence of the shared refresh loop. Also drives the staleness threshold (2x). */
  refreshIntervalMs: number;
  /** Backoff ceiling when CoinGecko is failing. */
  maxBackoffMs: number;
  /** How much snapshot history to keep before the retention sweep deletes it. */
  snapshotRetentionMs: number;
  coingeckoBaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: intFromEnv(env.PORT, 3001),
    databaseUrl: env.DATABASE_URL ?? 'postgres://kin:kin@localhost:5432/kin_crypto',
    refreshIntervalMs: intFromEnv(env.REFRESH_INTERVAL_MS, 20_000),
    maxBackoffMs: intFromEnv(env.MAX_BACKOFF_MS, 300_000),
    snapshotRetentionMs: intFromEnv(env.SNAPSHOT_RETENTION_MS, 24 * 60 * 60 * 1000),
    coingeckoBaseUrl: env.COINGECKO_BASE_URL ?? 'https://api.coingecko.com/api/v3',
  };
}

function intFromEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
