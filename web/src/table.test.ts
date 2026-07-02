import { describe, expect, it } from 'vitest';
import type { Coin } from '@kin/types';
import { DEFAULT_DIR, filterCoins, sortCoins } from './table';

function coin(overrides: Partial<Coin> & { id: string }): Coin {
  return {
    symbol: overrides.id.slice(0, 3),
    name: overrides.id,
    image: '',
    priceUsd: 1,
    change24h: 0,
    marketCap: 1,
    rank: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const coins: Coin[] = [
  coin({ id: 'bitcoin', name: 'Bitcoin', symbol: 'btc', rank: 1, priceUsd: 60000, change24h: -1.2, marketCap: 1_200_000 }),
  coin({ id: 'ethereum', name: 'Ethereum', symbol: 'eth', rank: 2, priceUsd: 3000, change24h: 2.5, marketCap: 400_000 }),
  coin({ id: 'tether', name: 'Tether', symbol: 'usdt', rank: 3, priceUsd: 1, change24h: null, marketCap: 100_000 }),
  coin({ id: 'dogecoin', name: 'dogecoin', symbol: 'doge', rank: 4, priceUsd: 0.1, change24h: 5.0, marketCap: null }),
];

describe('sortCoins', () => {
  it('sorts by rank ascending (the default view)', () => {
    const shuffled = [coins[2]!, coins[0]!, coins[3]!, coins[1]!];
    expect(sortCoins(shuffled, 'rank', 'asc').map((c) => c.id)).toEqual([
      'bitcoin', 'ethereum', 'tether', 'dogecoin',
    ]);
  });

  it('sorts by price in both directions', () => {
    expect(sortCoins(coins, 'priceUsd', 'desc').map((c) => c.id)).toEqual([
      'bitcoin', 'ethereum', 'tether', 'dogecoin',
    ]);
    expect(sortCoins(coins, 'priceUsd', 'asc').map((c) => c.id)).toEqual([
      'dogecoin', 'tether', 'ethereum', 'bitcoin',
    ]);
  });

  it('sorts by name case-insensitively', () => {
    expect(sortCoins(coins, 'name', 'asc').map((c) => c.name)).toEqual([
      'Bitcoin', 'dogecoin', 'Ethereum', 'Tether',
    ]);
  });

  it('always sinks null values to the bottom, in either direction', () => {
    expect(sortCoins(coins, 'change24h', 'desc').map((c) => c.id)).toEqual([
      'dogecoin', 'ethereum', 'bitcoin', 'tether',
    ]);
    expect(sortCoins(coins, 'change24h', 'asc').map((c) => c.id)).toEqual([
      'bitcoin', 'ethereum', 'dogecoin', 'tether',
    ]);
    expect(sortCoins(coins, 'marketCap', 'asc').at(-1)?.id).toBe('dogecoin');
  });

  it('breaks ties by rank so order is stable across refreshes', () => {
    const tied = [
      coin({ id: 'b', rank: 2, priceUsd: 5 }),
      coin({ id: 'a', rank: 1, priceUsd: 5 }),
    ];
    expect(sortCoins(tied, 'priceUsd', 'desc').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const input = [...coins];
    sortCoins(input, 'priceUsd', 'asc');
    expect(input.map((c) => c.id)).toEqual(coins.map((c) => c.id));
  });

  it('has a default direction for every sortable column', () => {
    expect(DEFAULT_DIR.rank).toBe('asc');
    expect(DEFAULT_DIR.name).toBe('asc');
    expect(DEFAULT_DIR.priceUsd).toBe('desc');
    expect(DEFAULT_DIR.change24h).toBe('desc');
    expect(DEFAULT_DIR.marketCap).toBe('desc');
  });
});

describe('filterCoins', () => {
  it('matches name substrings case-insensitively', () => {
    expect(filterCoins(coins, 'BIT').map((c) => c.id)).toEqual(['bitcoin']);
    expect(filterCoins(coins, 'coin').map((c) => c.id)).toEqual(['bitcoin', 'dogecoin']);
  });

  it('matches symbol substrings case-insensitively', () => {
    expect(filterCoins(coins, 'usdt').map((c) => c.id)).toEqual(['tether']);
  });

  it('matches on name OR symbol ("eth" hits Ethereum and T-eth-er)', () => {
    expect(filterCoins(coins, 'ETH').map((c) => c.id)).toEqual(['ethereum', 'tether']);
  });

  it('trims whitespace and treats a blank query as match-all', () => {
    expect(filterCoins(coins, '')).toHaveLength(coins.length);
    expect(filterCoins(coins, '   ')).toHaveLength(coins.length);
    expect(filterCoins(coins, '  usdt ').map((c) => c.id)).toEqual(['tether']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterCoins(coins, 'zzz-no-such-coin')).toEqual([]);
  });
});
