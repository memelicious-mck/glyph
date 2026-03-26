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


---
_Glyph_