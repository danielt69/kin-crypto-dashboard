#!/usr/bin/env bash
#
# One-command DigitalOcean deploy for testing.
#
# Spins up an Ubuntu droplet, installs Docker, clones this repo, and runs
# `docker compose up` — then prints the live URL. Tear it down with `destroy`.
#
#   ./scripts/deploy-do.sh up                 # create + deploy, prints http://<IP>
#   ./scripts/deploy-do.sh destroy            # delete the droplet (stops billing)
#
# Prerequisites (one-time):
#   1. brew install doctl        (or https://docs.digitalocean.com/reference/doctl/how-to/install/)
#   2. doctl auth init           (paste a DO API token from cloud.digitalocean.com/account/api)
#   3. (optional) add an SSH key to your DO account so you can `ssh root@<IP>`.
#
# Config via env (all optional):
#   DROPLET_NAME   default: kin-crypto-test
#   DO_REGION      default: nyc1
#   DO_SIZE        default: s-1vcpu-1gb  (~$6/mo — destroy when done)
#   REPO_URL       default: https://github.com/danielt69/kin-crypto-dashboard.git
#   GITHUB_TOKEN   if set, clones a PRIVATE repo (so you can test before going public)
#   WEB_PORT       default: 80  (dashboard served here → http://<IP>)
#
set -euo pipefail

DROPLET_NAME="${DROPLET_NAME:-kin-crypto-test}"
DO_REGION="${DO_REGION:-nyc1}"
DO_SIZE="${DO_SIZE:-s-1vcpu-1gb}"
DO_IMAGE="ubuntu-24-04-x64"
REPO_URL="${REPO_URL:-https://github.com/danielt69/kin-crypto-dashboard.git}"
WEB_PORT="${WEB_PORT:-80}"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

command -v doctl >/dev/null 2>&1 || die "doctl not found. Install it and run 'doctl auth init' first."
doctl account get >/dev/null 2>&1 || die "doctl is not authenticated. Run 'doctl auth init'."

# If cloning a private repo, embed the token in the clone URL used on the droplet.
CLONE_URL="$REPO_URL"
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  CLONE_URL="https://${GITHUB_TOKEN}@${REPO_URL#https://}"
fi

cmd_up() {
  # Reuse an existing droplet if one is already up under this name.
  if doctl compute droplet list --format Name --no-header | grep -qx "$DROPLET_NAME"; then
    log "Droplet '$DROPLET_NAME' already exists — reusing it."
  else
    # cloud-init: install docker, clone, compose up. Runs once on first boot.
    local userdata_file
    userdata_file="$(mktemp)"
    trap 'rm -f "$userdata_file"' RETURN
    cat > "$userdata_file" <<EOF
#cloud-config
package_update: true
runcmd:
  - curl -fsSL https://get.docker.com | sh
  - git clone ${CLONE_URL} /opt/app
  - cd /opt/app && WEB_PORT=${WEB_PORT} docker compose up -d --build
EOF

    # Attach every SSH key on the account (so you can shell in). None is fine too.
    local ssh_ids
    ssh_ids="$(doctl compute ssh-key list --format ID --no-header | paste -sd, - || true)"
    local ssh_flag=()
    [[ -n "$ssh_ids" ]] && ssh_flag=(--ssh-keys "$ssh_ids")

    log "Creating droplet '$DROPLET_NAME' ($DO_SIZE, $DO_REGION)…"
    doctl compute droplet create "$DROPLET_NAME" \
      --image "$DO_IMAGE" --size "$DO_SIZE" --region "$DO_REGION" \
      "${ssh_flag[@]}" \
      --user-data-file "$userdata_file" \
      --wait --format ID,PublicIPv4 --no-header
  fi

  local ip
  ip="$(doctl compute droplet get "$DROPLET_NAME" --format PublicIPv4 --no-header)"
  [[ -n "$ip" ]] || die "Could not determine droplet IP."

  log "Droplet is up at $ip. Docker is building the app (first boot ~2–4 min)…"
  local url="http://${ip}"
  [[ "$WEB_PORT" != "80" ]] && url="http://${ip}:${WEB_PORT}"

  # Poll /health until the stack is serving (build + pull takes a few minutes).
  local i
  for i in $(seq 1 60); do
    if curl -fsS --max-time 4 "${url}/health" >/dev/null 2>&1; then
      log "Live and healthy:"
      printf '\n    \033[1;32m%s\033[0m\n\n' "$url"
      log "Health: $(curl -fsS "${url}/health")"
      log "Tear down when done:  ./scripts/deploy-do.sh destroy"
      return 0
    fi
    sleep 10
  done

  err "Droplet is up at $url but /health didn't respond within ~10 min."
  err "SSH in and check:  ssh root@${ip}  then  cd /opt/app && docker compose logs"
  return 1
}

cmd_destroy() {
  if doctl compute droplet list --format Name --no-header | grep -qx "$DROPLET_NAME"; then
    log "Destroying droplet '$DROPLET_NAME'…"
    doctl compute droplet delete "$DROPLET_NAME" -f
    log "Destroyed. Billing stopped."
  else
    log "No droplet named '$DROPLET_NAME' — nothing to destroy."
  fi
}

case "${1:-up}" in
  up|deploy|create) cmd_up ;;
  destroy|down|rm)  cmd_destroy ;;
  *) die "Usage: $0 {up|destroy}" ;;
esac
