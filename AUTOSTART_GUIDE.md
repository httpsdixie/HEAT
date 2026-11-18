# ORCHID — Auto-Start & Emergency Password Reset Guide

This guide is written for whoever operates the ORCHID workstation.
No technical background is needed to follow it.

---

## Part 1 — Auto-start on boot

By default, ORCHID only starts when someone double-clicks the start script.
If the PC restarts (power cut, Windows update, accidental reboot), ORCHID
stays off until a person manually starts it again.

The auto-start installer fixes this. Run it once and ORCHID will start
automatically every time the workstation turns on or the user logs in.

---

### Windows

**To enable auto-start:**

1. Open the ORCHID folder
2. Open the `setup` folder
3. Double-click `install-autostart-windows.bat`
4. A window will appear briefly and confirm it worked

ORCHID will now start automatically every time you log in to Windows.
It opens minimised so it does not get in the way.

> The first start after login is delayed 30 seconds to give Windows time
> to finish loading before ORCHID tries to open the browser.

**To disable auto-start:**

1. Open the `setup` folder
2. Double-click `uninstall-autostart-windows.bat`

Or open **Task Scheduler** (search for it in the Start menu), find the task
named **"ORCHID Dashboard"**, right-click it, and choose **Delete**.

---

### Linux

**To enable auto-start:**

1. Open a terminal inside the ORCHID folder
2. Run:
   ```
   ./setup/install-autostart-linux.sh
   ```
3. The script will confirm it worked

ORCHID will now start automatically every time you log in.

To start it immediately without logging out first:
```
systemctl --user start orchid-serve orchid-logger
```

To check if it is running:
```
systemctl --user status orchid-serve
systemctl --user status orchid-logger
```

To view the live log output:
```
journalctl --user -u orchid-serve -f
journalctl --user -u orchid-logger -f
```

**To disable auto-start:**
```
./setup/uninstall-autostart-linux.sh
```

> **Headless / server installs:** The installer also runs
> `loginctl enable-linger` so ORCHID starts at boot even when no one
> is logged in to a desktop session. This is what you want for a
> dedicated workstation that runs 24/7.

---

## Part 2 — Emergency password reset

ORCHID's normal password recovery sends a verification code to the
administrator email. If that email is unreachable or SMTP is not
configured, you will not receive the code and cannot sign in.

The emergency reset tool bypasses email entirely and sets a new password
directly in the database.

---

### When to use it

- You forgot the administrator password and cannot receive a recovery email
- SMTP is not configured and password recovery fails
- The administrator email address is no longer accessible

---

### How to use it

> **Stop ORCHID first.** The reset tool needs exclusive access to the
> database. If ORCHID is running, close its terminal window before
> continuing.

**Windows:**

1. Open Command Prompt inside the ORCHID folder
2. Run:
   ```
   python-runtime\python.exe scripts\reset_password.py
   ```

**Linux:**

1. Open a terminal inside the ORCHID folder
2. Run:
   ```
   python3 scripts/reset_password.py
   ```

The tool will:
1. Find the administrator account in the database and show the name and email
2. Ask you to type a new password (characters are hidden as you type)
3. Ask you to type it a second time to confirm
4. Write the new password to the database and confirm success

You can then start ORCHID normally and sign in with the new password.

---

### Password requirements

The new password must:
- Be between 8 and 128 characters
- Contain at least one uppercase letter (A–Z)
- Contain at least one number (0–9)
- Contain at least one special character (e.g. `!`, `@`, `#`, `$`, `%`)

Example of a valid password: `Orchid2026!`

---

### What if the database does not exist yet?

The reset tool will tell you the database was not found. This means ORCHID
has never been started, or the database was moved or deleted. Start ORCHID
normally, complete the first-time setup in the browser, and then use the
reset tool if needed.

---

### Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| "Database not found" | ORCHID has never run, or DB was deleted | Start ORCHID once to create the database |
| "Could not read the database: database is locked" | ORCHID is still running | Close the ORCHID terminal window, then try again |
| "No administrator account found" | First-time setup was never completed | Open ORCHID in a browser and complete setup first |
| "Too many failed attempts" | Entered wrong password 3 times | Run the script again |
| Password is rejected | Does not meet complexity rules | Include an uppercase letter, a number, and a special character |
