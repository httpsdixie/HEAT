# ORCHID — Building the Portable Windows Package

Do this **once** on any Windows machine. After that, copy the folder to any PC or USB
and it runs with a double-click — no Python, no Git, no VS Code required.

---

## Step 1 — Download the Python embeddable runtime

1. Go to https://www.python.org/downloads/windows/
2. Under the latest Python 3.12.x release, click **Windows embeddable package (64-bit)**
   — the file will be named something like `python-3.12.x-embed-amd64.zip`
3. Create a folder called `python-runtime` inside the ORCHID project folder
4. Unzip everything from that zip directly into `python-runtime\`

You should now have:
```
ORCHID\
  python-runtime\
    python.exe
    python312.zip
    python312.dll
    ...
```

---

## Step 2 — Enable pip in the embeddable runtime

1. Open `python-runtime\python312._pth` in Notepad
2. Find the line that says `#import site` and remove the `#` so it reads:
   ```
   import site
   ```
3. Save the file

---

## Step 3 — Install pip

1. Download `get-pip.py` from https://bootstrap.pypa.io/get-pip.py
2. Save it into the `python-runtime\` folder
3. Open Command Prompt, navigate to `python-runtime\`:
   ```
   cd C:\path\to\ORCHID\python-runtime
   python.exe get-pip.py
   ```

---

## Step 4 — Install pyserial

Still in Command Prompt inside `python-runtime\`:
```
python.exe -m pip install pyserial --target=.
```

---

## Step 5 — Test it

Double-click `start-dashboard.bat` in the ORCHID folder.
The dashboard should open in your browser automatically.

---

## Step 6 — Copy to USB / hand off

Copy the entire ORCHID folder (including `python-runtime\`) to a USB drive.
On any Windows PC: plug in USB → open folder → double-click `start-dashboard.bat`. Done.

The `python-runtime\` folder is about 25–30 MB.

---

## Updating the app later

To push an update:
- Replace the `js\`, `html\`, `css\`, `components\` files only
- Do NOT replace `python-runtime\`, `DB\orchid.db`, or `.env`
- The recipients never need to do anything — just restart `start-dashboard.bat`
