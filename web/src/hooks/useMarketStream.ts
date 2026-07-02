import { useEffect, useRef, useState } from 'react';
import type { MarketSnapshot } from '@kin/types';

export type StreamStatus =
  /** First connection, nothing received yet. */
  | 'connecting'
  /** Live and receiving snapshots. */
  | 'open'
  /** Connection dropped; EventSource is auto-reconnecting behind the scenes. */
  | 'reconnecting'
  /** EventSource gave up permanently (readyState CLOSED). */
  | 'error';

export interface MarketStream {
  snapshot: MarketSnapshot | null;
  status: StreamStatus;
  /** Local ms timestamp of the last received snapshot, for client-side aging. */
  receivedAt: number | null;
}

/**
 * Subscribes to the server's SSE stream. The server pushes a full
 * MarketSnapshot on connect and after every successful refresh, so the UI
 * never polls — it just re-renders when data arrives.
 */
export function useMarketStream(url = '/api/stream'): MarketStream {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const hasData = useRef(false);

  useEffect(() => {
    const source = new EventSource(url);

    source.addEventListener('snapshot', (event) => {
      hasData.current = true;
      setSnapshot(JSON.parse((event as MessageEvent<string>).data));
      setReceivedAt(Date.now());
      setStatus('open');
    });

    source.onopen = () => setStatus('open');

    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        // Browser gave up (e.g. the endpoint 404s) — a real error state.
        setStatus('error');
      } else {
        // Normal drop: EventSource retries by itself; just reflect it.
        setStatus(hasData.current ? 'reconnecting' : 'connecting');
      }
    };

    return () => source.close();
  }, [url]);

  return { snapshot, status, receivedAt };
}
