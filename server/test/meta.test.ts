import { describe, expect, it } from 'vitest';
import { buildMeta } from '../src/refresh-loop.js';

const INTERVAL = 20_000;
const THRESHOLD = 2 * INTERVAL; // 40s

const t0 = Date.parse('2026-07-02T12:00:00Z');
const state = (lastSuccessMsAgo: number, nowMs: number) => ({
  lastSuccessAt: new Date(nowMs - lastSuccessMsAgo),
  degraded: false,
});

describe('staleness boundary (derived from last_success_at, threshold 2x interval)', () => {
  it('just under the threshold is NOT stale', () => {
    const meta = buildMeta(state(THRESHOLD - 1, t0), t0, INTERVAL);
    expect(meta.ageMs).toBe(THRESHOLD - 1);
    expect(meta.stale).toBe(false);
  });

  it('exactly at the threshold is NOT stale (strictly greater-than)', () => {
    expect(buildMeta(state(THRESHOLD, t0), t0, INTERVAL).stale).toBe(false);
  });

  it('just over the threshold IS stale', () => {
    const meta = buildMeta(state(THRESHOLD + 1, t0), t0, INTERVAL);
    expect(meta.ageMs).toBe(THRESHOLD + 1);
    expect(meta.stale).toBe(true);
  });

  it('before any success: null age, not stale, honest null timestamp', () => {
    const meta = buildMeta({ lastSuccessAt: null, degraded: false }, t0, INTERVAL);
    expect(meta.lastSuccessAt).toBeNull();
    expect(meta.ageMs).toBeNull();
    expect(meta.stale).toBe(false);
  });

  it('stale and degraded are independent: old data + healthy upstream flag', () => {
    const meta = buildMeta(state(THRESHOLD * 3, t0), t0, INTERVAL);
    expect(meta.stale).toBe(true);
    expect(meta.degraded).toBe(false);
  });
});
