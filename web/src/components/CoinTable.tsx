import { useEffect, useMemo, useRef, useState } from 'react';
import type { Coin } from '@kin/types';
import { formatChange, formatMarketCap, formatPrice } from '../format';
import { DEFAULT_DIR, sortCoins, type SortDir, type SortKey } from '../table';

interface Props {
  /** Already filtered by the search box; empty means "no filter match". */
  coins: Coin[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'rank', label: '#', numeric: true },
  { key: 'name', label: 'Coin', numeric: false },
  { key: 'priceUsd', label: 'Price', numeric: true },
  { key: 'change24h', label: '24h', numeric: true },
  { key: 'marketCap', label: 'Market cap', numeric: true },
];

const FLASH_MS = 700;

export function CoinTable({ coins, selectedId, onSelect }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'rank', dir: 'asc' });
  const sorted = useMemo(() => sortCoins(coins, sort.key, sort.dir), [coins, sort]);

  // Live-update cue: compare incoming prices against the last seen ones and
  // flash the changed rows. The map outlives filter/sort changes, so only
  // genuine price moves flash — not reordering.
  const lastPrices = useRef(new Map<string, number>());
  const [flashes, setFlashes] = useState<ReadonlyMap<string, 'up' | 'down'>>(new Map());

  useEffect(() => {
    const changed = new Map<string, 'up' | 'down'>();
    for (const c of coins) {
      const prev = lastPrices.current.get(c.id);
      if (prev !== undefined && prev !== c.priceUsd) {
        changed.set(c.id, c.priceUsd > prev ? 'up' : 'down');
      }
      lastPrices.current.set(c.id, c.priceUsd);
    }
    if (changed.size === 0) return;
    setFlashes(changed);
    const timer = setTimeout(() => setFlashes(new Map()), FLASH_MS);
    return () => clearTimeout(timer);
  }, [coins]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: DEFAULT_DIR[key] }
    );
  }

  return (
    <table className="coin-table">
      <thead>
        <tr>
          {COLUMNS.map((col) => {
            const active = sort.key === col.key;
            return (
              <th
                key={col.key}
                className={col.numeric ? 'num' : undefined}
                aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                <button
                  type="button"
                  className={`sort-btn${active ? ' active' : ''}`}
                  onClick={() => toggleSort(col.key)}
                >
                  {col.label}
                  <span className={`caret${active ? ` ${sort.dir}` : ''}`} aria-hidden>
                    ▾
                  </span>
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr className="empty-row">
            <td colSpan={COLUMNS.length}>No coins match your filter.</td>
          </tr>
        ) : (
          sorted.map((coin) => (
            <tr
              key={coin.id}
              className={[
                coin.id === selectedId ? 'selected' : '',
                flashes.has(coin.id) ? `flash-${flashes.get(coin.id)}` : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(coin.id)}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(coin.id)}
            >
              <td className="num rank">{coin.rank}</td>
              <td>
                <div className="coin-name">
                  <img src={coin.image} alt="" width={22} height={22} loading="lazy" />
                  <span>{coin.name}</span>
                  <span className="symbol">{coin.symbol.toUpperCase()}</span>
                </div>
              </td>
              <td className="num price">{formatPrice(coin.priceUsd)}</td>
              <td className={`num ${changeClass(coin.change24h)}`}>
                {formatChange(coin.change24h)}
              </td>
              <td className="num cap">{formatMarketCap(coin.marketCap)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function changeClass(change: number | null): string {
  if (change === null) return '';
  return change >= 0 ? 'up' : 'down';
}
