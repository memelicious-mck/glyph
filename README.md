# Glyph

A lightweight desktop scratchpad for daily notes, TODOs, and follow-ups - organized by calendar day.

## Download

Grab the latest build from **[Releases](https://github.com/memelicious-mck/glyph/releases/latest)** - available for Windows, macOS, and Linux. No setup required for the portable version; just download and run.

## Features

- **Day-based workspace** — each day gets its own notes, TODOs, and follow-ups
- **Calendar navigation** — jump to any date; days with data are marked
- **TODOs** with checkboxes and **follow-ups** with resolved/unresolved state
- **Rich notes** with inline callout blocks (collapsible, titled sections)
- **System tray** — minimizes to tray, stays running in the background
- **Global shortcut** to show/hide from anywhere (default `Ctrl+Alt+N`)
- **Configurable keyboard shortcuts** — new note, new TODO, new follow-up, callout toggle, pin window - all rebindable from settings
- **Accent color picker** — choose any color for the UI accent
- **Section reordering** — drag TODOs, follow-ups, and notes into your preferred order
- **Always-on-top** toggle (pin the window above everything)
- **Frameless acrylic window** on Windows, transparent on other platforms
- **Local-first** — all data stored as JSON in your user data folder, never leaves your machine

## Tech Stack


| Layer     | Technology              |
| --------- | ----------------------- |
| Shell     | Electron                |
| UI        | Vanilla HTML / CSS / JS |
| Data      | Local JSON file         |
| Packaging | electron-builder        |

## Google Tasks Synchronization

Glyph features a built-in, fast two-way sync with Google Tasks. When enabled, your TODOs will automatically back up to a "Glyph Sync" list in your Google account and sync with your mobile devices.

### How to Enable Sync

1. Open Glyph and click the **Settings** gear icon in the top right.
2. Scroll down to the **Google Tasks** section and click **Login**.
3. Your web browser will open to a Google sign-in page. Choose your Google account.
4. **Safety Warning**: Because Glyph is an independent desktop application, Google may display a "Google hasn't verified this app" warning. This is perfectly normal! 
   - Click **Advanced** (or "Continue") at the bottom of the warning.
   - Click **Go to Glyph (unsafe)**.
5. Click **Continue** to grant Glyph permission to manage your Tasks.
6. The browser tab will automatically close (or tell you it's safe to close), and Glyph will now display a ☁️ icon indicating that synchronization is active!

### Technical Details (Under the Hood)

- **Pushing (Glyph -> Google)**: Keystrokes are automatically debounced. Glyph will wait exactly **1.5 seconds** after you stop typing before silently pushing your TODO directly to Google Tasks. This prevents rate-limiting and duplicate tasks.
- **Pulling (Google -> Glyph)**: A background timer reaches out to Google Tasks every **30 seconds** to fetch changes. If you check off a task on your phone, it will appear checked in Glyph almost immediately.
- **ID Merging**: Overlapping edits are handled safely via an asynchronous queue. Google Task IDs are perfectly merged into your local `data.json` so you never get duplicate entries.
- **Tokens**: Your OAuth tokens are securely isolated inside a `google-tokens.json` file in your system's User Data directory.

---
_Glyph_
