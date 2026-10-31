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
def find_serial_port():
    if SERIAL_PORT:
        return SERIAL_PORT

    ports = serial.tools.list_ports.comports()
    if not ports:
        print("❌ No serial ports found.")
        print("   Make sure the receiver is plugged into USB.")
        sys.exit(1)

    print("Available serial ports:")
    for i, p in enumerate(ports):
        print(f"  [{i}] {p.device} — {p.description}")

    # Prefer ttyACM / ttyUSB ports (actual USB devices, not virtual COM ports)
    usb_ports = [p for p in ports if any(k in p.device for k in ['ttyACM', 'ttyUSB'])]

    # Among USB ports, prefer known ESP32 chip descriptions
    for p in usb_ports:
        desc = (p.description or '').lower()
        if any(k in desc for k in ['cp210', 'ch340', 'usb serial', 'jtag', 'esp32', 'heltec', 'tinyusb', 'cdc']):
            print(f"→ Auto-selected: {p.device} ({p.description})")
            return p.device

    # Fall back to first USB port
    if usb_ports:
        print(f"→ Using first USB port: {usb_ports[0].device}")
        return usb_ports[0].device

    # Last resort: first port in list
    print(f"→ Using first port: {ports[0].device}")
    return ports[0].device

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
    time.sleep(2)  # Wait for ESP32 to settle

    print("🟢 Listening for packets... (Ctrl+C to stop)")
    print("-" * 60)

    try:
        while True:
            try:
                raw = ser.readline().decode('utf-8', errors='ignore').strip()
            except serial.SerialException:
                print("⚠️  Serial disconnected. Reconnecting...")
                try:
                    ser.close()
                except Exception:
                    pass
                # Wait and re-detect the port in case it re-enumerated
                while True:
                    time.sleep(3)
                    try:
                        port = find_serial_port()
                        ser = serial.Serial(port, BAUD_RATE, timeout=2)
                        ser.reset_input_buffer()   # discard partial line from disconnect
                        print(f"✅ Reconnected to {port}")
                        break
                    except Exception as reconnect_err:
                        print(f"   Waiting for receiver... ({reconnect_err})")
                continue

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
