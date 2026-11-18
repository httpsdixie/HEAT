"""
backup_db.py — ORCHID database backup utility

Creates a timestamped copy of orchid.db in a backups/ folder next to the
database file, then deletes the oldest copies so only KEEP_COPIES remain.

Usage (run from any directory):
    python scripts/backup_db.py

Safe to run while the server and logger are running — SQLite's backup API
does a consistent online copy without locking out other writers.
"""

import os
import shutil
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

# ── Configuration ─────────────────────────────────────────────────────────────

# Root of the ORCHID project (one level above this script's directory)
ROOT_DIR = Path(__file__).resolve().parent.parent

# Source database — respects the same env override as serve.py
DB_FILE = Path(os.environ.get("ORCHID_DB_FILE", ROOT_DIR / "DB" / "orchid.db"))

# Where backups are stored
BACKUP_DIR = Path(os.environ.get("ORCHID_BACKUP_DIR", ROOT_DIR / "DB" / "backups"))

# How many backup copies to keep (oldest are deleted first)
KEEP_COPIES = int(os.environ.get("ORCHID_BACKUP_KEEP", "7"))

# ── Helpers ───────────────────────────────────────────────────────────────────

def _timestamp():
    """UTC timestamp safe for use in a filename."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


def _existing_backups():
    """Return backup files sorted oldest-first."""
    if not BACKUP_DIR.exists():
        return []
    files = sorted(BACKUP_DIR.glob("orchid_backup_*.db"))
    return files


def _prune(keep):
    """Delete the oldest backups, keeping at most `keep` copies."""
    existing = _existing_backups()
    to_delete = existing[: max(0, len(existing) - keep)]
    for path in to_delete:
        try:
            path.unlink()
            print(f"  Removed old backup: {path.name}")
        except OSError as err:
            print(f"  Warning: could not remove {path.name}: {err}", file=sys.stderr)


# ── Main ──────────────────────────────────────────────────────────────────────

def backup():
    if not DB_FILE.exists():
        print(f"Nothing to back up — database not found at: {DB_FILE}", file=sys.stderr)
        # Exit 0 so the startup scripts don't abort on a fresh install
        return

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    dest = BACKUP_DIR / f"orchid_backup_{_timestamp()}.db"

    # sqlite3.connect.backup() performs an online, consistent copy even while
    # the logger and server are writing — no readers or writers are blocked.
    try:
        with closing(sqlite3.connect(str(DB_FILE), timeout=30)) as src:
            with closing(sqlite3.connect(str(dest))) as dst:
                src.backup(dst)
    except sqlite3.Error as err:
        print(f"Backup failed: {err}", file=sys.stderr)
        # Remove an incomplete destination file if one was created
        if dest.exists():
            try:
                dest.unlink()
            except OSError:
                pass
        sys.exit(1)

    size_kb = dest.stat().st_size // 1024
    print(f"  Backup saved: {dest.name} ({size_kb} KB)")

    _prune(KEEP_COPIES)

    remaining = _existing_backups()
    print(f"  Backups kept: {len(remaining)} / {KEEP_COPIES}")


if __name__ == "__main__":
    print("ORCHID — database backup")
    print(f"  Source:  {DB_FILE}")
    print(f"  Dest:    {BACKUP_DIR}")
    backup()
    print("Done.")
