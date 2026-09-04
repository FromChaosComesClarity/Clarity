Clarity 1.8.0

A second host joins the suite, and a few things that were quietly wrong on both of them get fixed.

## New

**macOS, Experimental.** Clarity now runs on Apple Silicon Macs, built from the exact same codebase behind a real platform boundary rather than a fork: one file (`platform/darwin.js`) sits beside Linux's, and everything above it, the library, the engine, both faces' UI, is unchanged code. Linux stays the primary platform and always wins a conflict, but the Mac build is genuinely working, not a proof of concept: Steam/GOG/Epic sign-in, the full library, and installing and launching Mac-native GOG and Epic games all work today through `gogdl` and `legendary` directly, not a browser hand-off. Windows games are the one major piece still missing, that's next. **[Full install instructions, what works, and what doesn't →](docs/macos-guide.md)**

**Know which of your games are actually native.** A "Mac-Native" option now sits in the library's category dropdown right next to Steam/GOG/Epic, and anything that qualifies gets a small apple badge on its cover art. GOG and Epic are checked for free from data the suite already has; Steam needs one live per-game lookup, so that's a manual "Scan for Mac Compatibility" pass rather than something that runs on every sync. macOS-only, the option and the badge simply don't exist on Linux.

## Fixes

**A stray database could silently orphan an entire GOG/Epic library.** The Installer face computed its own database location directly instead of checking whether the shared library's real data already lived somewhere else first. Under an unlucky sequence, the kind that's more likely on a machine still finding its footing than an established one. It could create a second, empty database that then shadowed the real one for every face, including after a routine restart. Not a Linux-only or Mac-only bug; fixed at the root for both.

**A Windows-game runtime failure no longer offers to install a Windows-game runtime for problems that have nothing to do with one.** The "Install GE-Proton" prompt used to appear for *any* launch failure, a stale database lookup, a bad path, anything, because Proton really was almost always the cause, once. It only shows now when the failure is actually about a missing or unusable runtime.

**The install dialog's native-build choice recognized only Linux.** A GOG title with both a native and a Windows build offers a choice between them; the check for "does this game have a native build" was hardcoded to Linux's own platform key, so on macOS the choice silently never appeared, mostly harmless for the launch itself, but it meant the install-size preview always showed Windows-sized numbers for a game that was never going to install as Windows.

## Install

**Linux:**
1. Download `Clarity.AppImage` below
2. `chmod +x Clarity.AppImage`
3. Run it

**macOS (Experimental):** download the `.dmg` below, see the [full guide](docs/macos-guide.md) for the one-time Gatekeeper step an unsigned build needs.

Upgrading from any 1.x? Just replace the AppImage (or the `.app`, on macOS). Your library, artwork, playlists and settings are untouched.
