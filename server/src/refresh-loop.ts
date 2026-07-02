import type { Coin, MarketSnapshot, SnapshotMeta } from '@kin/types';
import type { MarketsFetcher } from './coingecko.js';
import type { MarketRepo } from './db/repo.js';

export interface RefreshLoopOptions {
  fetchMarkets: MarketsFetcher;
  repo: MarketRepo;
  intervalMs: number;
  maxBackoffMs: number;
  snapshotRetentionMs: number;
  /** Injectable clock so tests control time. */
  now?: () => Date;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
}

/** In-memory mirror of feed health; persisted copy lives in feed_status. */
interface FeedState {
  lastSuccessAt: Date | null;
  degraded: boolean;
}

/**
 * Derive freshness for a payload. Deliberately based on the last SUCCESS,
 * not the last attempt: "we got a 200 five minutes ago" is the honest
 * freshness signal, "our most recent request happened to work" is not.
 */
export function buildMeta(state: FeedState, nowMs: number, intervalMs: number): SnapshotMeta {
  const lastSuccessAt = state.lastSuccessAt;
  const ageMs = lastSuccessAt ? nowMs - lastSuccessAt.getTime() : null;
  return {
    lastSuccessAt: lastSuccessAt ? lastSuccessAt.toISOString() : null,
    ageMs,
    degraded: state.degraded,
    // Stale = we've missed at least one full refresh cycle beyond the last one.
    stale: ageMs !== null && ageMs > 2 * intervalMs,
  };
}

/**
 * THE single background refresh loop — the only code path in the entire app
 * that talks to CoinGecko. It runs on its own timer, independent of HTTP
 * traffic: 1 user or 10,000 users cost the upstream exactly the same.
 *
 * Failure model: on any upstream error we back off exponentially
 * (interval x2 per consecutive failure, capped), flag the feed degraded, and
 * keep serving the last-known-good data already in memory/Postgres. The app
 * degrades to "stale but up", never "down".
 */
export class RefreshLoop {
  private readonly opts: Required<Pick<RefreshLoopOptions, 'now' | 'log'>> & RefreshLoopOptions;
  private cache: Coin[] = [];
  private state: FeedState = { lastSuccessAt: null, degraded: false };
  private consecutiveFailures = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastSweepMs = 0;
  private readonly listeners = new Set<(snapshot: MarketSnapshot) => void>();

  constructor(options: RefreshLoopOptions) {
    this.opts = { now: () => new Date(), log: console, ...options };
  }

  /**
   * Warm start: restore cache + feed health from Postgres so a restarted
   * server serves last-known-good data immediately, even if CoinGecko is
   * down at boot.
   */
  async init(): Promise<void> {
    this.cache = await this.opts.repo.getCoins();
    const status = await this.opts.repo.getFeedStatus();
    this.state = { lastSuccessAt: status.lastSuccessAt, degraded: status.degraded };
  }

  /** Kick off the first tick immediately, then self-schedule. */
  start(): void {
    this.stopped = false;
    void this.runTick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Subscribe to successful refreshes (used by the SSE route). Returns unsubscribe. */
  onSnapshot(listener: (snapshot: MarketSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Current payload for /api/coins and for newly connected SSE clients. */
  snapshot(): MarketSnapshot {
    return {
      data: this.cache,
      meta: buildMeta(this.state, this.opts.now().getTime(), this.opts.intervalMs),
    };
  }

  /**
   * One refresh cycle. Public so tests can drive it directly without timers.
   * Never throws: every failure path ends in "keep last-known-good and back off".
   */
  async tick(): Promise<void> {
    const now = this.opts.now();
    try {
      const coins = await this.opts.fetchMarkets();
      await this.opts.repo.saveMarketTick(coins, now);

      this.cache = coins.map((c) => ({ ...c, updatedAt: now.toISOString() }));
      this.state = { lastSuccessAt: now, degraded: false };
      if (this.consecutiveFailures > 0) {
        this.opts.log.info(`refresh loop: recovered after ${this.consecutiveFailures} failure(s)`);
      }
      this.consecutiveFailures = 0;

      const snapshot = this.snapshot();
      for (const listener of this.listeners) listener(snapshot);

      await this.maybeSweep(now);
    } catch (err) {
      // Failure of any kind (429, 5xx, timeout, DB error): flag degraded,
      // keep the cache untouched, and let the scheduler back off.
      this.consecutiveFailures += 1;
      this.state = { ...this.state, degraded: true };
      const message = err instanceof Error ? err.message : String(err);
      this.opts.log.warn(
        `refresh loop: tick failed (${this.consecutiveFailures} consecutive): ${message}`
      );
      await this.opts.repo
        .recordFailure(message, now)
        .catch((e) => this.opts.log.error(`refresh loop: could not persist failure: ${e}`));
    }
  }

  /** Delay before the next tick: normal cadence, or capped exponential backoff. */
  nextDelayMs(): number {
    if (this.consecutiveFailures === 0) return this.opts.intervalMs;
    // 1 failure -> interval, 2 -> 2x, 3 -> 4x ... capped. With the 20s
    // default that's 20s, 40s, 80s, 160s, 300s (cap) — no retry storm on 429.
    const backoff = this.opts.intervalMs * 2 ** (this.consecutiveFailures - 1);
    return Math.min(backoff, this.opts.maxBackoffMs);
  }

  private async runTick(): Promise<void> {
    await this.tick();
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.runTick(), this.nextDelayMs());
    // Don't let the pending timer keep the process alive on shutdown.
    this.timer.unref();
  }

  /** Cheap retention: once an hour, drop snapshots older than the retention window. */
  private async maybeSweep(now: Date): Promise<void> {
    const HOUR = 60 * 60 * 1000;
    if (now.getTime() - this.lastSweepMs < HOUR) return;
    this.lastSweepMs = now.getTime();
    const cutoff = new Date(now.getTime() - this.opts.snapshotRetentionMs);
    const deleted = await this.opts.repo.deleteSnapshotsBefore(cutoff);
    if (deleted > 0) this.opts.log.info(`retention sweep: deleted ${deleted} old snapshot(s)`);
  }
}
