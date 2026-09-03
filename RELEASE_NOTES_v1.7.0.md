Clarity 1.7.0

Games that get fixed by name, a category for OpenBOR, and a say in which monitor a game opens on.

## New

**Games that have been fixed individually.** Most things that go wrong under a compatibility layer are fixed by a general rule, and those rules have always just been part of the app. What is left over is the awkward remainder: a fault that belongs to one specific game and to nothing else. Those are now written down as fixes in their own right, applied when the game starts, with nothing to configure.

*OutRun 2006: Coast 2 Coast* is the first new entry. It opens to a white screen and appears to hang on the SEGA logo — it is not hung, its intro is a run of video logos that can sit there for over a minute before the menu arrives, which is far longer than anyone waits. The intro is now skipped, which removes the wait and the thing that stalls in it.

The list also covers *Resident Evil 2* with Classic REbirth, GOG's Windows builds of *Quake*, *Fallout: New California*, *Realms of Arkania 1 & 2*, *Albion* and *Colony Ship* — each with the actual fault named. It is expected to grow.

**OpenBOR is its own category.** It was filed under Others, which is where things go when there is nowhere better, and that was never the right answer: one engine, one rigid layout, its own way of packaging a game — the same argument that earned PICO-8 a place of its own. It now has a filter in the gallery and a category in Couch, with its own icon, and existing games move across on their own. They no longer appear under Others as well, so nothing is counted twice.

**Which screen games open on.** On a multi-monitor machine, games land on whichever screen the desktop calls primary and most of them offer no way to change it. Control Panel → *Which Screen Games Open On* lists your monitors by name and size — a connector called DP-4 tells nobody anything — and every game opens on the one you pick.

This is KDE only, and the card is hidden entirely on other desktops and on single-monitor machines rather than offering a setting that cannot work. Nothing is written into your KDE configuration. Worth knowing: a fullscreen game sent to a smaller monitor plays at that monitor's size, which is a property of the monitor rather than something a setting can talk it out of.

## Fixes

**Patched games load their own patch more often.** The suite already hands a game its own `ddraw`, `opengl32`, `dsound` or `dinput` rather than letting Wine shadow it — the fix that made Classic REbirth and GOG's Quake work in 1.6. `dinput8` now joins that list, which matters more than it sounds: it is the filename nearly every modern mod loader installs itself under, so a game folder containing one is nearly always a game somebody has patched.

## Install

1. Download `Clarity.AppImage` below
2. `chmod +x Clarity.AppImage`
3. Run it

Upgrading from any 1.x? Just replace the AppImage. Your `GameManagerConfig` folder — your entire library, artwork, playlists and settings — is untouched.
