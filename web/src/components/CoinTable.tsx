import type { Coin } from '@kin/types';
import { formatChange, formatMarketCap, formatPrice } from '../format';

interface Props {
  coins: Coin[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function CoinTable({ coins, selectedId, onSelect }: Props) {
  return (
    <table className="coin-table">
      <thead>
        <tr>
          <th className="num">#</th>
          <th>Coin</th>
          <th className="num">Price</th>
          <th className="num">24h</th>
          <th className="num">Market cap</th>
        </tr>
      </thead>
      <tbody>
        {coins.map((coin) => (
          <tr
            key={coin.id}
            className={coin.id === selectedId ? 'selected' : ''}
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
        ))}
      </tbody>
    </table>
  );
}

function changeClass(change: number | null): string {
  if (change === null) return '';
  return change >= 0 ? 'up' : 'down';
}
