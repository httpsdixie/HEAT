#!/bin/sh
# ORCHID — Remove Linux Auto-Start

set -eu

echo ""
echo "  ORCHID — Remove Auto-Start"
echo "  ==========================="
echo ""

systemctl --user stop  orchid-serve.service  2>/dev/null || true
systemctl --user stop  orchid-logger.service 2>/dev/null || true
systemctl --user disable orchid-serve.service  2>/dev/null || true
systemctl --user disable orchid-logger.service 2>/dev/null || true

UNIT_DIR="$HOME/.config/systemd/user"
rm -f "$UNIT_DIR/orchid-serve.service"
rm -f "$UNIT_DIR/orchid-logger.service"
systemctl --user daemon-reload

echo "  Done.  ORCHID will no longer start automatically."
echo ""
