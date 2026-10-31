# ORCHID account setup and security

ORCHID uses one shared administrator account and a local password for the trusted workstation. On first run, create a unique password from the setup screen. It is stored as a salted scrypt hash in SQLite. The administrator email defaults to `admin@orchid.local`; configure `ORCHID_ADMIN_EMAIL` before first setup to use a real address. It can also be changed from System Settings. This simple shared-password approach is intended only for the loopback-only trusted workstation; do not expose the app to a network.

| Environment variable | Purpose |
| --- | --- |
| `ORCHID_ADMIN_EMAIL` | Initial administrator email; set before first setup |
| `ORCHID_SMTP_HOST` | SMTP server hostname |
| `ORCHID_SMTP_PORT` | SMTP port; defaults to `587` (STARTTLS); port `465` uses TLS |
| `ORCHID_SMTP_USER` | Optional SMTP login name; also the default sender address |
| `ORCHID_SMTP_PASSWORD` | Optional SMTP password, when the server requires login |
| `ORCHID_SMTP_FROM` | Sender address; required unless provided by `ORCHID_SMTP_USER` |

SMTP is not needed for setup or sign-in. It is required for password recovery, password changes, and account email changes. Email changes require verification codes sent to both the current and new addresses. Set SMTP values in the server's environment. Keep SMTP credentials private and never enter them in the app or commit them to the project.

For a Google-hosted mailbox, use `smtp.gmail.com` on port `587` with STARTTLS. Google SMTP authentication typically requires two-step verification and an App Password; use the mailbox authorized to send ORCHID mail as `ORCHID_SMTP_USER`, its App Password as `ORCHID_SMTP_PASSWORD`, and an authorized sender as `ORCHID_SMTP_FROM`. Set these values only in the server environment. The recipient address is configured by the application and is separate from the sending mailbox.

The password must be 8–128 characters. Sign-in and code requests are rate limited. Password recovery and password changes require a single-use code sent to the administrator email. Email changes require codes delivered to both the current and new addresses. Manage account details from the profile menu's **System Settings** entry.

Account, profile, email, sign-in, and sign-out changes are written to the Audit Trail. Passwords are never recorded. The account is stored in the ORCHID SQLite database. Back up that database securely.

This implementation is intended for the app's current loopback-only workstation server. Sessions are held in memory and expire eight hours after the most recent authenticated API activity; restarting the server signs everyone out. Do not expose this HTTP server to a LAN or the public internet. A network deployment needs HTTPS, durable/revocable sessions, and a deployment-specific security review first.
