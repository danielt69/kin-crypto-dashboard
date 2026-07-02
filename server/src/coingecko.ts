import type { CoinUpdate } from './db/repo.js';

/**
 * The refresh loop only knows this function type, so tests (and a future
 * different provider) can swap the implementation without touching the loop.
 */
export type MarketsFetcher = () => Promise<CoinUpdate[]>;

/** Shape of the fields we consume from CoinGecko's /coins/markets response. */
interface CoinGeckoMarket {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number | null;
  price_change_percentage_24h: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
}

export class UpstreamError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/**
 * Real CoinGecko fetcher. Free tier, no API key. One call fetches the whole
 * top-20 page, so upstream cost is one request per refresh tick — O(1) in
 * connected users by construction.
 */
export function createCoinGeckoFetcher(baseUrl: string, timeoutMs = 10_000): MarketsFetcher {
  const url =
    `${baseUrl}/coins/markets?vs_currency=usd&order=market_cap_desc` +
    `&per_page=20&page=1&price_change_percentage=24h`;

  return async () => {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      // 429 lands here too — the loop's backoff handles it; no retry storm.
      throw new UpstreamError(`CoinGecko responded ${res.status}`, res.status);
    }
    const body = (await res.json()) as CoinGeckoMarket[];
    if (!Array.isArray(body) || body.length === 0) {
      throw new UpstreamError('CoinGecko returned an empty/invalid market list');
    }
    return body.map((m, i) => ({
      id: m.id,
      symbol: m.symbol,
      name: m.name,
      image: m.image,
      priceUsd: m.current_price ?? 0,
      change24h: m.price_change_percentage_24h,
      marketCap: m.market_cap,
      rank: m.market_cap_rank ?? i + 1,
    }));
  };
}
