"""
disable_close.py
Disables the X (close) button on the current console window.
Run this once at the start of start-dashboard.bat before anything else.
"""
import ctypes
import ctypes.wintypes

# Windows API constants
SC_CLOSE     = 0xF060
MF_BYCOMMAND = 0x0000
MF_GRAYED    = 0x0001

def disable_close_button():
    try:
        # Set the console window title so we can find it
        ctypes.windll.kernel32.SetConsoleTitleW("ORCHID Weather Station")

        # Give Windows a moment to register the new title
        import time; time.sleep(0.2)

        # Find the console window by title
        hwnd = ctypes.windll.user32.FindWindowW("ConsoleWindowClass", "ORCHID Weather Station")
        if not hwnd:
            # Try the other class name used by Windows Terminal
            hwnd = ctypes.windll.user32.FindWindowW("CASCADIA_HOSTING_WINDOW_CLASS", None)
        if not hwnd:
            return  # Can't find window — skip silently

        # Get the system menu and grey out / remove the Close item
        hmenu = ctypes.windll.user32.GetSystemMenu(hwnd, False)
        if hmenu:
            ctypes.windll.user32.DeleteMenu(hmenu, SC_CLOSE, MF_BYCOMMAND)
    except Exception:
        pass  # Never crash the main app over this

if __name__ == "__main__":
    disable_close_button()
