# Setup & Evaluation Guide

Everything needed to run and evaluate the Real-Time Crypto Market Dashboard.
Target time from clone to running app: **under two minutes**, one command, no API key.

---

## 1. Prerequisites

- **Docker** with the Compose plugin (Docker Desktop on macOS/Windows, or Docker Engine + `docker compose` on Linux). That's the only requirement.
- No API key, no accounts, no secrets. The upstream data source (CoinGecko) is free and unauthenticated.

Check your Docker is ready:

```bash
docker --version          # any recent version
docker compose version    # v2.x (the "compose plugin")
```

---

## 2. Run it — one command

```bash
git clone https://github.com/danielt69/kin-crypto-dashboard.git
cd kin-crypto-dashboard
docker compose up
```

Compose builds three services and wires them together:

| Service | What it is | Where |
|---|---|---|
| `db`  | PostgreSQL 16 | internal only |
| `api` | Fastify server + the single shared refresh loop + SSE | `http://localhost:3001` |
| `web` | React build served by nginx (proxies `/api` to `api`) | **`http://localhost:8080`** |

Then open **http://localhost:8080**.

> First boot takes ~20–40s to build the images. The API waits for Postgres to be
> healthy (compose `depends_on: condition: service_healthy`), so you never see a
> connection-refused race.

To run detached: `docker compose up -d --build`. To stop and wipe the database
volume: `docker compose down -v`.

---

## 3. What you should see

1. **Live table** of the top-20 coins — rank, icon, name/symbol, price, 24h % (green up / red down), market cap.
2. A **freshness badge** near the top: `updated Ns ago`, ticking every second and turning over roughly every 20s as the shared refresh loop pushes a new snapshot over SSE. **No manual refresh** — leave the tab open and watch it update itself.
3. **Click any coin** → a detail panel showing its **last-hour price history**. This is read from *our* `price_snapshots` table, not a fresh upstream call — it fills in as the loop records more snapshots.

---

## 4. Evaluating the headline requirement (graceful degradation)

The core of this assessment is: *the app must serve the freshest data available and
behave sensibly when upstream is slow, rate-limited, or down.* Here is how to prove it
in ~30 seconds — point the server at a dead upstream and watch it **degrade, not fall over**:

```bash
# Simulate CoinGecko being unreachable, then recreate just the api container.
COINGECKO_BASE_URL=http://127.0.0.1:9 docker compose up -d --force-recreate api
```

Now reload the dashboard. You will see:

- The freshness badge flips to a red **"upstream unavailable — showing last-known-good"** state.
- **The table stays fully populated** — every price is the last-known-good value served from Postgres.
- Every endpoint still returns **HTTP 200**. Nothing 500s. The server logs show capped
  exponential backoff (20s → 40s → 80s …), never a retry storm.

Restore normal operation:

```bash
docker compose up -d --force-recreate api
```

The badge returns to green within one refresh cycle. This "stale but up, never down"
behaviour is the whole point of the single shared refresh loop + last-known-good store.

---

## 5. Poke the API directly (optional)

```bash
curl http://localhost:3001/api/coins | jq '.meta'          # freshness metadata
curl http://localhost:3001/api/coins/bitcoin/history | jq   # history from OUR db
curl http://localhost:3001/health                           # liveness + feed health
# SSE stream (Ctrl-C to stop):
curl -N http://localhost:3001/api/stream
```

`meta` looks like: `{ "lastSuccessAt": "…", "ageMs": 4200, "degraded": false, "stale": false }`.
`stale` becomes `true` once `ageMs` exceeds **2×** the refresh interval — freshness is
derived from the last *successful* fetch, so the user is never shown silently-stale data.

---

## 6. Configuration (all optional, sane defaults)

Set via environment (or a root `.env` — see `.env.example`). None are required.

| Variable | Default | Meaning |
|---|---|---|
| `REFRESH_INTERVAL_MS` | `20000` | How often the shared loop polls CoinGecko. Staleness threshold = 2× this. |
| `WEB_PORT` | `8080` | Host port for the dashboard. Set `WEB_PORT=80` for a clean URL. |
| `API_PORT` | `3001` | Host port for the API. |
| `MAX_BACKOFF_MS` | `300000` | Ceiling for exponential backoff when upstream fails. |
| `SNAPSHOT_RETENTION_MS` | `86400000` | History retention before the hourly sweep prunes it. |
| `COINGECKO_BASE_URL` | CoinGecko v3 | Upstream base URL (used above to simulate an outage). |

Example — faster refresh on a clean port 80:

```bash
WEB_PORT=80 REFRESH_INTERVAL_MS=10000 docker compose up
```

---

## 7. Run without Docker (native)

```bash
# 1. a local Postgres reachable at postgres://kin:kin@localhost:5432/kin_crypto
#    (or export DATABASE_URL to point at yours)
createdb kin_crypto

# 2. install + build the shared types, then run each tier
npm install
npm run dev:server   # terminal A — API on :3001, runs migrations on boot
npm run dev:web      # terminal B — web on :5173, proxies /api to :3001
```

Open http://localhost:5173.

---

## 8. Tests

```bash
npm install
npm test     # vitest — 16 tests, incl. the upstream-failure fallback path
```

---

## 9. Troubleshooting

- **Port already in use** → override it: `WEB_PORT=9090 API_PORT=3999 docker compose up`.
- **Reset the database** → `docker compose down -v` (drops the `pgdata` volume), then `docker compose up`.
- **Watch API logs** → `docker compose logs -f api` (you'll see refresh ticks, backoff, recovery).
- **Rebuild from scratch** → `docker compose build --no-cache`.
