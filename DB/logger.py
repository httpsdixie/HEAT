"""
ORCHID Weather Station — Serial to SQLite Logger
Reads JSON lines from the Heltec receiver via USB serial
and inserts them into a local SQLite database.
"""

import serial
import serial.tools.list_ports
import json
import math
import sqlite3
import sys
import os
import time
from datetime import datetime, timezone

# ============================================================
# CONFIGURATION
# ============================================================
SERIAL_PORT = None          # Set to 'COM4' etc. to force a specific port
BAUD_RATE   = 115200
# Always resolve relative to this script's own directory (DB/)
DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'orchid.db')


def utc_timestamp():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def require_integer(msg, field, minimum=0, maximum=None):
    value = msg.get(field)
    if type(value) is not int or value < minimum or (maximum is not None and value > maximum):
        upper_bound = maximum if maximum is not None else 'infinity'
        raise ValueError(f"{field} must be an integer between {minimum} and {upper_bound}.")
    return value


def require_number(msg, field):
    value = msg.get(field)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a finite number.")
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise ValueError(f"{field} must be a finite number.")
    return value


# ============================================================
# AUTO-DETECT SERIAL PORT
# ============================================================

# Hardware USB vendor/product IDs for the two most common ESP32 USB-serial chips.
# These are hardware constants — far more reliable than description text matching.
_ESP32_VID_PIDS = {
    (0x10C4, 0xEA60),  # Silicon Labs CP210x (most Heltec boards)
    (0x1A86, 0x7523),  # QinHeng CH340
    (0x1A86, 0x55D4),  # QinHeng CH9102 (newer boards)
    (0x0403, 0x6001),  # FTDI FT232R
    (0x0403, 0x6010),  # FTDI FT2232
    (0x0403, 0x6015),  # FTDI FT231X
    (0x239A, None),    # Adafruit (any PID)
    (0x303A, None),    # Espressif native USB (ESP32-S2/S3)
}

_DESC_KEYWORDS = [
    'cp210', 'ch340', 'ch9102', 'usb serial', 'uart', 'ftdi',
    'esp32', 'heltec', 'tinyusb', 'cdc', 'jtag',
]

# File that remembers the last successfully used port
_PORT_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.last_port')


def _score_port(p):
    """Return a confidence score for a port being the ORCHID receiver.
    Higher = more likely. 0 = almost certainly not the receiver."""
    score = 0
    vid = getattr(p, 'vid', None)
    pid = getattr(p, 'pid', None)
    desc = (p.description or '').lower()
    device = (p.device or '').lower()

    # VID/PID match is the strongest signal
    if vid is not None:
        for v, pr in _ESP32_VID_PIDS:
            if vid == v and (pr is None or pid == pr):
                score += 100
                break

    # Description keyword match
    if any(k in desc for k in _DESC_KEYWORDS):
        score += 50

    # Linux device name hints
    if any(k in device for k in ['ttyusb', 'ttyacm']):
        score += 30

    return score


def _list_candidates():
    """Return all ports scored > 0, sorted best-first."""
    ports = serial.tools.list_ports.comports()
    scored = [(p, _score_port(p)) for p in ports]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [(p, s) for p, s in scored if s > 0], ports


def _ask_user(candidates, all_ports):
    """Prompt the user to pick a port when auto-detection is ambiguous."""
    print("\n  Multiple possible ports found. Enter the number for the ORCHID receiver:")
    for i, (p, score) in enumerate(candidates):
        print(f"    [{i}] {p.device:<12} {p.description or 'No description'}")
    print(f"    [a] Show all {len(all_ports)} ports")
    while True:
        try:
            choice = input("  Your choice: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            sys.exit(0)
        if choice == 'a':
            for i, p in enumerate(all_ports):
                print(f"    [{i}] {p.device:<12} {p.description or 'No description'}")
            for i, (p, _) in enumerate(candidates):
                print(f"    [{len(all_ports) + i}] {p.device} (suggested)")
            continue
        try:
            idx = int(choice)
            if 0 <= idx < len(candidates):
                return candidates[idx][0].device
            if 0 <= idx < len(all_ports):
                return all_ports[idx].device
        except ValueError:
            pass
        print("  Invalid choice. Enter a number from the list.")


def _load_cached_port():
    try:
        with open(_PORT_CACHE_FILE, 'r') as f:
            return f.read().strip()
    except OSError:
        return None


def _save_cached_port(port):
    try:
        with open(_PORT_CACHE_FILE, 'w') as f:
            f.write(port)
    except OSError:
        pass


def find_serial_port():
    """Detect the ORCHID receiver's COM port with multi-stage fallback."""

    # 0. Hard-coded override in config
    if SERIAL_PORT:
        print(f"→ Using configured port: {SERIAL_PORT}")
        return SERIAL_PORT

    # 1. Try the cached port from last successful run
    cached = _load_cached_port()
    if cached:
        all_ports = serial.tools.list_ports.comports()
        if any(p.device == cached for p in all_ports):
            print(f"→ Using last known port: {cached}")
            return cached
        else:
            print(f"   Last known port {cached} not found — rescanning...")

    # 2. Scan and score
    while True:
        candidates, all_ports = _list_candidates()

        if not all_ports:
            print("⚠️  No serial ports found. Plug in the receiver and press Enter to retry...")
            try:
                input()
            except (EOFError, KeyboardInterrupt):
                sys.exit(0)
            continue

        if not candidates:
            print("\n⚠️  No recognised ORCHID receiver found.")
            print("   Available ports:")
            for p in all_ports:
                print(f"     {p.device:<12} {p.description or 'No description'}")
            print("\n   If the receiver is plugged in, enter its COM port manually")
            print("   (e.g. COM3 or /dev/ttyUSB0), or press Enter to rescan:")
            try:
                manual = input("  Port: ").strip()
            except (EOFError, KeyboardInterrupt):
                sys.exit(0)
            if manual:
                return manual
            continue

        # 3. Single strong candidate — use it automatically
        best_port, best_score = candidates[0]
        if best_score >= 100 or len(candidates) == 1:
            print(f"→ Auto-selected: {best_port.device} ({best_port.description or 'USB serial'})")
            _save_cached_port(best_port.device)
            return best_port.device

        # 4. Multiple plausible candidates — ask the user
        chosen = _ask_user(candidates, all_ports)
        _save_cached_port(chosen)
        return chosen

# ============================================================
# DATABASE SETUP
# ============================================================
def _commit_with_retry(conn, retries=5, delay=0.5):
    """Commit with retry on OperationalError (database locked).
    Prevents a transient read-lock from crashing the logger process."""
    for attempt in range(retries):
        try:
            conn.commit()
            return
        except sqlite3.OperationalError as err:
            if attempt < retries - 1 and "locked" in str(err).lower():
                time.sleep(delay)
            else:
                raise


def init_db():
    conn = sqlite3.connect(DB_FILE, timeout=30)
    # WAL mode: readers don't block the writer and vice-versa.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS readings (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at    TEXT    NOT NULL,
            node_id       INTEGER NOT NULL,
            temperature   REAL,
            humidity      REAL,
            pressure      REAL,
            heat_index    REAL,
            battery_mv    INTEGER,
            status_flags  INTEGER,
            weather       TEXT
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_readings_node_time
            ON readings (node_id, created_at DESC)
    """)
    # Standalone created_at index — needed for fast date-range queries in serve.py
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_readings_created_at
            ON readings (created_at)
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS nodes (
            node_id         INTEGER PRIMARY KEY,
            last_seen       TEXT,
            last_battery_mv INTEGER,
            status_flags    INTEGER,
            uptime_counter  INTEGER
        )
    """)
    conn.commit()
    return conn

# ============================================================
# HANDLERS
# ============================================================
def handle_data(conn, msg):
    node_id = require_integer(msg, 'node_id', 1, 65535)
    temperature = require_number(msg, 't')
    humidity = require_number(msg, 'h')
    pressure = require_number(msg, 'p')
    heat_index = require_number(msg, 'hi')
    battery_mv = require_integer(msg, 'batt_mv', maximum=65535)
    status_flags = require_integer(msg, 'flags', maximum=255)
    weather = msg.get('weather')
    if not isinstance(weather, str) or not weather.strip():
        raise ValueError("weather must be a non-empty string.")

    ts = utc_timestamp()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO readings
            (created_at, node_id, temperature, humidity,
             pressure, heat_index, battery_mv, status_flags, weather)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        ts,
        node_id,
        temperature,
        humidity,
        pressure,
        heat_index,
        battery_mv,
        status_flags,
        weather.strip(),
    ))
    _commit_with_retry(conn)

    print(f"[{ts}] DATA  Node {node_id} | "
          f"T={temperature:.1f}°C H={humidity:.1f}% "
          f"P={pressure:.1f} HI={heat_index:.1f}°C "
          f"| {weather.strip()}")

def handle_heartbeat(conn, msg):
    node_id = require_integer(msg, 'node_id', 1, 65535)
    battery_mv = require_integer(msg, 'batt_mv', maximum=65535)
    status_flags = require_integer(msg, 'flags', maximum=255)
    uptime = require_integer(msg, 'uptime', maximum=65535)

    ts = utc_timestamp()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO nodes (node_id, last_seen, last_battery_mv,
                           status_flags, uptime_counter)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
            last_seen       = excluded.last_seen,
            last_battery_mv = excluded.last_battery_mv,
            status_flags    = excluded.status_flags,
            uptime_counter  = excluded.uptime_counter
    """, (
        node_id,
        ts,
        battery_mv,
        status_flags,
        uptime,
    ))
    _commit_with_retry(conn)

    print(f"[{ts}] HB    Node {node_id} | "
          f"Batt={battery_mv}mV | Uptime={uptime}")

# ============================================================
# MAIN LOOP
# ============================================================
def main():
    print("=" * 60)
    print("  ORCHID Weather Station — Serial to SQLite Logger")
    print("=" * 60)

    conn = init_db()
    print(f"✅ SQLite ready: {DB_FILE}")

    port = find_serial_port()
    print(f"✅ Opening serial port: {port} @ {BAUD_RATE}")

    ser = serial.Serial(port, BAUD_RATE, timeout=2)
    _save_cached_port(port)
    time.sleep(2)  # Wait for ESP32 to settle

    print("🟢 Listening for packets... (Ctrl+C to stop)")
    print("-" * 60)

    line_buffer = ''   # accumulate partial lines across reconnects

    try:
        while True:
            try:
                chunk = ser.read(ser.in_waiting or 1).decode('utf-8', errors='ignore')
            except serial.SerialException:
                print("⚠️  Serial disconnected. Reconnecting...")
                line_buffer = ''   # discard any partial line — it's corrupt
                try:
                    ser.close()
                except Exception:
                    pass
                while True:
                    time.sleep(3)
                    try:
                        port = find_serial_port()
                        ser = serial.Serial(port, BAUD_RATE, timeout=2)
                        ser.reset_input_buffer()
                        _save_cached_port(port)
                        print(f"✅ Reconnected to {port}")
                        break
                    except Exception as reconnect_err:
                        print(f"   Waiting for receiver... ({reconnect_err})")
                continue

            if not chunk:
                continue

            line_buffer += chunk

            # Process every complete newline-terminated line in the buffer
            while '\n' in line_buffer:
                raw, line_buffer = line_buffer.split('\n', 1)
                raw = raw.strip()
                if not raw:
                    continue

                # Skip non-JSON lines (boot messages, serial noise)
                if not raw.startswith('{'):
                    print(f"   [device] {raw}")
                    continue

                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    print(f"   [bad json] {raw}")
                    continue

                if not isinstance(msg, dict):
                    print("   [invalid packet] JSON message must be an object.")
                    continue

                t = msg.get('type')
                try:
                    if t == 'data':
                        handle_data(conn, msg)
                    elif t == 'heartbeat':
                        handle_heartbeat(conn, msg)
                    elif t == 'boot':
                        print(f"   [boot] receiver ready")
                    else:
                        print(f"   [unknown packet type] {t!r}")
                except ValueError as packet_error:
                    print(f"   [invalid packet] {packet_error}")

    except KeyboardInterrupt:
        print("\n" + "-" * 60)
        print("🛑 Stopped by user.")
    finally:
        ser.close()
        conn.close()
        print("✅ Serial closed. Database closed.")

if __name__ == '__main__':
    main()
