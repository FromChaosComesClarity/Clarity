Clarity 1.9.1

A Linux fix that missed 1.9.0's build by eleven minutes.

## Fixes

**Clarity could fail to start on a minimal Linux install.** The app calls out to a handful of small desktop tools, to refresh the applications menu, mark a launcher trusted, open a link, and raise its own window. Each call was written to be optional and to shrug off a tool that isn't installed. It didn't: the failure arrives a moment later than the code that was meant to catch it, so on a system without those tools the app went down instead of quietly carrying on. Couch was the face most likely to hit it.

Every desktop the suite has run on so far happens to ship all four tools, which is why this has never been seen in the wild. A pared-down install, particularly one running a tiling window manager, where an X11 tool like `wmctrl` has no reason to be present, is where it would have bitten. Raising the window is now also skipped outright when there's no X server to raise it on, instead of asking an X11 tool to do something impossible.

**Nothing else changed.** Same code as 1.9.0 otherwise.

## Install

**Linux:**
1. Download `Clarity.AppImage` below
2. `chmod +x Clarity.AppImage`
3. Run it

**macOS:** this is a Linux-only fix and no new Mac build is published for it. The [1.9.0 `.dmg`](https://github.com/FromChaosComesClarity/Clarity/releases/tag/v1.9.0) remains the current macOS build, with Windows-game support through CrossOver. See the [macOS guide](docs/macos-guide.md).

Upgrading from any 1.x? Just replace the AppImage. Your library, artwork, playlists and settings are untouched.
