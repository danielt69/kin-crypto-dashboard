# Real-Time Crypto Market Dashboard

A three-tier app that shows the top-20 cryptocurrencies live: **React + Vite** frontend,
**Fastify (Node + TypeScript)** API, **PostgreSQL** storage, fed by CoinGecko and streamed
to the browser over **Server-Sent Events**. The table sorts and filters client-side and
flashes rows on live price ticks — all derived from the one SSE snapshot, no extra API calls.

The design goal: **upstream cost is O(1) in users, and the app degrades to
"stale but up", never "down".** The browser never talks to CoinGecko — one background
loop on the server does, no matter how many clients are connected.

> **Just want to run it?** See **[SETUP.md](./SETUP.md)** — one command, no API key, plus
> how to demo the graceful-degradation behaviour. To run it on a cloud host with a live
> URL, see **[DEPLOY.md](./DEPLOY.md)** (DigitalOcean + Docker). Design rationale is in
> **[DECISIONS.md](./DECISIONS.md)**.

### Deploy it live — one click, no install

[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/danielt69/kin-crypto-dashboard/tree/main)

Opens DigitalOcean App Platform in the browser and provisions a managed Postgres + the
API + the web build from [`.do/deploy.template.yaml`](./.do/deploy.template.yaml) — no CLI,
no local Docker. (Requires a DigitalOcean login and this repo to be public. App Platform is
a managed runtime, distinct from the `docker compose` path in SETUP.md.)

## Architecture

```
                        ┌────────────────────────── server ──────────────────────────┐
                        │                                                             │
  CoinGecko  ◄──────────┤  refresh loop (every 20s, the ONLY upstream caller)         │
  /coins/markets        │      │                                                      │
  (free, no API key)    │      ├─► upsert `coins` (last-known-good current state)     │
                        │      ├─► append `price_snapshots` (time series)   ──► Postgres
                        │      ├─► stamp `feed_status.last_success_at`               │
                        │      ├─► update in-memory snapshot                          │
                        │      └─► broadcast to all SSE clients                       │
                        │                                                             │
   browser  ◄───────────┤  GET /api/stream   (SSE: snapshot events + pings)           │
   (React)  ───────────►│  GET /api/coins    (in-memory snapshot, zero DB/upstream)   │
                        │  GET /api/coins/:id/history  (range scan on snapshots)      │
                        │  GET /health                                                │
                        └─────────────────────────────────────────────────────────────┘
```

On upstream failure the loop backs off exponentially (20s → 40s → 80s → … → 300s cap),
flags the feed `degraded`, and keeps serving the last-known-good rows. Freshness is
derived from the last **success** timestamp, so the UI is always honest about data age.

The API contract lives in one shared package, [`packages/types`](packages/types/src/index.ts),
imported by both server and web. The reasoning behind every major choice is in
[DECISIONS.md](DECISIONS.md).

## Run it — one command (Docker)

```sh
docker compose up
```

Then open **http://localhost:8080**. The API is on http://localhost:3001
(`curl localhost:3001/health`). No API key needed anywhere — CoinGecko's
`/coins/markets` endpoint is free and anonymous.

## Run it — native dev

Prereqs: Node 20+, a local Postgres (any recent version).

```sh
# 1. create a database (once)
createdb kin_crypto            # or: CREATE DATABASE kin_crypto;

# 2. install + build the shared types package
npm install

# 3. terminal A — API on :3001 (set DATABASE_URL if yours differs
#    from postgres://kin:kin@localhost:5432/kin_crypto)
DATABASE_URL=postgres://$(whoami)@localhost:5432/kin_crypto npm run dev:server

# 4. terminal B — web on :5173 (proxies /api to :3001)
npm run dev:web
```

Tables are created automatically on server boot (idempotent migrations).
All config knobs are documented in [.env.example](.env.example).

## Verify

```sh
npm test             # vitest: failure-fallback, staleness, history, rate-limit invariant
npm run typecheck    # tsc --noEmit across types, server (incl. tests), web
npm run lint         # eslint across the monorepo
npm run build        # compiles all three workspaces
```

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/coins` | `{ data: Coin[], meta: { lastSuccessAt, ageMs, degraded, stale } }` |
| GET | `/api/coins/:id/history?window=1h\|24h` | `{ coin, points: { priceUsd, fetchedAt }[] }` — from **our** DB, never a fresh upstream call |
| GET | `/api/stream` | SSE; `snapshot` event with the `{data, meta}` payload on every refresh, `: ping` comments in between |
| GET | `/health` | `{ status: "ok", degraded, lastSuccessAt }` |

## Design decisions (short version)

- **One shared refresh loop** — the only upstream caller; requests and SSE clients
  never trigger fetches, so CoinGecko sees a constant ~3 req/min.
- **SSE over WebSocket** — traffic is strictly server→client; SSE is plain HTTP with
  built-in auto-reconnect and a far smaller surface.
- **Postgres, three tables** — `coins` (current state / last-known-good),
  `price_snapshots` (append-only series for history), `feed_status` (single health row).
- **Freshness from `last_success_at`** — the honest signal; `stale` = age > 2× interval,
  `degraded` = upstream currently failing.
- **In-memory snapshot cache** — correct for a single instance; the Redis/pub-sub
  upgrade path for multi-instance is written down in DECISIONS.md.

Full trade-off discussion: [DECISIONS.md](DECISIONS.md).
