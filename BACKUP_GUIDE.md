# ORCHID — Database Backup Guide

This guide is written for whoever operates the ORCHID workstation.
No technical background is needed to follow it.

---

## What gets backed up

ORCHID stores everything — all sensor readings, sensor placements, and the
administrator account — in a single file:

```
DB/orchid.db
```

The backup system automatically copies this file every time ORCHID starts.
Copies are saved here:

```
DB/backups/orchid_backup_YYYY-MM-DDTHH-MM-SSZ.db
```

The seven most recent copies are kept. Older ones are deleted automatically.

---

## Automatic backups (nothing to do)

Every time you double-click `start-dashboard.bat` (Windows) or run
`start-dashboard.sh` (Linux), ORCHID backs up the database before it starts.
You will see a line like this in the startup window:

```
Running database backup...
  Backup saved: orchid_backup_2026-11-18T10-30-00Z.db (1024 KB)
  Backups kept: 4 / 7
Done.
```

That means it worked. You do not need to do anything else.

If a line says **"Warning: backup did not complete"**, the system still starts
normally, but the backup failed. Check the section below on what to do.

---

## Manual backup (run any time)

You can make an extra backup at any time — for example, before making major
changes or before handing the system over to someone else.

**Windows:**
1. Open Command Prompt inside the ORCHID folder
2. Run: `python-runtime\python.exe scripts\backup_db.py`

**Linux:**
1. Open a terminal inside the ORCHID folder
2. Run: `python3 scripts/backup_db.py`

A new timestamped copy will appear in `DB/backups/`.

---

## Copying backups to a USB drive (strongly recommended)

The automatic backups are stored on the **same computer** as the original.
If the PC dies or the drive fails, both the original and backups are lost.

**Once a week** (or after any important event), copy the entire `DB/backups/`
folder to a USB drive or a second computer:

1. Plug in the USB drive
2. Open the ORCHID folder → open `DB` → open `backups`
3. Select all files → Copy → Paste into a folder on the USB drive

Label the USB drive clearly: **"ORCHID DB Backups"**.

---

## Restoring from a backup

If `orchid.db` is lost or corrupted, you can restore from the most recent
backup copy.

1. Stop ORCHID if it is running (close the terminal window)
2. Go to `DB/backups/`
3. Find the most recent file — it has the latest date in the filename
4. Copy that file into the `DB/` folder
5. Rename it to `orchid.db`
6. Start ORCHID normally

> If `DB/orchid.db` already exists but is corrupted, rename it first
> (e.g. `orchid.db.broken`) before copying the backup in, so you have
> a record of what was there.

---

## Changing how many copies are kept

The default is **7 copies** (roughly one week of daily startups).

To keep more or fewer copies, open `.env` in a text editor and add:

```
ORCHID_BACKUP_KEEP=14
```

Replace `14` with however many copies you want. Changes take effect the next
time ORCHID starts.

---

## Storing backups in a different location

By default backups go into `DB/backups/` inside the ORCHID folder.
To point them somewhere else (e.g. directly onto a mapped network drive or
a second hard drive), open `.env` and add:

```
ORCHID_BACKUP_DIR=D:\ORCHID-Backups
```

Use the full path to the folder. It will be created automatically if it does
not exist. Changes take effect the next time ORCHID starts.

---

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| "Warning: backup did not complete" at startup | `DB/backups/` could not be written, or the database is locked | Check that the ORCHID folder is not on a read-only drive; restart and try again |
| `DB/backups/` folder is empty | ORCHID has never been started in real-data mode, or the backup folder was manually deleted | Start ORCHID normally once and the first backup will be created |
| All backup files have the same date | The PC clock is wrong | Correct the system clock; the content of the backup is still valid |
| Restored database shows old data | You restored from an older copy | Repeat the restore using the file with the most recent date in its name |
