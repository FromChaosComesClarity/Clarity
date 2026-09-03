Clarity 1.9.0

Windows games now run on macOS, and a panel that had no business being on Linux is gone.

## New

**Windows games on macOS, through CrossOver.** The last major gap in the Mac build is closed. macOS drives CrossOver directly through its own `wine --bottle` interface, with each game getting its own bottle under the same per-game prefix scheme Linux already uses — created once, on first launch, then reused. Steam, GOG and Epic titles that only ship a Windows build are no longer off-limits on a Mac.

This needs CrossOver installed separately; it is commercial software and is not bundled. **Honest about the state of it:** the plumbing is verified end-to-end with real launches — a fresh prefix builds a bottle and runs a program inside it, a second launch reuses it — but it has not yet been driven against a large library of real games, so treat per-title compatibility as unproven. macOS as a whole remains **Experimental**. [macOS guide →](docs/macos-guide.md)

**Installer's tool panel tells the truth on macOS.** The External Tools panel and welcome screen were still listing Linux's `umu-run`/`wine` rows and offering the GE-Proton downloader on a Mac, where none of it applies. They now report CrossOver status instead.

## Fixes

**The "Mac-Native Games" panel no longer turns up on Linux.** 1.8.0 added a Control Panel card for scanning which games have a real macOS build — useful on a Mac, meaningless anywhere else, and meant to be invisible on Linux. It was hidden correctly at startup, but the Control Panel refreshes the visibility of every card whenever it opens, closes, or is searched, and that quietly brought it back the first time the panel was opened. The card is now removed outright on any non-macOS host rather than merely hidden, so nothing can restore it. Nothing was ever at risk: the scan it offered refuses to run on anything but macOS, and the apple badge on cover art was never able to appear on Linux.

## Install

**Linux:**
1. Download `Clarity.AppImage` below
2. `chmod +x Clarity.AppImage`
3. Run it

**macOS (Experimental):** download `Clarity.dmg` below (or the `.zip`). See the [full guide](docs/macos-guide.md) for the one-time Gatekeeper step an unsigned build needs, and for what does and doesn't work yet.

Upgrading from any 1.x? Just replace the AppImage (or the `.app`, on macOS). Your library, artwork, playlists and settings are untouched.
