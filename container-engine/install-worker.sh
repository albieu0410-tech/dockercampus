#!/bin/bash
set -e

# DockCampus Worker Node Installer
# Usage: bash install-worker.sh --endpoint https://api.sudelca.com --token YOUR_TOKEN

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

log()     { echo -e "${BOLD}[dockcampus]${RESET} $1"; }
success() { echo -e "${GREEN}[dockcampus]${RESET} $1"; }
warn()    { echo -e "${YELLOW}[dockcampus]${RESET} $1"; }
error()   { echo -e "${RED}[dockcampus]${RESET} $1"; exit 1; }

# Parse args
ENDPOINT=""
TOKEN=""
NODE_ID=$(hostname)

while [[ $# -gt 0 ]]; do
  case $1 in
    --endpoint) ENDPOINT="$2"; shift 2 ;;
    --token)    TOKEN="$2";    shift 2 ;;
    --node-id)  NODE_ID="$2";  shift 2 ;;
    *) error "Unknown argument: $1" ;;
  esac
done

[[ -z "$ENDPOINT" ]] && error "--endpoint is required (e.g. https://api.sudelca.com)"
[[ -z "$TOKEN" ]]    && error "--token is required"

log "Installing DockCampus worker node: $NODE_ID"
log "Queen endpoint: $ENDPOINT"

# ── 1. Dependencies ───────────────────────────────────────────────────────────
log "Checking dependencies..."

if ! command -v docker &>/dev/null; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  success "Docker installed"
else
  success "Docker already installed"
fi

if ! command -v wg &>/dev/null; then
  log "Installing WireGuard..."
  sudo apt-get update -qq
  sudo apt-get install -y wireguard-tools
  success "WireGuard installed"
else
  success "WireGuard already installed"
fi

# ── 2. Generate WireGuard keys ────────────────────────────────────────────────
log "Generating WireGuard keys..."
WG_PRIVATE=$(wg genkey)
WG_PUBLIC=$(echo "$WG_PRIVATE" | wg pubkey)
success "WireGuard keys generated"

# ── 3. Get node info ──────────────────────────────────────────────────────────
IP=$(hostname -I | awk '{print $1}')
RAM_TOTAL=$(free -g | awk '/^Mem:/{print $2}')
RAM_USED=$(free -g | awk '/^Mem:/{print $3}')
CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d. -f1)
DISK_TOTAL=$(df -BG / | awk 'NR==2{print $2}' | tr -d 'G')
DISK_USED=$(df -BG / | awk 'NR==2{print $3}' | tr -d 'G')

# ── 4. Join the Hive ─────────────────────────────────────────────────────────
log "Joining Hive at $ENDPOINT..."

RESPONSE=$(curl -s -X POST "$ENDPOINT/hive/join" \
  -H "Content-Type: application/json" \
  -d "{
    \"token\": \"$TOKEN\",
    \"node_id\": \"$NODE_ID\",
    \"host\": \"$(hostname)\",
    \"ip\": \"$IP\",
    \"role\": \"worker\",
    \"ram_used\": $RAM_USED,
    \"ram_total\": $RAM_TOTAL,
    \"cpu\": $CPU,
    \"disk_used\": $DISK_USED,
    \"disk_total\": $DISK_TOTAL,
    \"wireguard_public_key\": \"$WG_PUBLIC\",
    \"wireguard_allowed_ips\": \"$IP/32\"
  }")

ACCEPTED=$(echo "$RESPONSE" | grep -o '"accepted":true')
[[ -z "$ACCEPTED" ]] && error "Failed to join Hive: $RESPONSE"
success "Joined Hive successfully"

# ── 5. Save config ────────────────────────────────────────────────────────────
sudo mkdir -p /etc/dockcampus
sudo tee /etc/dockcampus/worker.conf > /dev/null <<EOF
ENDPOINT=$ENDPOINT
TOKEN=$TOKEN
NODE_ID=$NODE_ID
WG_PRIVATE=$WG_PRIVATE
WG_PUBLIC=$WG_PUBLIC
EOF
sudo chmod 600 /etc/dockcampus/worker.conf
success "Config saved to /etc/dockcampus/worker.conf"

# ── 6. Install heartbeat service ──────────────────────────────────────────────
log "Installing systemd heartbeat service..."

sudo tee /usr/local/bin/dockcampus-heartbeat > /dev/null <<'SCRIPT'
#!/bin/bash
source /etc/dockcampus/worker.conf

while true; do
    RAM_TOTAL=$(free -g | awk '/^Mem:/{print $2}')
    RAM_USED=$(free -g | awk '/^Mem:/{print $3}')
    CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d. -f1)
    DISK_TOTAL=$(df -BG / | awk 'NR==2{print $2}' | tr -d 'G')
    DISK_USED=$(df -BG / | awk 'NR==2{print $3}' | tr -d 'G')
    CONTAINERS=$(docker ps -q 2>/dev/null | wc -l)

    curl -s -X POST "$ENDPOINT/hive/heartbeat" \
      -H "Content-Type: application/json" \
      -d "{
        \"token\": \"$TOKEN\",
        \"node_id\": \"$NODE_ID\",
        \"ram_used\": $RAM_USED,
        \"ram_total\": $RAM_TOTAL,
        \"cpu\": $CPU,
        \"disk_used\": $DISK_USED,
        \"disk_total\": $DISK_TOTAL,
        \"deployments\": $CONTAINERS
      }" > /dev/null

    sleep 30
done
SCRIPT

sudo chmod +x /usr/local/bin/dockcampus-heartbeat

sudo tee /etc/systemd/system/dockcampus-worker.service > /dev/null <<EOF
[Unit]
Description=DockCampus Worker Node
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/dockcampus-heartbeat
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable dockcampus-worker
sudo systemctl start dockcampus-worker
success "Heartbeat service installed and started"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
success "Worker node '$NODE_ID' is now part of the Hive!"
log "Check status: sudo systemctl status dockcampus-worker"
log "View logs:    sudo journalctl -u dockcampus-worker -f"