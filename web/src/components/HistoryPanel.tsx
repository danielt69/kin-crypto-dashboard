import { useEffect, useState } from 'react';
import type { CoinHistory } from '@kin/types';
import { fetchCoinHistory } from '../api';
import { formatPrice } from '../format';

interface Props {
  coinId: string;
  onClose: () => void;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; history: CoinHistory };

/**
 * Last-hour price history for the selected coin. Sourced entirely from our
 * own price_snapshots table via /api/coins/:id/history — by design there is
 * no fresh upstream call behind this panel.
 */
export function HistoryPanel({ coinId, onClose }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    fetchCoinHistory(coinId, '1h', controller.signal)
      .then((history) => setState({ kind: 'ready', history }))
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setState({ kind: 'error', message: err.message });
      });
    return () => controller.abort();
  }, [coinId]);

  return (
    <section className="detail" aria-live="polite">
      {state.kind === 'loading' && <p className="hint">Loading history…</p>}
      {state.kind === 'error' && (
        <p className="hint">Could not load history: {state.message}</p>
      )}
      {state.kind === 'ready' && <HistoryContent history={state.history} onClose={onClose} />}
    </section>
  );
}

function HistoryContent({ history, onClose }: { history: CoinHistory; onClose: () => void }) {
  const { coin, points } = history;
  return (
    <>
      <div className="detail-head">
        <img src={coin.image} alt="" width={22} height={22} />
        <h2>
          {coin.name} — last hour ({points.length} snapshot{points.length === 1 ? '' : 's'})
        </h2>
        <button className="detail-close" onClick={onClose}>
          close
        </button>
      </div>
      <p className="detail-source">
        Recorded by our refresh loop, served from our database — not a live upstream query.
      </p>
      {points.length < 2 ? (
        <p className="hint">
          Not enough history yet — the server records one point per refresh. Check back in a
          minute.
        </p>
      ) : (
        <Sparkline prices={points.map((p) => p.priceUsd)} />
      )}
    </>
  );
}

/** Dependency-free SVG sparkline; a charting library would be overkill here. */
function Sparkline({ prices }: { prices: number[] }) {
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1; // flat line guard
  const W = 600;
  const H = 120;
  const PAD = 6;

  const pointsAttr = prices
    .map((p, i) => {
      const x = PAD + (i / (prices.length - 1)) * (W - 2 * PAD);
      const y = PAD + (1 - (p - min) / span) * (H - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <>
      <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
        <polyline points={pointsAttr} />
      </svg>
      <div className="detail-range">
        <span>low {formatPrice(min)}</span>
        <span>high {formatPrice(max)}</span>
      </div>
    </>
  );
}
