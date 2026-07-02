# Deploy to DigitalOcean (Docker)

Run the whole stack on a clean Ubuntu droplet with Docker — useful for a live demo
URL and to prove `docker compose up` works on a real Linux host. Total time ~5 minutes.
Cost: a `s-1vcpu-1gb` droplet is ~$6/month — **destroy it after the interview** (§6).

> The repo must be **public** for the droplet to clone it without credentials
> (it needs to be public for submission anyway). If you'd rather keep it private,
> see the private-repo note at the end of §2.

---

## Option A — One-shot with cloud-init (recommended)

DigitalOcean can run a provisioning script on first boot. You paste this once and the
droplet installs Docker, clones the repo, and starts the app automatically.

1. **Create → Droplets** in the DigitalOcean console.
2. Image: **Ubuntu 24.04 LTS**. Plan: **Basic → Regular → $6/mo** (1 GB / 1 vCPU is plenty).
3. Choose a region near you, add your **SSH key**.
4. Expand **Advanced options → Add Initialization scripts (user data)** and paste:

```yaml
#cloud-config
runcmd:
  - curl -fsSL https://get.docker.com | sh
  - git clone https://github.com/danielt69/kin-crypto-dashboard.git /opt/app
  - cd /opt/app && WEB_PORT=80 docker compose up -d --build
```

5. Create the droplet. Wait ~2–3 minutes for it to boot and provision.
6. Open **`http://<DROPLET_IP>`** in your browser. Done — the live dashboard.

`WEB_PORT=80` maps the dashboard to the standard HTTP port so the demo URL is just the
droplet IP (no `:8080`).

---

## Option B — Manual (full control)

Create the droplet as in Option A (skip the user-data step), then SSH in:

```bash
ssh root@<DROPLET_IP>

# Install Docker + compose plugin
curl -fsSL https://get.docker.com | sh

# Clone and run
git clone https://github.com/danielt69/kin-crypto-dashboard.git /opt/app
cd /opt/app
WEB_PORT=80 docker compose up -d --build

# Watch it come up
docker compose ps
docker compose logs -f api    # Ctrl-C to stop tailing
```

Browse to `http://<DROPLET_IP>`.

---

## 1. Firewall

The `get.docker.com` install doesn't enable `ufw`, so ports are open by default. If you
turn on the DigitalOcean Cloud Firewall (or `ufw`), allow **22** (SSH) and **80** (web):

```bash
ufw allow 22/tcp && ufw allow 80/tcp && ufw --force enable
```

The `api` and `db` ports don't need to be public — the browser talks only to the web
service on :80, and nginx proxies `/api` to the api container over the internal Docker
network.

---

## 2. Verify

```bash
curl http://<DROPLET_IP>/health
# {"status":"ok","degraded":false,"lastSuccessAt":"…"}
```

Open the dashboard, confirm the table populates and the freshness badge ticks.

**Private-repo alternative:** if the repo is still private, either (a) clone over SSH
with a deploy key, or (b) `scp` the project up and `docker compose up -d --build` there.
Public is simplest and is required for submission regardless.

---

## 3. Demo the graceful-degradation requirement (live)

On the droplet:

```bash
cd /opt/app
# point the server at a dead upstream and recreate just the api container
COINGECKO_BASE_URL=http://127.0.0.1:9 WEB_PORT=80 docker compose up -d --force-recreate api
```

Reload the dashboard: badge turns red ("upstream unavailable — showing last-known-good"),
the table stays fully populated, everything still returns HTTP 200. Restore:

```bash
WEB_PORT=80 docker compose up -d --force-recreate api
```

---

## 4. Updating after a push

```bash
cd /opt/app && git pull && WEB_PORT=80 docker compose up -d --build
```

---

## 5. Logs & health

```bash
docker compose ps
docker compose logs -f api     # refresh ticks, backoff, recovery
docker compose logs -f web
```

---

## 6. Teardown (do this after the interview)

Destroy the droplet from the DigitalOcean console (**Droplet → Destroy**), or via `doctl`:

```bash
doctl compute droplet delete <droplet-name>
```

Destroying the droplet stops all billing. There are no other resources to clean up.
