import { useEffect, useState } from 'react';
import type { SnapshotMeta } from '@kin/types';
import { formatAge } from '../format';

/**
 * If no snapshot has arrived for this long, show amber even if the server's
 * flags said fresh — covers a silently dead stream. Conservative: 3x the
 * default 20s refresh interval.
 */
const CLIENT_STALE_MS = 60_000;

interface Props {
  meta: SnapshotMeta;
  /** Local time the current snapshot arrived, so we can age it client-side. */
  receivedAt: number;
  reconnecting: boolean;
}

/** Re-render every second so the "Ns ago" label ticks without new data. */
function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function FreshnessBadge({ meta, receivedAt, reconnecting }: Props) {
  const now = useNowTick();
  // Server told us how old the data was at send time; add local elapsed time.
  const liveAgeMs = meta.ageMs === null ? null : meta.ageMs + (now - receivedAt);

  let level: 'fresh' | 'stale' | 'down';
  let label: string;

  if (meta.degraded) {
    level = 'down';
    label = 'upstream unavailable — showing last-known-good';
  } else if (meta.stale || now - receivedAt > CLIENT_STALE_MS) {
    level = 'stale';
    label = 'data may be stale';
  } else {
    level = 'fresh';
    label = liveAgeMs === null ? 'waiting for first update' : `updated ${formatAge(liveAgeMs)}`;
  }

  return (
    <div className={`badge badge-${level}`} role="status">
      {/* Keyed by receivedAt so the dot remounts — and its pulse animation
          replays — on every successful refresh. */}
      <span className="badge-dot" key={receivedAt} aria-hidden />
      <span>{label}</span>
      {liveAgeMs !== null && level !== 'fresh' && (
        <span className="badge-age">({formatAge(liveAgeMs)})</span>
      )}
      {reconnecting && <span className="badge-age">· reconnecting…</span>}
    </div>
  );
}
