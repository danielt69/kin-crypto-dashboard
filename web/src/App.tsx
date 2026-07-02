import { useMarketStream } from './hooks/useMarketStream';
import { CoinTable } from './components/CoinTable';
import { FreshnessBadge } from './components/FreshnessBadge';

export function App() {
  const { snapshot, status, receivedAt } = useMarketStream();

  return (
    <div className="app">
      <header className="header">
        <h1>Crypto Market Dashboard</h1>
        {snapshot && receivedAt !== null && (
          <FreshnessBadge
            meta={snapshot.meta}
            receivedAt={receivedAt}
            reconnecting={status === 'reconnecting'}
          />
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
    return <CoinTable coins={snapshot.data} selectedId={null} onSelect={() => {}} />;
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
