#!/usr/bin/env bash
# Idempotent local deployment helper; copies the current source to /opt/blackbox.
# Run only after reviewing the service and environmental security settings.
set -Eeuo pipefail
if [[ $EUID -ne 0 ]]; then echo "Run using sudo: sudo bash deploy/install_jetson.sh" >&2; exit 1; fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
id blackbox &>/dev/null || useradd --system --create-home --home-dir /var/lib/blackbox --shell /usr/sbin/nologin blackbox
install -d -m 0755 /opt/blackbox
install -d -o blackbox -g blackbox -m 0700 /var/lib/blackbox
install -d -m 0700 /etc/blackbox
for file in app.py radio_bridge.py index.html style.css app.js manifest.webmanifest icon.svg; do
  install -m 0644 "$ROOT/$file" "/opt/blackbox/$file"
done
# Copy directory contents, not the directory itself: repeated installs must not
# create /opt/blackbox/knowledge/knowledge. Retain locally added .md files.
install -d -m 0755 /opt/blackbox/knowledge
cp -a "$ROOT/knowledge/." /opt/blackbox/knowledge/
chmod -R a+rX /opt/blackbox/knowledge
if [[ ! -f /etc/blackbox/blackbox.env ]]; then
  install -m 0600 "$ROOT/deploy/blackbox.env.example" /etc/blackbox/blackbox.env
fi
install -m 0644 "$ROOT/deploy/blackbox.service" /etc/systemd/system/blackbox.service
systemctl daemon-reload
systemctl enable blackbox.service
systemctl restart blackbox.service
systemctl --no-pager status blackbox.service || true
echo 'BLACKBOX installed on loopback (http://127.0.0.1:8765) unless explicitly configured otherwise.'
