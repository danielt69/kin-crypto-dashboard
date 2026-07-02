import type { CoinHistory } from '@kin/types';

/**
 * History comes from OUR database (the price_snapshots table the refresh
 * loop populates) — this request never triggers an upstream CoinGecko call.
 */
export async function fetchCoinHistory(
  coinId: string,
  window: '1h' | '24h' = '1h',
  signal?: AbortSignal
): Promise<CoinHistory> {
  const res = await fetch(
    `/api/coins/${encodeURIComponent(coinId)}/history?window=${window}`,
    { signal }
  );
  if (!res.ok) throw new Error(`history request failed: ${res.status}`);
  return res.json() as Promise<CoinHistory>;
}
