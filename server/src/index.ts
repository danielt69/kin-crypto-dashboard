import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { runMigrations } from './db/migrations.js';
import { createPgMarketRepo } from './db/repo.js';
import { createCoinGeckoFetcher } from './coingecko.js';
import { RefreshLoop } from './refresh-loop.js';
import { buildApp } from './app.js';

/** Composition root: build real dependencies and wire them together. */
async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  await runMigrations(pool);

  const repo = createPgMarketRepo(pool);
  const loop = new RefreshLoop({
    fetchMarkets: createCoinGeckoFetcher(config.coingeckoBaseUrl),
    repo,
    intervalMs: config.refreshIntervalMs,
    maxBackoffMs: config.maxBackoffMs,
    snapshotRetentionMs: config.snapshotRetentionMs,
  });

  // Serve whatever Postgres already has before the first upstream call —
  // a restart during a CoinGecko outage still comes up with data.
  await loop.init();
  loop.start();

  const app = buildApp({ loop, repo });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.info(
    `api listening on :${config.port}, refreshing every ${config.refreshIntervalMs}ms`
  );

  const shutdown = async (signal: string) => {
    console.info(`${signal} received, shutting down`);
    loop.stop();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('fatal during startup:', err);
  process.exit(1);
});
