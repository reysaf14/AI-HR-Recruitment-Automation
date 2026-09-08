#!/usr/bin/env bash
# ============================================================
# AI HR Recruitment Automation — VPS Deploy Script
# Ubuntu 24.04 LTS | Non-Docker | n8n 1.45.0
# Jalankan: chmod +x deploy.sh && sudo ./deploy.sh
# ============================================================

set -euo pipefail

# ---------------------------
# CONFIG — EDIT BAGIAN INI
# ---------------------------
DOMAIN="n8n.yourdomain.com"          # GANTI: domain Anda
SSL_EMAIL="admin@yourdomain.com"     # GANTI: email untuk Certbot
N8N_USER="n8n"                       # User sistem untuk n8n
PROJECT_DIR="/home/${N8N_USER}/ai-hr-recruitment"
N8N_VERSION="1.45.0"
N8N_PORT=5678
TIMEZONE="Asia/Jakarta"

# ---------------------------
# WARNA OUTPUT
# ---------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()   { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERR]${NC} $*"; exit 1; }

# ---------------------------
# CEK ROOT
# ---------------------------
[[ $EUID -eq 0 ]] || err "Jalankan dengan sudo: sudo ./deploy.sh"

# ---------------------------
# KONFIRMASI DOMAIN
# ---------------------------
echo -e "${YELLOW}=== KONFIGURASI ====${NC}"
echo "Domain:      ${DOMAIN}"
echo "SSL Email:   ${SSL_EMAIL}"
echo "Project Dir: ${PROJECT_DIR}"
echo "n8n Version: ${N8N_VERSION}"
echo "Port:        ${N8N_PORT}"
read -rp "Lanjutkan? (y/N): " CONFIRM
[[ "${CONFIRM,,}" == "y" ]] || err "Dibatalkan."

# ---------------------------
# 1. SYSTEM UPDATE & DEPS
# ---------------------------
log "Update system & install dependencies..."
apt update && apt upgrade -y
apt install -y nodejs npm nginx certbot python3-certbot-nginx git curl ufw

# Verifikasi Node
NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
[[ $NODE_VER -ge 18 ]] || err "Node.js >= 18 required, found $(node --version)"
ok "Node.js $(node --version), npm $(npm --version)"

# ---------------------------
# 2. INSTALL N8N GLOBAL
# ---------------------------
log "Install n8n@${N8N_VERSION} global..."
npm install -g "n8n@${N8N_VERSION}"
ok "n8n $(n8n --version) installed"

# ---------------------------
# 3. BUAT USER & FOLDER
# ---------------------------
log "Setup user ${N8N_USER} & folder..."
id -u "${N8N_USER}" &>/dev/null || useradd -m -s /bin/bash "${N8N_USER}"
usermod -aG sudo "${N8N_USER}"

sudo -u "${N8N_USER}" mkdir -p \
  "${PROJECT_DIR}/n8n-workflows" \
  "${PROJECT_DIR}/scripts" \
  "${PROJECT_DIR}/config" \
  "${PROJECT_DIR}/backup" \
  "${PROJECT_DIR}/buffer"

# ---------------------------
# 4. COPY FILE PROJECT (rsync dari local)
# ---------------------------
warn "STEP MANUAL: Copy file project ke VPS"
echo "Jalankan DI LOCAL MACHINE Anda:"
echo "  rsync -avz --exclude 'node_modules' --exclude '.git' \\"
echo "    /path/to/AI\\ HR\\ Recruitment\\ Automation/ \\"
echo "    ${N8N_USER}@$(hostname -I | awk '{print $1}'):${PROJECT_DIR}/"
echo ""
read -rp "Sudah copy file? Tekan Enter untuk lanjut..."

# Verifikasi file kritikal
[[ -f "${PROJECT_DIR}/n8n-workflows/screening-pipeline.json" ]] || err "screening-pipeline.json tidak ditemukan"
[[ -f "${PROJECT_DIR}/n8n-workflows/auto-reply-cron.json" ]] || err "auto-reply-cron.json tidak ditemukan"
[[ -f "${PROJECT_DIR}/config/.env.template" ]] || err ".env.template tidak ditemukan"
ok "File project terdeteksi"

# ---------------------------
# 5. SETUP .env
# ---------------------------
log "Setup environment..."
if [[ ! -f "${PROJECT_DIR}/config/.env" ]]; then
  cp "${PROJECT_DIR}/config/.env.template" "${PROJECT_DIR}/config/.env"
  warn "File .env dibuat dari template. EDIT SEKARANG:"
  echo "  nano ${PROJECT_DIR}/config/.env"
  echo "  Isi SEMUA variable (Google OAuth, LLM API, Sheet IDs, HR_EMAIL, N8N_ENCRYPTION_KEY)"
  read -rp "Sudah edit .env? Tekan Enter..."
else
  ok ".env sudah ada"
fi

# Generate encryption key jika kosong
if ! grep -q '^N8N_ENCRYPTION_KEY=' "${PROJECT_DIR}/config/.env" || \
   grep -q '^N8N_ENCRYPTION_KEY=$' "${PROJECT_DIR}/config/.env"; then
  KEY=$(openssl rand -hex 16)
  sed -i "s/^N8N_ENCRYPTION_KEY=.*/N8N_ENCRYPTION_KEY=${KEY}/" "${PROJECT_DIR}/config/.env"
  ok "N8N_ENCRYPTION_KEY digenerate: ${KEY}"
fi

chown -R "${N8N_USER}:${N8N_USER}" "${PROJECT_DIR}"

# ---------------------------
# 6. SYSTEMD SERVICE
# ---------------------------
log "Buat systemd service n8n..."
cat > /etc/systemd/system/n8n.service <<EOF
[Unit]
Description=n8n - AI HR Recruitment Automation
After=network.target

[Service]
Type=simple
User=${N8N_USER}
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=${PROJECT_DIR}/config/.env
ExecStart=/usr/bin/n8n start
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${PROJECT_DIR} /home/${N8N_USER}/.n8n

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable n8n
systemctl start n8n
sleep 3
systemctl is-active --quiet n8n && ok "n8n service running" || err "n8n gagal start (cek: journalctl -u n8n -f)"

# ---------------------------
# 7. NGINX REVERSE PROXY
# ---------------------------
log "Konfigurasi Nginx + SSL..."
cat > /etc/nginx/sites-available/n8n <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://localhost:${N8N_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/n8n /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
ok "Nginx config OK"

# SSL Certbot
log "Request SSL certificate (Certbot)..."
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${SSL_EMAIL}" --redirect || \
  warn "Certbot gagal (domain belum DNS? jalanin manual: certbot --nginx -d ${DOMAIN})"
ok "SSL configured"

# ---------------------------
# 8. FIREWALL
# ---------------------------
log "Setup UFW firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ok "UFW enabled"

# ---------------------------
# 9. BACKUP CRON
# ---------------------------
log "Setup backup cron..."
sudo -u "${N8N_USER}" crontab -l 2>/dev/null | grep -v "ai-hr-backup" | sudo -u "${N8N_USER}" crontab -
(
  sudo -u "${N8N_USER}" crontab -l 2>/dev/null
  echo "# ai-hr-backup: daily 02:00"
  echo "0 2 * * * tar -czf ${PROJECT_DIR}/backup/n8n-data-\$(date +\\%F).tar.gz -C /home/${N8N_USER}/.n8n . && find ${PROJECT_DIR}/backup -name 'n8n-data-*.tar.gz' -mtime +7 -delete"
  echo "# ai-hr-backup: workflows 03:00"
  echo "0 3 * * * cp -r ${PROJECT_DIR}/n8n-workflows ${PROJECT_DIR}/backup/workflows-\$(date +\\%F)"
) | sudo -u "${N8N_USER}" crontab -
ok "Backup cron installed"

# ---------------------------
# 10. TIMEZONE
# ---------------------------
timedatectl set-timezone "${TIMEZONE}"
ok "Timezone: ${TIMEZONE}"

# ---------------------------
# 11. SUMMARY & NEXT STEPS
# ---------------------------
echo -e "\n${GREEN}=== DEPLOY SELESAI ===${NC}"
echo -e "n8n URL:     https://${DOMAIN}"
echo -e "Project dir: ${PROJECT_DIR}"
echo -e ".env file:   ${PROJECT_DIR}/config/.env"
echo ""
echo -e "${YELLOW}NEXT STEPS (MANUAL DI n8n UI):${NC}"
echo "1. Buka https://${DOMAIN} → setup Basic Auth (admin/password)"
echo "2. Credentials → New → Google Drive OAuth2 API → Name: \"Google Drive (AI HR)\""
echo "3. Credentials → New → Google Sheets OAuth2 API → Name: \"Google Sheets (AI HR)\""
echo "4. Credentials → New → Gmail OAuth2 → Name: \"Gmail (AI HR)\""
echo "   Redirect URI: https://${DOMAIN}/rest/oauth2-credential/callback"
echo "5. Workflows → Import → screening-pipeline.json → Activate"
echo "6. Workflows → Import → auto-reply-cron.json → Activate"
echo "7. Buat Google Sheets (3 tab: Data Kandidat, Kriteria Lowongan, Audit Log)"
echo "8. Isi SHEET_ID_DATA_KANDIDAT & SHEET_ID_AUDIT_LOG di .env → restart n8n"
echo ""
echo -e "${YELLOW}TEST:${NC}"
echo "  curl https://${DOMAIN}/healthz  # harus 200 OK"
echo "  Submit Google Form test → cek Execution di n8n UI"
echo ""
echo -e "${BLUE}LOGS:${NC} journalctl -u n8n -f"
echo -e "${BLUE}RESTART:${NC} systemctl restart n8n"