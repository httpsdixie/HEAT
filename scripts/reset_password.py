"""
reset_password.py — ORCHID emergency administrator password reset

Use this script when you are locked out of ORCHID and cannot receive a
verification email (e.g. SMTP is not configured, or the email is unreachable).

It runs entirely offline, requires no internet connection, and writes the new
password hash directly to the SQLite database.

Usage (run from the ORCHID project folder):
    python scripts/reset_password.py

Requirements:
  - Run on the same machine where ORCHID is installed
  - ORCHID must NOT be running (stop it first to avoid a database lock)
  - Python 3.8 or later (uses hashlib.scrypt, available in the standard library)
"""

import getpass
import hashlib
import os
import re
import secrets
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

# ── Locate the database (same logic as serve.py) ─────────────────────────────

ROOT_DIR = Path(__file__).resolve().parent.parent
DB_FILE  = Path(os.environ.get("ORCHID_DB_FILE", ROOT_DIR / "DB" / "orchid.db"))

# ── Password rules (must match serve.py valid_password) ──────────────────────

def valid_password(password):
    if not isinstance(password, str) or not (8 <= len(password) <= 128):
        return False, "Password must be between 8 and 128 characters."
    if not re.search(r'[A-Z]', password):
        return False, "Password must contain at least one uppercase letter."
    if not re.search(r'[0-9]', password):
        return False, "Password must contain at least one number."
    if not re.search(r'[!@#$%^&*()\-_=+\[\]{};:\'",.<>/?\\|`~]', password):
        return False, "Password must contain at least one special character."
    return True, ""

# ── Hashing (must match serve.py hash_password) ──────────────────────────────

def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=2**15,
        r=8,
        p=1,
        dklen=32,
        maxmem=64 * 1024 * 1024
    )
    return salt, derived

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  ORCHID — Emergency Administrator Password Reset")
    print("=" * 60)
    print()
    print("  This tool resets the administrator password directly in")
    print("  the database without requiring email verification.")
    print()
    print("  STOP ORCHID before continuing to avoid a database lock.")
    print()

    # Confirm the database exists
    if not DB_FILE.exists():
        print(f"ERROR: Database not found at: {DB_FILE}", file=sys.stderr)
        print("       Start ORCHID once to create it, then run this script.", file=sys.stderr)
        sys.exit(1)

    # Open DB and check the account exists
    try:
        with closing(sqlite3.connect(str(DB_FILE), timeout=5)) as conn:
            conn.row_factory = sqlite3.Row
            account = conn.execute(
                "SELECT display_name, email FROM admin_account WHERE id = 1"
            ).fetchone()
    except sqlite3.OperationalError as err:
        print(f"ERROR: Could not read the database: {err}", file=sys.stderr)
        print("       Make sure ORCHID is not running, then try again.", file=sys.stderr)
        sys.exit(1)

    if account is None:
        print("ERROR: No administrator account found in the database.", file=sys.stderr)
        print("       Open ORCHID in a browser and complete first-time setup first.", file=sys.stderr)
        sys.exit(1)

    print(f"  Account found: {account['display_name']} <{account['email']}>")
    print()

    # Prompt for new password (twice, no echo)
    for attempt in range(3):
        try:
            password = getpass.getpass("  New password: ")
            confirm  = getpass.getpass("  Confirm password: ")
        except (KeyboardInterrupt, EOFError):
            print("\n\nCancelled.")
            sys.exit(0)

        if password != confirm:
            print("  Passwords do not match. Try again.\n")
            continue

        ok, reason = valid_password(password)
        if not ok:
            print(f"  {reason} Try again.\n")
            continue

        break
    else:
        print("\nToo many failed attempts. No changes were made.")
        sys.exit(1)

    # Hash and write
    salt, pw_hash = hash_password(password)
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    try:
        with closing(sqlite3.connect(str(DB_FILE), timeout=10)) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            updated = conn.execute(
                "UPDATE admin_account SET password_salt = ?, password_hash = ?, updated_at = ? WHERE id = 1",
                (salt, pw_hash, now)
            ).rowcount
            # Write an audit event so the change is traceable
            conn.execute(
                "INSERT INTO audit_events (created_at, actor, action, node_id, details) VALUES (?, ?, ?, 0, ?)",
                (now, account["display_name"], "account_password_updated",
                 '{"message":"Administrator password reset using the emergency CLI tool."}')
            )
            conn.commit()
    except sqlite3.OperationalError as err:
        print(f"\nERROR: Could not write to the database: {err}", file=sys.stderr)
        print("       Make sure ORCHID is not running, then try again.", file=sys.stderr)
        sys.exit(1)

    if updated == 0:
        print("\nERROR: Account row was not updated. No changes were made.", file=sys.stderr)
        sys.exit(1)

    print()
    print("  ✅  Password updated successfully.")
    print(f"      Account: {account['display_name']} <{account['email']}>")
    print(f"      Changed: {now}")
    print()
    print("  You can now start ORCHID and sign in with the new password.")
    print()


if __name__ == "__main__":
    main()
