#!/bin/sh
# ============================================================
# ORCHID — Linux Auto-Start Installer (systemd user services)
#
# Creates two systemd user units:
#   orchid-serve.service   — the web server (scripts/serve.py)
#   orchid-logger.service  — the serial logger (DB/logger.py)
#
# Both start at login, restart automatically on failure, and
# stop when you log out (user-level, no root required).
#
# Usage:
#   chmod +x setup/install-autostart-linux.sh
#   ./setup/install-autostart-linux.sh
#
# To start immediately without logging out first:
#   systemctl --user start orchid-serve orchid-logger
#
# To remove auto-start:
#   ./setup/uninstall-autostart-linux.sh
# ============================================================

set -eu

ORCHID_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
PYTHON="$(command -v python3 || true)"

echo ""
echo "  ORCHID — Linux Auto-Start Installer"
echo "  ====================================="
echo ""

# ── Preflight checks ──────────────────────────────────────────

if [ -z "$PYTHON" ]; then
    echo "  ERROR: python3 not found. Install Python 3 and try again." >&2
    exit 1
fi

if ! systemctl --user > /dev/null 2>&1; then
    echo "  ERROR: systemd user session is not available." >&2
    echo "         This installer requires a systemd-based Linux distribution." >&2
    exit 1
fi

if [ ! -f "$ORCHID_DIR/scripts/serve.py" ]; then
    echo "  ERROR: scripts/serve.py not found at: $ORCHID_DIR" >&2
    echo "         Run this installer from inside the ORCHID folder." >&2
    exit 1
fi

# ── Create the unit directory ─────────────────────────────────

mkdir -p "$UNIT_DIR"

# ── Write orchid-serve.service ────────────────────────────────

cat > "$UNIT_DIR/orchid-serve.service" <<EOF
[Unit]
Description=ORCHID Dashboard Web Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${ORCHID_DIR}
ExecStart=${PYTHON} scripts/serve.py --no-browser
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

# ── Write orchid-logger.service ───────────────────────────────

cat > "$UNIT_DIR/orchid-logger.service" <<EOF
[Unit]
Description=ORCHID Serial Data Logger
After=orchid-serve.service

[Service]
Type=simple
WorkingDirectory=${ORCHID_DIR}
ExecStart=${PYTHON} DB/logger.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

# ── Enable both units ─────────────────────────────────────────

systemctl --user daemon-reload
systemctl --user enable orchid-serve.service
systemctl --user enable orchid-logger.service

# Enable lingering so services start at boot even before the user
# opens a desktop session (needed on headless / server installs).
# Requires loginctl — available on most systemd distros.
if command -v loginctl > /dev/null 2>&1; then
    loginctl enable-linger "$(whoami)" 2>/dev/null || true
fi

echo "  Done.  ORCHID will start automatically when you log in."
echo ""
echo "  To start right now without logging out:"
echo "    systemctl --user start orchid-serve orchid-logger"
echo ""
echo "  To check status:"
echo "    systemctl --user status orchid-serve"
echo "    systemctl --user status orchid-logger"
echo ""
echo "  To view logs:"
echo "    journalctl --user -u orchid-serve -f"
echo "    journalctl --user -u orchid-logger -f"
echo ""
echo "  To remove auto-start:"
echo "    ./setup/uninstall-autostart-linux.sh"
echo ""
