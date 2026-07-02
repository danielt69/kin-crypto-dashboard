import type { Coin } from '@kin/types';

/** Table view helpers — pure functions so they are trivially unit-testable. */

export type SortKey = 'rank' | 'name' | 'priceUsd' | 'change24h' | 'marketCap';
export type SortDir = 'asc' | 'desc';

/**
 * First-click direction per column: rank/name read naturally ascending,
 * numeric value columns are usually asked "biggest first".
 */
export const DEFAULT_DIR: Record<SortKey, SortDir> = {
  rank: 'asc',
  name: 'asc',
  priceUsd: 'desc',
  change24h: 'desc',
  marketCap: 'desc',
};

/**
 * Returns a newly sorted array (never mutates the input). Nulls (CoinGecko
 * gaps in change24h/marketCap) always sink to the bottom regardless of
 * direction; ties break on rank so the order is stable across refreshes.
 */
export function sortCoins(coins: readonly Coin[], key: SortKey, dir: SortDir): Coin[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...coins].sort((a, b) => {
    if (key === 'name') {
      return (
        sign * a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.rank - b.rank
      );
    }
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return a.rank - b.rank;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sign * (av - bv) || a.rank - b.rank;
  });
}

/** Case-insensitive substring match on name or symbol; blank query matches all. */
export function filterCoins(coins: readonly Coin[], query: string): Coin[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...coins];
  return coins.filter(
    (c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q)
  );
}
