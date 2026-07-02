# Design Decisions

The trade-offs behind this codebase, one section per decision.

## 1. One shared background refresh loop (vs per-request fetching or webhooks)

**Decision:** a single `setTimeout`-driven loop in the server process is the *only*
code that calls CoinGecko. It runs on its own clock, whether zero or ten thousand
clients are connected.

**Why:** the moment user requests can trigger upstream calls, upstream cost scales
with traffic — O(users) — and a burst of visitors becomes a self-inflicted 429.
With one loop, upstream cost is O(1): ~3 requests/minute at the default 20s interval,
comfortably inside CoinGecko's free-tier budget, *by construction* rather than by
rate-limiter tuning. It also gives every client the same consistent snapshot.

**Alternatives rejected:**
- *Fetch-on-request with a TTL cache* — better than nothing, but cold-cache stampedes
  still couple traffic to upstream cost, and an idle period means the first visitor
  waits on a slow upstream call.
- *Webhooks/push from the provider* — CoinGecko's free tier doesn't offer one; not
  available, so not a real option.

**Cost accepted:** we poll even when nobody is watching. At 3 req/min that's negligible.

## 2. SSE (vs WebSocket vs client polling)

**Decision:** Server-Sent Events for the live feed.

**Why:** the data flow is strictly one-directional — server pushes market snapshots,
the client sends nothing back. SSE is exactly that primitive, over plain HTTP:
no protocol upgrade, works through ordinary proxies, and the browser's `EventSource`
**auto-reconnects natively** (we even tune it with a `retry:` hint). Less code on both
sides and fewer failure modes.

**Alternatives rejected:**
- *WebSocket* — bidirectional capability we would never use, at the price of upgrade
  handshakes, ping/pong management, and a reconnect layer we'd have to write ourselves.
- *Client polling* — simplest, but N clients polling every 5s is N× the server traffic
  for worse latency, and it reintroduces "how fresh am I?" jitter per client.

**Cost accepted:** SSE is one long-lived connection per tab and is HTTP/1.1-limited to
~6 per origin; irrelevant at this scale.

## 3. Postgres with this specific schema (vs NoSQL / Timescale / one table)

**Decision:** three tables —
- `coins`: denormalized current state, one row per coin, upserted every tick.
  This table **is** the last-known-good fallback and survives restarts.
- `price_snapshots`: append-only time series (`coin_id`, price, `fetched_at`),
  indexed `(coin_id, fetched_at DESC)` to match its only query: "this coin, recent window".
- `feed_status`: one row (enforced by `CHECK (id = 1)`) holding
  `last_success_at` / `last_error` / `degraded` — feed health survives restarts too.

**Why:** the two read patterns are different. "Current top 20" wants one cheap ordered
read of 20 rows; "price history for coin X" wants an index range scan. Separating
current state from history keeps both trivial and keeps history writes append-only.
Relational + real timestamps + a proper index is exactly this shape of data.

**Alternatives rejected:**
- *NoSQL document store* — no schema/type enforcement, and time-range queries are the
  workload; this is squarely relational territory.
- *TimescaleDB* — the right call at millions of rows/day. At 20 coins × 3/min ≈ 86k
  rows/day, a btree index plus a retention sweep (hourly `DELETE` of >24h rows) does
  the same job with zero extra moving parts. The upgrade path is a hypertable later.
- *Snapshots only, derive current state* — makes the hot read (`latest per coin`) a
  `DISTINCT ON` query instead of a primary-key table, for no benefit.

## 4. In-memory snapshot cache now, Redis when multi-instance

**Decision:** the loop keeps the latest snapshot in process memory; `/api/coins` and
new SSE connections are served from it (zero DB work per request). Postgres is the
durable copy used to warm-start after a restart.

**Why:** with a single API instance, an in-process object IS the correct cache —
Redis here would be an extra network hop, an extra container, and an extra failure
mode to answer the same question. YAGNI.

**When it changes:** more than one API replica behind a load balancer needs shared
state: move the snapshot to Redis and fan out refreshes via pub/sub (each instance
still serves SSE from memory). The seam already exists — the loop's storage and
fetcher are injected — so the change is localized.

## 5. CoinGecko + rate-limit strategy

**Decision:** CoinGecko's free `/coins/markets` endpoint — one HTTP call returns all
20 coins with price, 24h change, market cap, rank, and icon. **No API key required**,
which also means no secret handling in a take-home repo.

**Rate-limit strategy is architectural, not reactive:** the shared loop caps us at
~3 calls/min regardless of load (their free tier allows roughly 10–30/min). If we're
throttled anyway (429) or the API hiccups, the failure model below takes over —
we never retry in a tight loop, so we never make an outage worse.

## 6. Failure model: capped exponential backoff + last-known-good

**Decision:** any tick failure (429, 5xx, timeout, DB error) means: flag
`degraded`, leave the cache and DB untouched, and schedule the next attempt at
`interval × 2^(failures-1)` capped at 5 minutes — 20s, 40s, 80s, 160s, 300s.
First success resets everything.

**Why:** two principles. (1) *Never amplify an upstream outage* — backoff is polite to
a struggling provider and is what keeps a 429 from snowballing. (2) *Stale data
honestly labeled beats no data* — for a market dashboard, yesterday's price with a
red "upstream unavailable" badge is useful; an error page is not. The server keeps
serving, the UI keeps rendering, the badge tells the truth.

**Alternatives rejected:**
- *Fail the request when upstream fails* — punishes users for a third party's outage.
- *Fixed retry interval* — either too slow to recover (long fixed) or a retry storm
  (short fixed). Exponential-with-cap recovers fast from blips and stays calm in
  long outages.
- *Circuit breaker library* — a full breaker (half-open probes, failure-rate windows)
  duplicates what backoff already gives a single-caller system; there is exactly one
  call site, so the loop's own counter is the breaker.

## 7. Freshness derived from `last_success_at` (not from the last request's outcome)

**Decision:** every payload carries `meta` computed from the last *successful* fetch:
`ageMs` (now − last_success_at), `stale` (age > 2× refresh interval), `degraded`
(currently failing). The UI maps this to green / amber / red and ages it locally
every second.

**Why:** "our last request succeeded" says nothing about how old the data is — the
loop might have been backing off for ten minutes before that success, or the process
might have just rebooted from a warm DB. The success timestamp is the single honest
signal, and it composes: `stale` can be true while `degraded` is false (slow but
healthy) and vice versa (one blip, data still fresh).

**Why 2× interval:** one missed tick is normal jitter (timeouts, slow responses);
two missed ticks means we're genuinely behind. Tying the threshold to the configured
interval keeps it meaningful if someone tunes `REFRESH_INTERVAL_MS`.

## 8. Smaller calls, briefly

- **Shared `packages/types`** — server and web import the same `Coin`/`MarketSnapshot`
  types, so the contract can't silently drift; Fastify response schemas enforce it at
  runtime on the wire.
- **Idempotent `CREATE TABLE IF NOT EXISTS` migrations on boot** — a numbered
  migration framework earns its keep when schemas evolve under load; a take-home with
  a fixed schema needs "safe to run twice", nothing more.
- **Dependency injection by hand** (constructor args, no DI framework) — the refresh
  loop and routes take `fetchMarkets` and a `MarketRepo` interface; tests swap in
  fakes and run with no network and no database.
- **nginx serves the web build** and proxies `/api` with buffering off (SSE would
  freeze behind a buffering proxy) — same-origin in prod exactly like the Vite proxy
  in dev, so the frontend code has no environment-specific URLs.
- **NUMERIC parsed to float** at the driver boundary — display precision is fine for
  prices in a dashboard; money-movement code would keep strings/decimals instead.
