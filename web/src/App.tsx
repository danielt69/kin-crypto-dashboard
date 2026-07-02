import { useMemo, useState } from 'react';
import { useMarketStream } from './hooks/useMarketStream';
import { CoinTable } from './components/CoinTable';
import { FreshnessBadge } from './components/FreshnessBadge';
import { HistoryPanel } from './components/HistoryPanel';
import { filterCoins } from './table';

export function App() {
  const { snapshot, status, receivedAt } = useMarketStream();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => (snapshot ? filterCoins(snapshot.data, query) : []),
    [snapshot, query]
  );

  return (
    <div className="app">
      <header className="header">
        <h1>Crypto Market Dashboard</h1>
        {snapshot && receivedAt !== null && (
          <div className="header-status">
            {status === 'open' && !snapshot.meta.degraded && (
              <span className="live-pill">
                <span className="live-dot" aria-hidden />
                live
              </span>
            )}
            <FreshnessBadge
              meta={snapshot.meta}
              receivedAt={receivedAt}
              reconnecting={status === 'reconnecting'}
            />
          </div>
        )}
      </header>

      <main>{renderBody()}</main>

      <footer className="footer">
        Top 20 by market cap · live via SSE · data by CoinGecko, served from our own API
      </footer>
    </div>
  );

  function renderBody() {
    // Explicit UI states, in priority order.
    if (status === 'error') {
      return (
        <div className="state state-error">
          <p>Could not connect to the market stream.</p>
          <p className="hint">Check that the API server is running, then reload.</p>
        </div>
      );
    }
    if (!snapshot) {
      // Loading: nothing received yet (covers 'connecting' and early 'reconnecting').
      return <TableSkeleton />;
    }
    if (snapshot.data.length === 0) {
      // Connected but the server has no data yet (first boot, upstream down).
      return (
        <div className="state">
          <p>No market data yet.</p>
          <p className="hint">The server is waiting for its first successful upstream fetch.</p>
        </div>
      );
    }
    return (
      <>
        <div className="toolbar">
          <input
            type="search"
            className="filter-input"
            placeholder="Filter by name or symbol…"
            aria-label="Filter coins by name or symbol"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="toolbar-count" role="status">
            showing {filtered.length} of {snapshot.data.length}
          </span>
        </div>
        <CoinTable
          coins={filtered}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
        />
        {selectedId && (
          <HistoryPanel coinId={selectedId} onClose={() => setSelectedId(null)} />
        )}
      </>
    );
  }
}

/** Loading placeholder shaped like the real table, to avoid layout jump. */
function TableSkeleton() {
  return (
    <div className="skeleton" aria-label="Loading market data">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}
