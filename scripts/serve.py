"""
serve.py — ORCHID local development server
Run scripts/serve.py from any directory to start the local site and open its dashboard.
The bundled dashboard and map work without internet. Press Ctrl+C to stop.
"""
import argparse
from contextlib import closing
import datetime
from email.message import EmailMessage
import hashlib
import hmac
import http.server
import json
import math
import os
import re
import secrets
import smtplib
import ssl
import socketserver
import sqlite3
import sys
import threading
import time
import webbrowser
from urllib.parse import parse_qs, unquote, urlparse

START_PORT = 5500
END_PORT = 5510
DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_local_environment():
    env_file = os.path.join(DIR, ".env")
    if not os.path.isfile(env_file):
        return
    with open(env_file, encoding="utf-8") as file:
        for line_number, line in enumerate(file, start=1):
            entry = line.strip()
            if not entry or entry.startswith("#"):
                continue
            if "=" not in entry:
                raise ValueError(f"Invalid .env entry on line {line_number}.")
            name, value = entry.split("=", 1)
            name = name.strip()
            value = value.strip()
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
                raise ValueError(f"Invalid .env variable name on line {line_number}.")
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            os.environ.setdefault(name, value)


load_local_environment()
DB_FILE = os.environ.get("ORCHID_DB_FILE", os.path.join(DIR, "DB", "orchid.db"))
DEMO_DIR = os.path.join(DIR, "demo")
ADMIN_EMAIL = os.environ.get("ORCHID_ADMIN_EMAIL", "admin@orchid.local").strip()
ADMIN_DISPLAY_NAME = "System Officer"
ONLINE_WINDOW = datetime.timedelta(minutes=3)
LOW_BATTERY_THRESHOLD_MV = 3400
LOW_BATTERY_ONLINE_WINDOW = datetime.timedelta(minutes=35)
MOCK_DATA_ENABLED = False
DEMO_ACCOUNT = None
DEMO_FIXTURES = {}
SESSION_TTL_SECONDS = 8 * 60 * 60
VERIFICATION_TTL_SECONDS = 10 * 60
MAX_VERIFICATION_ATTEMPTS = 5
AUTH_SESSIONS = {}
AUTH_CHALLENGES = {}
AUTH_ATTEMPTS = {}
MOCK_PLACEMENTS = {}
MOCK_AUDIT_EVENTS = []

# ── Long-term retention settings ──────────────────────────────
READINGS_RETENTION_DAYS  = 365   # keep 1 year of sensor readings
AUDIT_RETENTION_COUNT    = 5000  # keep the latest 5000 audit events
MAINTENANCE_INTERVAL_SEC = 6 * 60 * 60  # run housekeeping every 6 hours


def _run_maintenance():
    """Background thread: prune old data, VACUUM, ANALYZE every 6 hours."""
    while True:
        time.sleep(MAINTENANCE_INTERVAL_SEC)
        if MOCK_DATA_ENABLED:
            continue
        try:
            with closing(sqlite3.connect(DB_FILE, timeout=30)) as conn:
                conn.execute("PRAGMA journal_mode=WAL")
                cutoff = (
                    datetime.datetime.now(datetime.timezone.utc)
                    - datetime.timedelta(days=READINGS_RETENTION_DAYS)
                ).strftime("%Y-%m-%dT%H:%M:%S")
                deleted = conn.execute(
                    "DELETE FROM readings WHERE created_at < ?", (cutoff,)
                ).rowcount
                # Keep only the latest AUDIT_RETENTION_COUNT audit events
                conn.execute("""
                    DELETE FROM audit_events
                    WHERE id NOT IN (
                        SELECT id FROM audit_events ORDER BY id DESC LIMIT ?
                    )
                """, (AUDIT_RETENTION_COUNT,))
                conn.commit()
                conn.execute("PRAGMA optimize")
                if deleted > 0:
                    print(f"[maintenance] Pruned {deleted} old readings (older than {READINGS_RETENTION_DAYS} days).")
        except Exception as err:  # noqa: BLE001
            print(f"[maintenance] Error during housekeeping: {err}")


def _run_session_janitor():
    """Background thread: evict expired sessions from AUTH_SESSIONS every hour."""
    while True:
        time.sleep(3600)
        now = time.time()
        expired = [k for k, v in list(AUTH_SESSIONS.items()) if v["expires_at"] <= now]
        for k in expired:
            AUTH_SESSIONS.pop(k, None)
        if expired:
            print(f"[janitor] Evicted {len(expired)} expired session(s).")


def load_demo_fixtures():
    global DEMO_ACCOUNT, DEMO_FIXTURES
    with open(os.path.join(DEMO_DIR, "account.json"), encoding="utf-8") as account_file:
        account = json.load(account_file)
    with open(os.path.join(DEMO_DIR, "data.json"), encoding="utf-8") as fixtures_file:
        fixtures = json.load(fixtures_file)
    try:
        password_salt = bytes.fromhex(account["password_salt"])
        password_hash = bytes.fromhex(account["password_hash"])
        if len(password_salt) != 16 or len(password_hash) != 32:
            raise ValueError
        if not account["display_name"] or not account["email"]:
            raise ValueError
        if not fixtures["nodes"] or not isinstance(fixtures["audit_events"], list):
            raise ValueError
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("The demo account or data fixtures are invalid.") from error
    DEMO_ACCOUNT = {
        "display_name": account["display_name"],
        "email": account["email"].strip().lower(),
        "password_salt": password_salt,
        "password_hash": password_hash
    }
    DEMO_FIXTURES = fixtures
    MOCK_PLACEMENTS.clear()
    MOCK_PLACEMENTS.update({
        node["id"]: {
            "node_id": node["id"],
            "location_name": node["location"],
            "latitude": node["latitude"],
            "longitude": node["longitude"]
        }
        for node in fixtures["nodes"] if node["location"] is not None
    })


def build_mock_nodes():
    now = datetime.datetime.now(datetime.timezone.utc)
    nodes = []
    for mock_node in DEMO_FIXTURES["nodes"]:
        node_id = mock_node["id"]
        placement = MOCK_PLACEMENTS.get(node_id)
        last_seen = now - datetime.timedelta(minutes=mock_node["last_seen_minutes"])
        recent_readings = []
        phase = node_id * 0.73
        metric_amplitudes = {
            "temperature": 0.3,
            "humidity": 1.4,
            "pressure": 0.45,
            "heat_index": 0.55
        }
        for offset in range(0, 61, 6):
            age_minutes = mock_node["last_seen_minutes"] + offset
            created_at = now - datetime.timedelta(minutes=age_minutes)
            wave = math.sin((offset / 45) * 2 * math.pi + phase) - math.sin(phase)
            recent_readings.append({
                "createdAt": created_at.isoformat(timespec="seconds"),
                "ageMinutes": age_minutes,
                "temperature": round(mock_node["temperature"] + wave * metric_amplitudes["temperature"], 2),
                "humidity": round(mock_node["humidity"] + wave * metric_amplitudes["humidity"], 2),
                "pressure": round(mock_node["pressure"] + wave * metric_amplitudes["pressure"], 2),
                "heatIndex": round(mock_node["heat_index"] + wave * metric_amplitudes["heat_index"], 2)
            })
        nodes.append({
            "key": f"node-{node_id:02d}",
            "id": str(node_id),
            "name": placement["location_name"] if placement else "",
            "location": placement["location_name"] if placement else None,
            "latitude": placement["latitude"] if placement else None,
            "longitude": placement["longitude"] if placement else None,
            "status": "Online" if mock_node["online"] else "Offline",
            "lastSeen": last_seen.isoformat(timespec="seconds"),
            "battery": f'{mock_node["battery_mv"]} mV',
            "uptime": str(mock_node["uptime"]),
            "sensorStatus": str(mock_node["flags"]),
            "temperature": mock_node["temperature"],
            "mapTemperature": mock_node["temperature"],
            "humidity": mock_node["humidity"],
            "pressure": mock_node["pressure"],
            "heatIndex": mock_node["heat_index"],
            "weather": mock_node["weather"],
            "recentReadings": recent_readings
        })
    return nodes

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.end_headers()
        self.wfile.write(body)

    def send_session_cookie(self, token, max_age=SESSION_TTL_SECONDS):
        self.send_header(
            "Set-Cookie",
            f"orchid_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}"
        )

    def request_body(self, maximum=16384):
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0 or content_length > maximum:
            raise ValueError("Request body is missing or too large.")
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Request must use application/json.")
        payload = json.loads(self.rfile.read(content_length))
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def check_request_origin(self):
        origin = self.headers.get("Origin")
        host = self.headers.get("Host")
        if not origin or not host or origin != f"http://{host}":
            self.send_json(403, {"error": "Request origin could not be verified. Reload the app and try again."})
            return False
        return True

    def account_row(self, connection=None):
        if MOCK_DATA_ENABLED:
            return DEMO_ACCOUNT
        if connection is not None:
            return connection.execute(
                "SELECT display_name, email, password_salt, password_hash FROM admin_account WHERE id = 1"
            ).fetchone()
        with closing(self.open_database()) as db:
            return self.account_row(db)

    def current_session(self, refresh=True):
        cookie_header = self.headers.get("Cookie", "")
        cookies = {}
        for part in cookie_header.split(";"):
            name, separator, value = part.strip().partition("=")
            if separator:
                cookies[name] = value
        token = cookies.get("orchid_session")
        if not token:
            return None
        token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).hexdigest()
        session = AUTH_SESSIONS.get(token_hash)
        if not session:
            return None
        if session["expires_at"] <= time.time():
            AUTH_SESSIONS.pop(token_hash, None)
            return None
        if refresh:
            session["expires_at"] = time.time() + SESSION_TTL_SECONDS
        return session

    def require_session(self):
        session = self.current_session()
        if session:
            return session
        self.send_json(401, {"error": "Please sign in to continue.", "code": "authentication_required"})
        return None

    def establish_session(self, display_name, email):
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
        AUTH_SESSIONS[token_hash] = {
            "display_name": display_name,
            "email": email,
            "expires_at": time.time() + SESSION_TTL_SECONDS
        }
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_session_cookie(token)
        self.end_headers()
        self.wfile.write(json.dumps({"authenticated": True, "account": {
            "display_name": display_name,
            "email": email
        }}).encode("utf-8"))

    def code_request_rate_limited(self, key):
        now = time.time()
        requests = [timestamp for timestamp in AUTH_ATTEMPTS.get(key, []) if now - timestamp < 900]
        if len(requests) >= 3:
            AUTH_ATTEMPTS[key] = requests
            return True
        requests.append(now)
        AUTH_ATTEMPTS[key] = requests
        return False

    def record_login_attempt(self, key, success):
        now = time.time()
        attempts = [timestamp for timestamp in AUTH_ATTEMPTS.get(key, []) if now - timestamp < 900]
        if success:
            AUTH_ATTEMPTS.pop(key, None)
        else:
            attempts.append(now)
            AUTH_ATTEMPTS[key] = attempts

    def login_rate_limited(self, key):
        now = time.time()
        attempts = [timestamp for timestamp in AUTH_ATTEMPTS.get(key, []) if now - timestamp < 900]
        AUTH_ATTEMPTS[key] = attempts
        return len(attempts) >= 5

    @staticmethod
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

    @staticmethod
    def valid_password(password):
        if not isinstance(password, str) or not (8 <= len(password) <= 128):
            return False
        if not re.search(r'[A-Z]', password):
            return False
        if not re.search(r'[0-9]', password):
            return False
        if not re.search(r'[!@#$%^&*()\-_=+\[\]{};:\'",.<>/?\\|`~]', password):
            return False
        return True

    def verify_password(self, account, password):
        if not account or not isinstance(password, str) or len(password) > 128:
            return False
        _, candidate = self.hash_password(password, account["password_salt"])
        return hmac.compare_digest(candidate, account["password_hash"])

    def create_verification(self, purpose, payload):
        code = f"{secrets.randbelow(1_000_000):06d}"
        salt = secrets.token_bytes(16)
        AUTH_CHALLENGES[purpose] = {
            **payload,
            "salt": salt,
            "code_hash": hashlib.sha256(salt + code.encode("ascii")).digest(),
            "expires_at": time.time() + VERIFICATION_TTL_SECONDS,
            "attempts": 0
        }
        return code

    def consume_verification(self, purpose, code):
        challenge = AUTH_CHALLENGES.get(purpose)
        if not challenge or challenge["expires_at"] <= time.time():
            AUTH_CHALLENGES.pop(purpose, None)
            self.send_json(400, {"error": "That verification code expired. Request a new code."})
            return None
        if challenge["attempts"] >= MAX_VERIFICATION_ATTEMPTS:
            AUTH_CHALLENGES.pop(purpose, None)
            self.send_json(429, {"error": "Too many incorrect codes. Request a new code."})
            return None
        if not isinstance(code, str) or not re.fullmatch(r"\d{6}", code):
            challenge["attempts"] += 1
            self.send_json(400, {"error": "Enter the six-digit verification code."})
            return None
        candidate = hashlib.sha256(challenge["salt"] + code.encode("ascii")).digest()
        if not hmac.compare_digest(candidate, challenge["code_hash"]):
            challenge["attempts"] += 1
            self.send_json(400, {"error": "That verification code is incorrect."})
            return None
        AUTH_CHALLENGES.pop(purpose, None)
        return challenge

    @staticmethod
    def valid_email(value):
        return isinstance(value, str) and len(value) <= 254 and re.fullmatch(
            r"[^@\s]+@[^@\s]+\.[^@\s]+", value.strip()
        ) is not None

    def send_verification_email(self, recipient, code, purpose):
        smtp_host = os.environ.get("ORCHID_SMTP_HOST", "").strip()
        smtp_user = os.environ.get("ORCHID_SMTP_USER", "").strip()
        smtp_password = os.environ.get("ORCHID_SMTP_PASSWORD", "")
        sender = os.environ.get("ORCHID_SMTP_FROM", smtp_user).strip()
        try:
            smtp_port = int(os.environ.get("ORCHID_SMTP_PORT", "587"))
        except ValueError as error:
            raise ValueError("ORCHID_SMTP_PORT must be a valid port number.") from error
        if not smtp_host or not sender:
            raise RuntimeError(
                "Email delivery is not configured. Set ORCHID_SMTP_HOST and ORCHID_SMTP_FROM before continuing."
            )
        purpose_label = purpose.replace("-", " ").title()
        plain_text = (
            f"Your ORCHID {purpose_label} verification code is: {code}\n\n"
            "It expires in 10 minutes and can only be used once.\n"
            "If you did not request this, you can safely ignore this message."
        )
        html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ORCHID Verification Code</title>
</head>
<body style="margin:0;padding:0;background:#0d1b2e;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
         style="background:#0d1b2e;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
               style="max-width:480px;background:#111f35;border-radius:16px;
                      border:1px solid #1e3358;overflow:hidden;">

          <!-- Header band -->
          <tr>
            <td style="background:#1a2f50;padding:24px 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="width:36px;height:36px;background:#2d5fe8;border-radius:8px;
                              text-align:center;vertical-align:middle;">
                    <span style="color:#ffffff;font-size:20px;font-weight:700;
                                 line-height:36px;display:inline-block;">O</span>
                  </td>
                  <td style="padding-left:12px;color:#8aafd4;
                             font-size:11px;font-weight:600;letter-spacing:.12em;
                             text-transform:uppercase;vertical-align:middle;">
                    ORCHID &middot; Administrator Access
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 28px;">
              <p style="margin:0 0 6px;color:#c8daf5;font-size:13px;font-weight:600;
                        text-transform:uppercase;letter-spacing:.08em;">
                {purpose_label} verification
              </p>
              <h1 style="margin:0 0 16px;color:#e8f0fc;font-size:22px;font-weight:700;
                         line-height:1.3;">
                Your verification code
              </h1>
              <p style="margin:0 0 28px;color:#8aafd4;font-size:14px;line-height:1.6;">
                Use the code below to complete your {purpose_label.lower()}.
                It&nbsp;expires in&nbsp;<strong style="color:#c8daf5;">10&nbsp;minutes</strong>
                and can only be used once.
              </p>

              <!-- Code pill -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0"
                     style="margin:0 auto 28px;">
                <tr>
                  <td style="background:#1a2f50;border:1px solid #2d5fe8;border-radius:12px;
                              padding:18px 40px;text-align:center;">
                    <span style="font-size:36px;font-weight:700;letter-spacing:.22em;
                                 color:#ffffff;font-variant-numeric:tabular-nums;">
                      {code}
                    </span>
                  </td>
                </tr>
              </table>

              <p style="margin:0;color:#5a7aa8;font-size:12px;line-height:1.6;
                        border-top:1px solid #1e3358;padding-top:20px;">
                If you did not request this code, you can safely ignore this message.
                Your account remains secure.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#0d1b2e;padding:16px 32px;
                       border-top:1px solid #1e3358;">
              <p style="margin:0;color:#3a5578;font-size:11px;text-align:center;">
                ORCHID Weather Monitoring System &mdash; Ormoc City
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""
        message = EmailMessage()
        message["Subject"] = f"ORCHID {purpose_label} verification code"
        message["From"] = sender
        message["To"] = recipient
        message.set_content(plain_text)
        message.add_alternative(html_body, subtype="html")
        context = ssl.create_default_context()
        try:
            if smtp_port == 465:
                with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=15, context=context) as server:
                    if smtp_user:
                        server.login(smtp_user, smtp_password)
                    server.send_message(message)
            else:
                with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                    server.starttls(context=context)
                    if smtp_user:
                        server.login(smtp_user, smtp_password)
                    server.send_message(message)
        except (OSError, smtplib.SMTPException) as error:
            print(f"Could not send an ORCHID verification email: {error}", file=sys.stderr)
            raise RuntimeError("The verification email could not be sent. Check the SMTP configuration and try again.") from error

    def record_account_audit(self, connection, actor, action, details):
        connection.execute("""
            INSERT INTO audit_events (created_at, actor, action, node_id, details)
            VALUES (?, ?, ?, 0, ?)
        """, (
            datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            actor,
            action,
            json.dumps(details, separators=(",", ":"))
        ))

    def open_database(self):
        if not os.path.isfile(DB_FILE):
            connection = sqlite3.connect(DB_FILE, timeout=30)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=NORMAL")
            initialize_storage_schema(connection)
            connection.commit()
            return connection
        connection = sqlite3.connect(DB_FILE, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        return connection

    def handle_api_get(self, path, query=""):
        if path == "/api/auth/status":
            if MOCK_DATA_ENABLED:
                session = self.current_session(refresh=False)
                self.send_json(200, {
                    "setup_required": False,
                    "account_exists": True,
                    "authenticated": session is not None,
                    "mock_mode": True,
                    "account_email": DEMO_ACCOUNT["email"],
                    "mail_configured": False,
                    "account": {
                        "display_name": session["display_name"],
                        "email": session["email"]
                    } if session else None
                })
                return
            account = self.account_row()
            session = self.current_session(refresh=False)
            self.send_json(200, {
                "setup_required": account is None,
                "account_exists": account is not None,
                "authenticated": session is not None,
                "account_email": account["email"] if account else ADMIN_EMAIL,
                "mail_configured": bool(
                    os.environ.get("ORCHID_SMTP_HOST", "").strip() and
                    os.environ.get("ORCHID_SMTP_FROM", os.environ.get("ORCHID_SMTP_USER", "")).strip()
                ),
                "account": {
                    "display_name": session["display_name"],
                    "email": session["email"]
                } if session else None
            })
            return

        if path == "/api/account":
            account = self.account_row()
            if not account:
                self.send_json(404, {"error": "Administrator account has not been set up."})
                return
            self.send_json(200, {
                "display_name": account["display_name"],
                "email": account["email"],
                "email_verified": True
            })
            return

        if path == "/api/audit":
            if MOCK_DATA_ENABLED:
                self.send_json(200, {"events": list(reversed(MOCK_AUDIT_EVENTS[-500:])), "limit": 500})
                return
            with closing(self.open_database()) as connection:
                rows = connection.execute("""
                    SELECT id, created_at, actor, action, node_id, details
                    FROM audit_events
                    ORDER BY id DESC
                    LIMIT 5000
                """).fetchall()
            self.send_json(200, {"events": [dict(row) for row in rows], "limit": 5000})
            return

        if path == "/api/nodes/date-range":
            manila_timezone = datetime.timezone(datetime.timedelta(hours=8))

            def date_in_manila(value):
                if not value:
                    return None
                timestamp = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
                if timestamp.tzinfo is None:
                    timestamp = timestamp.replace(tzinfo=datetime.timezone.utc)
                return timestamp.astimezone(manila_timezone).date().isoformat()

            if MOCK_DATA_ENABLED:
                timestamps = [
                    reading.get("createdAt")
                    for node in build_mock_nodes()
                    for reading in node.get("recentReadings", [])
                    if isinstance(reading.get("createdAt"), str)
                ]
                dates = [date_in_manila(timestamp) for timestamp in timestamps]
                dates = [date for date in dates if date is not None]
                self.send_json(200, {
                    "startDate": min(dates) if dates else None,
                    "endDate": max(dates) if dates else None
                })
                return

            with closing(self.open_database()) as connection:
                row = connection.execute(
                    "SELECT MIN(created_at) AS first_reading, MAX(created_at) AS last_reading FROM readings"
                ).fetchone()
            self.send_json(200, {
                "startDate": date_in_manila(row["first_reading"]),
                "endDate": date_in_manila(row["last_reading"])
            })
            return

        if path == "/api/nodes":
            query_params = parse_qs(query)
            requested_date = query_params.get("date", [None])[0]
            requested_start_date = query_params.get("startDate", [None])[0]
            requested_end_date = query_params.get("endDate", [None])[0]
            if requested_date is not None and requested_start_date is None and requested_end_date is None:
                requested_start_date = requested_date
                requested_end_date = requested_date
            if (requested_start_date is None) != (requested_end_date is None):
                self.send_json(400, {"error": "Both startDate and endDate are required."})
                return
            selected_start_date = None
            selected_end_date = None
            if requested_start_date is not None:
                try:
                    selected_start_date = datetime.date.fromisoformat(requested_start_date)
                    selected_end_date = datetime.date.fromisoformat(requested_end_date)
                except ValueError:
                    self.send_json(400, {"error": "Dates must use the YYYY-MM-DD format."})
                    return
                if (selected_start_date.isoformat() != requested_start_date or
                        selected_end_date.isoformat() != requested_end_date):
                    self.send_json(400, {"error": "Dates must use the YYYY-MM-DD format."})
                    return
                today_pht = datetime.datetime.now(datetime.timezone.utc).astimezone(
                    datetime.timezone(datetime.timedelta(hours=8))
                ).date()
                range_days = (selected_end_date - selected_start_date).days + 1
                if selected_start_date > selected_end_date:
                    self.send_json(400, {"error": "Start date must be on or before end date."})
                    return
                if selected_end_date > today_pht:
                    self.send_json(400, {"error": "Future dates are unavailable."})
                    return
                if range_days > 30:
                    self.send_json(400, {"error": "Date ranges cannot exceed 30 days."})
                    return

            if MOCK_DATA_ENABLED:
                nodes = build_mock_nodes()
                if selected_start_date is not None:
                    nodes = [{
                        **node,
                        "dateReadings": [
                            reading for reading in node["recentReadings"]
                            if selected_start_date.isoformat() <= datetime.datetime.fromisoformat(reading["createdAt"])
                            .astimezone(datetime.timezone(datetime.timedelta(hours=8))).date().isoformat()
                            <= selected_end_date.isoformat()
                        ]
                    } for node in nodes]
                self.send_json(200, {
                    "nodes": nodes,
                    "online_window_minutes": int(ONLINE_WINDOW.total_seconds() / 60),
                    "dataMode": "mock"
                })
                return
            with closing(self.open_database()) as connection, connection:
                reading_columns = {
                    row["name"] for row in connection.execute("PRAGMA table_info(readings)")
                }
                heat_index_expression = "heat_index" if "heat_index" in reading_columns else "NULL AS heat_index"
                latest_heat_index_column = "" if "heat_index" in reading_columns else ", NULL AS heat_index"
                rows = connection.execute(f"""
                    WITH node_ids AS (
                        SELECT node_id FROM nodes
                        UNION
                        SELECT node_id FROM readings
                    ),
                    latest_readings AS (
                        SELECT r.*{latest_heat_index_column}
                        FROM readings r
                        JOIN (
                            SELECT node_id, MAX(id) AS latest_id
                            FROM readings
                            GROUP BY node_id
                        ) latest ON latest.latest_id = r.id
                    )
                    SELECT ids.node_id, n.last_seen, n.last_battery_mv,
                           n.status_flags AS node_status_flags, n.uptime_counter,
                           r.created_at, r.temperature, r.humidity, r.pressure,
                           r.heat_index, r.battery_mv, r.status_flags AS reading_status_flags,
                           r.weather, p.location_name, p.latitude, p.longitude
                    FROM node_ids ids
                    LEFT JOIN nodes n ON n.node_id = ids.node_id
                    LEFT JOIN latest_readings r ON r.node_id = ids.node_id
                    LEFT JOIN map_placements p ON p.node_id = ids.node_id
                    ORDER BY ids.node_id
                """).fetchall()
                # Get distinct node IDs from the lightweight nodes table first,
                # then fetch the latest 120 readings per node using the index.
                node_id_rows = connection.execute(
                    "SELECT node_id FROM nodes UNION SELECT DISTINCT node_id FROM readings"
                ).fetchall()
                recent_parts = []
                recent_params = []
                for nrow in node_id_rows:
                    recent_parts.append(f"""
                        SELECT node_id, created_at, temperature, humidity, pressure, {heat_index_expression}
                        FROM readings
                        WHERE node_id = ?
                        ORDER BY id DESC
                        LIMIT 120
                    """)
                    recent_params.append(nrow["node_id"])
                if recent_parts:
                    recent_rows = connection.execute(
                        " UNION ALL ".join(recent_parts), recent_params
                    ).fetchall()
                else:
                    recent_rows = []
                selected_date_rows = []
                if selected_start_date is not None:
                    next_date = selected_end_date + datetime.timedelta(days=1)
                    # Readings are stored in UTC; PHT is UTC+8, so shift the window back 8 hours
                    utc_from = f"{selected_start_date.isoformat()}T00:00:00+08:00"
                    utc_to   = f"{next_date.isoformat()}T00:00:00+08:00"
                    utc_from_dt = datetime.datetime.fromisoformat(utc_from).astimezone(datetime.timezone.utc)
                    utc_to_dt   = datetime.datetime.fromisoformat(utc_to).astimezone(datetime.timezone.utc)
                    max_readings_per_node = 1500 * ((selected_end_date - selected_start_date).days + 1)
                    selected_date_rows = []
                    for nrow in node_id_rows:
                        rows_for_node = connection.execute(f"""
                            SELECT node_id, created_at, temperature, humidity, pressure, {heat_index_expression}
                            FROM readings
                            WHERE node_id = ?
                              AND created_at >= ?
                              AND created_at < ?
                            ORDER BY id DESC
                            LIMIT ?
                        """, (
                            nrow["node_id"],
                            utc_from_dt.strftime("%Y-%m-%dT%H:%M:%S"),
                            utc_to_dt.strftime("%Y-%m-%dT%H:%M:%S"),
                            max_readings_per_node
                        )).fetchall()
                        selected_date_rows.extend(rows_for_node)

            now = datetime.datetime.now()
            recent_by_node = {}
            selected_date_by_node = {}

            def append_readings(rows, destination):
                for reading in rows:
                    try:
                        reading_time = datetime.datetime.fromisoformat(reading["created_at"])
                    except (TypeError, ValueError):
                        age_minutes = None
                    else:
                        if reading_time.tzinfo:
                            age = datetime.datetime.now(datetime.timezone.utc) - reading_time.astimezone(datetime.timezone.utc)
                        else:
                            age = now - reading_time
                        age_minutes = age.total_seconds() / 60
                    destination.setdefault(reading["node_id"], []).append({
                        "createdAt": reading["created_at"],
                        "ageMinutes": age_minutes,
                        "temperature": reading["temperature"],
                        "humidity": reading["humidity"],
                        "pressure": reading["pressure"],
                        "heatIndex": reading["heat_index"]
                    })

            append_readings(recent_rows, recent_by_node)
            append_readings(selected_date_rows, selected_date_by_node)
            nodes = []
            for row in rows:
                seen = row["last_seen"] or row["created_at"]
                try:
                    seen_at = datetime.datetime.fromisoformat(seen) if seen else None
                except (TypeError, ValueError):
                    seen_at = None
                battery_mv = row["last_battery_mv"]
                if battery_mv is None:
                    battery_mv = row["battery_mv"]
                online_window = (
                    LOW_BATTERY_ONLINE_WINDOW
                    if battery_mv is not None and battery_mv < LOW_BATTERY_THRESHOLD_MV
                    else ONLINE_WINDOW
                )
                if seen_at and seen_at.tzinfo:
                    age = datetime.datetime.now(datetime.timezone.utc) - seen_at.astimezone(datetime.timezone.utc)
                else:
                    age = now - seen_at if seen_at else None
                status = "Online" if age is not None and datetime.timedelta(0) <= age <= online_window else "Offline"
                status_flags = row["node_status_flags"]
                if status_flags is None:
                    status_flags = row["reading_status_flags"]

                node_id = row["node_id"]
                key = f"node-{node_id:02d}"
                nodes.append({
                    "key": key,
                    "id": str(node_id),
                    "name": row["location_name"] or "",
                    "location": row["location_name"],
                    "latitude": row["latitude"],
                    "longitude": row["longitude"],
                    "status": status,
                    "lastSeen": seen,
                    "battery": f"{battery_mv} mV" if battery_mv is not None else "--",
                    "uptime": str(row["uptime_counter"]) if row["uptime_counter"] is not None else "--",
                    "sensorStatus": str(status_flags) if status_flags is not None else "Unknown",
                    "temperature": row["temperature"],
                    "mapTemperature": row["temperature"],
                    "humidity": row["humidity"],
                    "pressure": row["pressure"],
                    "heatIndex": row["heat_index"],
                    "weather": row["weather"],
                    "recentReadings": recent_by_node.get(row["node_id"], []),
                    **({"dateReadings": selected_date_by_node.get(row["node_id"], [])}
                       if selected_start_date is not None else {})
                })
            self.send_json(200, {
                "nodes": nodes,
                "online_window_minutes": int(ONLINE_WINDOW.total_seconds() / 60),
                "dataMode": "database"
            })
            return

        if path == "/api/map/placements":
            if MOCK_DATA_ENABLED:
                placements = sorted(MOCK_PLACEMENTS.values(), key=lambda item: item["node_id"])
                self.send_json(200, {"placements": placements, "dataMode": "mock"})
                return
            with closing(self.open_database()) as connection, connection:
                rows = connection.execute("""
                    SELECT node_id, location_name, latitude, longitude
                    FROM map_placements ORDER BY node_id
                """).fetchall()
            self.send_json(200, {"placements": [dict(row) for row in rows], "dataMode": "database"})
            return

        if path == "/api/receiver/status":
            import serial.tools.list_ports as _lp
            ports = _lp.comports()
            usb_ports = [p for p in ports if any(k in p.device for k in ['ttyACM', 'ttyUSB', 'COM'])]
            connected = len(usb_ports) > 0
            device = usb_ports[0].device if connected else None
            description = usb_ports[0].description if connected else None
            self.send_json(200, {
                "connected": connected,
                "device": device,
                "description": description
            })
            return

        if path == "/api/activity":
            qs = parse_qs(query)
            limit  = min(int(qs.get("limit",  ["100"])[0]), 500)
            offset = max(int(qs.get("offset", ["0"])[0]),   0)
            with closing(self.open_database()) as connection:
                connection.row_factory = sqlite3.Row
                rows = connection.execute("""
                    SELECT
                        r.id           AS id,
                        r.created_at   AS created_at,
                        r.node_id      AS node_id,
                        p.location_name AS location_name
                    FROM readings r
                    LEFT JOIN map_placements p ON p.node_id = r.node_id
                    ORDER BY r.created_at DESC, r.id DESC
                    LIMIT ? OFFSET ?
                """, (limit, offset)).fetchall()
                total = connection.execute("SELECT COUNT(*) FROM readings").fetchone()[0]
            self.send_json(200, {
                "events": [dict(r) for r in rows],
                "total": total,
                "limit": limit,
                "offset": offset
            })
            return

        self.send_json(404, {"error": "API endpoint not found."})

    def handle_api_post(self, path):
        if not self.check_request_origin():
            return
        try:
            payload = self.request_body()
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})
            return

        if path == "/api/auth/password-reset/request":
            if MOCK_DATA_ENABLED:
                self.send_json(503, {"error": "Password recovery is not available in demonstration mode."})
                return
            if self.code_request_rate_limited(f"password-reset:{self.client_address[0]}"):
                self.send_json(429, {"error": "Too many recovery requests. Try again in 15 minutes."})
                return
            account = self.account_row()
            if account:
                code = self.create_verification("password_reset", {"email": account["email"]})
                try:
                    self.send_verification_email(account["email"], code, "password reset")
                except (RuntimeError, ValueError) as error:
                    AUTH_CHALLENGES.pop("password_reset", None)
                    self.send_json(503, {"error": str(error)})
                    return
            self.send_json(200, {
                "verification_sent": True,
                "message": "If administrator email is configured, a recovery code has been sent. It expires in 10 minutes."
            })
            return

        if path == "/api/auth/password-reset/confirm":
            if MOCK_DATA_ENABLED:
                self.send_json(503, {"error": "Password recovery is not available in demonstration mode."})
                return
            account = self.account_row()
            if not account:
                self.send_json(400, {"error": "Administrator account has not been set up."})
                return
            password = payload.get("new_password")
            if not self.valid_password(password):
                self.send_json(400, {"error": "Password must be 8–128 characters and include an uppercase letter, a number, and a special character."})
                return
            challenge = self.consume_verification("password_reset", payload.get("code"))
            if not challenge:
                return
            if challenge["email"].lower() != account["email"].lower():
                self.send_json(400, {"error": "The administrator email changed. Request a new recovery code."})
                return
            salt, password_hash = self.hash_password(password)
            now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            with closing(self.open_database()) as connection, connection:
                connection.execute("""
                    UPDATE admin_account SET password_salt = ?, password_hash = ?, updated_at = ?
                    WHERE id = 1
                """, (salt, password_hash, now))
                self.record_account_audit(connection, account["display_name"], "account_password_updated", {
                    "message": "Administrator password reset using an email verification code."
                })
            AUTH_SESSIONS.clear()
            self.send_json(200, {"password_reset": True})
            return

        if path == "/api/auth/setup":
            if self.account_row():
                self.send_json(409, {"error": "The administrator account has already been set up."})
                return
            password = payload.get("password")
            if not self.valid_password(password):
                self.send_json(400, {"error": "Password must be 8–128 characters and include an uppercase letter, a number, and a special character."})
                return
            salt, password_hash = self.hash_password(password)
            display_name = ADMIN_DISPLAY_NAME
            email = DEMO_ACCOUNT["email"] if MOCK_DATA_ENABLED else ADMIN_EMAIL
            if MOCK_DATA_ENABLED:
                DEMO_ACCOUNT.update({
                    "display_name": display_name,
                    "password_salt": salt,
                    "password_hash": password_hash
                })
            else:
                with closing(self.open_database()) as connection, connection:
                    connection.execute("""
                        INSERT INTO admin_account
                            (id, display_name, email, password_salt, password_hash, created_at, updated_at)
                        VALUES (1, ?, ?, ?, ?, ?, ?)
                    """, (
                        display_name, email, salt, password_hash,
                        datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                        datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                    ))
                    self.record_account_audit(connection, display_name, "account_created", {
                        "message": "Administrator account created with a local password."
                    })
            self.send_json(200, {"account_created": True})
            return

        if path == "/api/auth/login":
            key = f"login:{self.client_address[0]}"
            if self.login_rate_limited(key):
                self.send_json(429, {"error": "Too many sign-in attempts. Try again in 15 minutes."})
                return
            account = self.account_row()
            if not account:
                self.send_json(409, {"error": "Administrator access is not set up yet. Save a password first."})
                return
            password = payload.get("password")
            valid = self.verify_password(account, password)
            self.record_login_attempt(key, bool(valid))
            if not valid:
                self.send_json(401, {"error": "Password is incorrect."})
                return
            if MOCK_DATA_ENABLED:
                record_audit_event(None, "session_login", {"message": "Demo administrator signed in."},
                                   actor=account["display_name"])
            else:
                with closing(self.open_database()) as connection, connection:
                    self.record_account_audit(connection, account["display_name"], "session_login", {
                        "message": "Administrator signed in with a password."
                    })
            self.establish_session(account["display_name"], account["email"])
            return

        session = self.require_session()
        if not session:
            return

        if path == "/api/account/password/request":
            if self.code_request_rate_limited(f"password-change:{self.client_address[0]}"):
                self.send_json(429, {"error": "Too many password-change requests. Try again in 15 minutes."})
                return
            account = self.account_row()
            code = self.create_verification("password_change", {"email": account["email"]})
            try:
                self.send_verification_email(account["email"], code, "password change")
            except (RuntimeError, ValueError) as error:
                AUTH_CHALLENGES.pop("password_change", None)
                self.send_json(503, {"error": str(error)})
                return
            self.send_json(200, {
                "verification_sent": True,
                "sent_to": account["email"],
                "expires_in_seconds": VERIFICATION_TTL_SECONDS
            })
            return

        if path == "/api/account/password/verify":
            account = self.account_row()
            password = payload.get("new_password")
            if not self.valid_password(password):
                self.send_json(400, {"error": "Password must be 8–128 characters and include an uppercase letter, a number, and a special character."})
                return
            challenge = self.consume_verification("password_change", payload.get("code"))
            if not challenge:
                return
            if challenge["email"].lower() != account["email"].lower() or \
                    session["email"].lower() != account["email"].lower():
                self.send_json(400, {"error": "The administrator email changed. Request a new verification code."})
                return
            salt, password_hash = self.hash_password(password)
            now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            with closing(self.open_database()) as connection, connection:
                connection.execute("""
                    UPDATE admin_account SET password_salt = ?, password_hash = ?, updated_at = ?
                    WHERE id = 1
                """, (salt, password_hash, now))
                self.record_account_audit(connection, account["display_name"], "account_password_updated", {
                    "message": "Administrator password changed after email verification."
                })
            AUTH_SESSIONS.clear()
            self.establish_session(account["display_name"], account["email"])
            return

        if path == "/api/auth/logout":
            if MOCK_DATA_ENABLED:
                record_audit_event(None, "session_logout", {"message": "Demo administrator signed out."},
                                   actor=session["display_name"])
            else:
                with closing(self.open_database()) as connection, connection:
                    self.record_account_audit(connection, session["display_name"], "session_logout", {
                        "message": "Administrator signed out."
                    })
            cookie_header = self.headers.get("Cookie", "")
            for part in cookie_header.split(";"):
                name, separator, value = part.strip().partition("=")
                if separator and name == "orchid_session":
                    token_hash = hashlib.sha256(value.encode("ascii", errors="ignore")).hexdigest()
                    AUTH_SESSIONS.pop(token_hash, None)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Set-Cookie", "orchid_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
            self.end_headers()
            self.wfile.write(b'{"signed_out":true}')
            return

        if path == "/api/account/profile":
            account = self.account_row()
            display_name = payload.get("display_name")
            if not isinstance(display_name, str) or not display_name.strip() or len(display_name.strip()) > 80:
                self.send_json(400, {"error": "Enter a display name between 1 and 80 characters."})
                return
            display_name = display_name.strip()
            with closing(self.open_database()) as connection, connection:
                connection.execute("""
                    UPDATE admin_account SET display_name = ?, updated_at = ?
                    WHERE id = 1
                """, (
                    display_name,
                    datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                ))
                self.record_account_audit(connection, account["display_name"], "account_profile_updated", {
                    "previous": account["display_name"],
                    "current": display_name
                })
            session["display_name"] = display_name
            self.send_json(200, {"updated": True, "display_name": display_name})
            return

        if path == "/api/account/email/request":
            if self.code_request_rate_limited(f"email:{self.client_address[0]}"):
                self.send_json(429, {"error": "Too many email-change requests. Try again in 15 minutes."})
                return
            account = self.account_row()
            new_email = payload.get("new_email", "").strip().lower() if isinstance(payload.get("new_email"), str) else ""
            if not self.valid_email(new_email):
                self.send_json(400, {"error": "Enter a valid new email address."})
                return
            if new_email == account["email"].lower():
                self.send_json(400, {"error": "The new email is already your verified email."})
                return
            try:
                current_code = f"{secrets.randbelow(1_000_000):06d}"
                new_code = f"{secrets.randbelow(1_000_000):06d}"
                salt = secrets.token_bytes(16)
                AUTH_CHALLENGES["email"] = {
                    "new_email": new_email,
                    "current_email": account["email"],
                    "salt": salt,
                    "current_code_hash": hashlib.sha256(salt + current_code.encode("ascii")).digest(),
                    "new_code_hash": hashlib.sha256(salt + new_code.encode("ascii")).digest(),
                    "expires_at": time.time() + VERIFICATION_TTL_SECONDS,
                    "attempts": 0
                }
                self.send_verification_email(account["email"], current_code, "current email")
                self.send_verification_email(new_email, new_code, "new email")
            except (RuntimeError, ValueError) as error:
                AUTH_CHALLENGES.pop("email", None)
                self.send_json(503, {"error": str(error)})
                return
            self.send_json(200, {
                "verification_sent": True,
                "sent_to": [account["email"], new_email],
                "expires_in_seconds": VERIFICATION_TTL_SECONDS
            })
            return

        if path == "/api/account/email/verify":
            challenge = AUTH_CHALLENGES.get("email")
            if not challenge or challenge["expires_at"] <= time.time():
                AUTH_CHALLENGES.pop("email", None)
                self.send_json(400, {"error": "Those verification codes expired. Request new codes."})
                return
            if challenge["attempts"] >= MAX_VERIFICATION_ATTEMPTS:
                AUTH_CHALLENGES.pop("email", None)
                self.send_json(429, {"error": "Too many incorrect codes. Request new codes."})
                return
            current_code = payload.get("current_code")
            new_code = payload.get("new_code")
            if not isinstance(current_code, str) or not re.fullmatch(r"\d{6}", current_code) or \
                    not isinstance(new_code, str) or not re.fullmatch(r"\d{6}", new_code):
                challenge["attempts"] += 1
                self.send_json(400, {"error": "Enter both six-digit verification codes."})
                return
            current_hash = hashlib.sha256(challenge["salt"] + current_code.encode("ascii")).digest()
            new_hash = hashlib.sha256(challenge["salt"] + new_code.encode("ascii")).digest()
            if not hmac.compare_digest(current_hash, challenge["current_code_hash"]) or \
                    not hmac.compare_digest(new_hash, challenge["new_code_hash"]):
                challenge["attempts"] += 1
                self.send_json(400, {"error": "One or both verification codes are incorrect."})
                return
            with closing(self.open_database()) as connection, connection:
                connection.execute("""
                    UPDATE admin_account SET email = ?, updated_at = ?
                    WHERE id = 1
                """, (
                    challenge["new_email"],
                    datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                ))
                self.record_account_audit(connection, session["display_name"], "account_email_updated", {
                    "previous": challenge["current_email"],
                    "current": challenge["new_email"]
                })
            AUTH_CHALLENGES.pop("email", None)
            session["email"] = challenge["new_email"]
            self.send_json(200, {"updated": True, "email": challenge["new_email"]            })
            return

        self.send_json(404, {"error": "API endpoint not found."})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/demo" or parsed.path.startswith("/demo/"):
            self.send_error(404)
            return
        if parsed.path.startswith("/api/"):
            try:
                if parsed.path != "/api/auth/status" and not self.require_session():
                    return
                self.handle_api_get(parsed.path, parsed.query)
            except (sqlite3.Error, OSError) as error:
                self.send_json(503, {"error": f"Could not read ORCHID data: {error}"})
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            self.send_json(404, {"error": "API endpoint not found."})
            return
        try:
            self.handle_api_post(parsed.path)
        except (sqlite3.Error, OSError) as error:
            self.send_json(503, {"error": f"Could not complete the account request: {error}"})

    def do_PUT(self):
        parsed = urlparse(self.path)
        if not self.require_session():
            return
        if not self.check_request_origin():
            return
        prefix = "/api/map/placements/"
        if not parsed.path.startswith(prefix):
            self.send_json(404, {"error": "API endpoint not found."})
            return

        try:
            node_id = int(unquote(parsed.path[len(prefix):]))
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 16384:
                self.send_json(400, {"error": "Request body is missing or too large."})
                return
            payload = json.loads(self.rfile.read(content_length))
            if not isinstance(payload, dict):
                self.send_json(400, {"error": "Placement request must be a JSON object."})
                return
            location = payload.get("location_name")
            latitude = payload.get("latitude")
            longitude = payload.get("longitude")
            if not isinstance(location, str) or not location.strip() or len(location.strip()) > 48:
                self.send_json(400, {"error": "Node name must contain 1 to 48 characters."})
                return
            if (isinstance(latitude, bool) or not isinstance(latitude, (int, float)) or
                    not -90 <= latitude <= 90):
                self.send_json(400, {"error": "Latitude must be between -90 and 90."})
                return
            if (isinstance(longitude, bool) or not isinstance(longitude, (int, float)) or
                    not -180 <= longitude <= 180):
                self.send_json(400, {"error": "Longitude must be between -180 and 180."})
                return
            if MOCK_DATA_ENABLED:
                node = next((node for node in DEMO_FIXTURES["nodes"] if node["id"] == node_id), None)
                if not node:
                    self.send_json(404, {"error": "Node ID does not exist in the mock data."})
                    return
                previous = MOCK_PLACEMENTS.get(node_id)
                current = {
                    "node_id": node_id,
                    "location_name": location.strip(),
                    "latitude": latitude,
                    "longitude": longitude
                }
                MOCK_PLACEMENTS[node_id] = current
                if previous != current:
                    record_audit_event(
                        node_id,
                        "placement_added" if previous is None else "placement_updated",
                        {"previous": previous, "current": current}
                    )
                self.send_json(200, {"saved": True, "node_id": node_id, "dataMode": "mock"})
                return
            with closing(self.open_database()) as connection, connection:
                exists = connection.execute(
                    "SELECT 1 FROM nodes WHERE node_id = ? UNION SELECT 1 FROM readings WHERE node_id = ? LIMIT 1",
                    (node_id, node_id)
                ).fetchone()
                if not exists:
                    self.send_json(404, {"error": "Node ID does not exist in the IoT database."})
                    return
                previous_row = connection.execute("""
                    SELECT node_id, location_name, latitude, longitude
                    FROM map_placements WHERE node_id = ?
                """, (node_id,)).fetchone()
                previous = dict(previous_row) if previous_row else None
                current = {
                    "node_id": node_id,
                    "location_name": location.strip(),
                    "latitude": latitude,
                    "longitude": longitude
                }
                connection.execute("""
                    INSERT INTO map_placements (node_id, location_name, latitude, longitude)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(node_id) DO UPDATE SET
                        location_name = excluded.location_name,
                        latitude = excluded.latitude,
                        longitude = excluded.longitude
                """, (node_id, current["location_name"], latitude, longitude))
                if previous != current:
                    insert_audit_event(
                        connection, node_id,
                        "placement_added" if previous is None else "placement_updated",
                        {"previous": previous, "current": current}
                    )
            self.send_json(200, {"saved": True, "node_id": node_id})
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": f"Invalid placement request: {error}"})
        except (sqlite3.Error, OSError) as error:
            self.send_json(503, {"error": f"Could not save map placement: {error}"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if not self.require_session():
            return
        if not self.check_request_origin():
            return
        prefix = "/api/map/placements/"
        if not parsed.path.startswith(prefix):
            self.send_json(404, {"error": "API endpoint not found."})
            return
        try:
            node_id = int(unquote(parsed.path[len(prefix):]))
            if MOCK_DATA_ENABLED:
                placement = MOCK_PLACEMENTS.pop(node_id, None)
                if placement is None:
                    self.send_json(404, {"error": "Node is not currently placed on the mock map."})
                    return
                record_audit_event(node_id, "placement_removed", {"previous": placement})
                self.send_json(200, {"removed": True, "node_id": node_id, "dataMode": "mock"})
                return
            with closing(self.open_database()) as connection, connection:
                placement = connection.execute("""
                    SELECT node_id, location_name, latitude, longitude
                    FROM map_placements WHERE node_id = ?
                """, (node_id,)).fetchone()
                cursor = connection.execute("DELETE FROM map_placements WHERE node_id = ?", (node_id,))
                if cursor.rowcount == 0:
                    self.send_json(404, {"error": "Node is not currently placed on the map."})
                    return
                insert_audit_event(connection, node_id, "placement_removed", {"previous": dict(placement)})
            self.send_json(200, {"removed": True, "node_id": node_id})
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": f"Invalid node ID: {error}"})
        except (sqlite3.Error, OSError) as error:
            self.send_json(503, {"error": f"Could not remove map placement: {error}"})


def create_server():
    for port in range(START_PORT, END_PORT + 1):
        try:
            return socketserver.TCPServer(("127.0.0.1", port), Handler), port
        except OSError:
            continue
    raise OSError(f"No available local port between {START_PORT} and {END_PORT}.")


def insert_audit_event(connection, node_id, action, details):
    connection.execute("""
        INSERT INTO audit_events (created_at, actor, action, node_id, details)
        VALUES (?, ?, ?, ?, ?)
    """, (
        datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "Local operator",
        action,
        node_id,
        json.dumps(details, separators=(",", ":"))
    ))


def record_audit_event(node_id, action, details, actor="Local operator"):
    MOCK_AUDIT_EVENTS.append({
        "id": len(MOCK_AUDIT_EVENTS) + 1,
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "actor": actor,
        "action": action,
        "node_id": node_id,
        "details": json.dumps(details, separators=(",", ":"))
    })


def initialize_storage_schema(connection):
    connection.execute("""
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
    connection.execute("""
        CREATE INDEX IF NOT EXISTS idx_readings_node_time
            ON readings (node_id, created_at DESC)
    """)
    connection.execute("""
        CREATE INDEX IF NOT EXISTS idx_readings_created_at
            ON readings (created_at)
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS nodes (
            node_id         INTEGER PRIMARY KEY,
            last_seen       TEXT,
            last_battery_mv INTEGER,
            status_flags    INTEGER,
            uptime_counter  INTEGER
        )
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS map_placements (
            node_id INTEGER PRIMARY KEY,
            location_name TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL
        )
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            node_id INTEGER NOT NULL,
            details TEXT NOT NULL
        )
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS admin_account (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            display_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_salt BLOB NOT NULL,
            password_hash BLOB NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)


def load_mock_audit_events():
    now = datetime.datetime.now(datetime.timezone.utc)
    for index, sample in enumerate(DEMO_FIXTURES["audit_events"], start=1):
        created_at = now - datetime.timedelta(minutes=sample["minutes_ago"])
        MOCK_AUDIT_EVENTS.append({
            "id": index,
            "created_at": created_at.isoformat(timespec="seconds"),
            "actor": sample["actor"],
            "action": sample["action"],
            "node_id": sample["node_id"],
            "details": json.dumps(sample["details"], separators=(",", ":"))
        })


def main():
    global MOCK_DATA_ENABLED, MOCK_AUDIT_EVENTS
    parser = argparse.ArgumentParser(description="Start the ORCHID local dashboard.")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser automatically.")
    parser.add_argument("--mock-data", action="store_true", help="Use temporary in-memory demo data instead of the database.")
    args = parser.parse_args()
    MOCK_DATA_ENABLED = args.mock_data
    if MOCK_DATA_ENABLED:
        MOCK_AUDIT_EVENTS = []
        try:
            load_demo_fixtures()
        except (OSError, ValueError, json.JSONDecodeError) as error:
            raise SystemExit(f"Could not load demo fixtures from {DEMO_DIR}: {error}") from error
        load_mock_audit_events()

    if not MOCK_DATA_ENABLED:
        try:
            with closing(sqlite3.connect(DB_FILE, timeout=5)) as connection, connection:
                initialize_storage_schema(connection)
                connection.commit()
        except sqlite3.Error as error:
            raise SystemExit(f"Could not initialize database storage: {error}") from error

        # Ensure indexes exist and enable WAL for the serve process
        try:
            with closing(sqlite3.connect(DB_FILE, timeout=30)) as connection, connection:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.execute("PRAGMA synchronous=NORMAL")
        except sqlite3.Error as error:
            raise SystemExit(f"Could not initialize database settings: {error}") from error

    httpd, port = create_server()
    url = f"http://127.0.0.1:{port}/html/dashboard.html"
    mode = "temporary mock data (changes reset when the server stops)" if MOCK_DATA_ENABLED else "the ORCHID database"
    print(f"ORCHID dashboard: {url}", flush=True)
    print(f"Data source: {mode}", flush=True)
    print("Press Ctrl+C to stop the server.\n", flush=True)

    try:
        if not args.no_browser:
            webbrowser.open(url)
        # Start background maintenance threads (daemon so they die with the process)
        threading.Thread(target=_run_maintenance, daemon=True, name="orchid-maintenance").start()
        threading.Thread(target=_run_session_janitor, daemon=True, name="orchid-session-janitor").start()
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
