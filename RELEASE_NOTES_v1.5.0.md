Clarity 1.5.0

Manuals you didn't know you had, and DOS games that start.

## New

**The manual, where the game already keeps it.** Plenty of games, RPGs above all, still expect you to read something, and more often than not the PDF has been sitting in the game folder since the day you installed it, with nothing anywhere to tell you.

There is now a book button on the gamepage. Press it and Clarity shows you what it found:

- **In the game's own folder.** GOG ships manuals, cluebooks and reference cards inside the game and never surfaces them. Better still, its manifest *names* them, so Realms of Arkania offers you *Manual*, *Cluebook* and *Password reference card*, not three filenames to guess between.
- **From GOG.** For GOG games it also asks the store what it has: the scanned originals, sold alongside the game. One press downloads and unpacks them.
- **Anywhere on disk**, for a scan or a fan-made reference. Several at once, if you like.

A game can hold **as many manuals as it needs**. With one attached the button simply opens it; with several it lets you choose. Reading happens in its own window that you can drag to a second monitor and leave open while you play.

Removing a manual only unlinks it, a file of yours, or one GOG installed, is never deleted. The single exception is a manual Clarity downloaded itself, which it does own and does clean up.

**A native DOSBox, if you want one.** GOG's DOS games come with a Windows build of DOSBox from 2010, which on Linux has to run through Proton, an emulator inside a translation layer. That still works and remains the default; you need install nothing.

But a native DOSBox is better, and Clarity can use one. The trick is that it reads *the very same configuration file GOG wrote for that game*, every tweak GOG made for it, from CPU cycles to sound cards to the commands that start it, is kept exactly as it was. Only the emulator changes, and nothing on disk is rewritten.

Control Panel → Tools → **DOS Games** offers Automatic (use a native one if you have it), Native, or GOG's. To get one, install `dosbox-staging`, the card shows the exact command for your distribution, or the Flatpak line, which works anywhere.

## Fixes

**DOS games no longer open a window and close it again.** Two separate faults, either of them fatal on its own.

GOG tells us which folder a DOS game must be started from, and we were ignoring it. That matters more than it sounds: these games mount their own drive with a *relative* path, so from the right folder DOSBox finds the game and from the wrong one it finds the folder above it, comes up empty and quits. Realms of Arkania, Star Trail and Albion were all affected.

The configuration files were also missing entirely. GOG stages them inside the game and its own installer copies them into place afterwards; the downloader never did, so DOSBox was being handed the path to a file that did not exist. They are now restored at launch, and only where nothing of that name is already there, so the settings you have chosen since are never overwritten. This is the general form of the Fallout: New California fix from 1.3.1, and it applies to every GOG game rather than one title at a time.

**A refunded GOG game no longer takes its Steam twin with it,** and games pointing at an old external launcher that is no longer needed are repaired automatically.

## Install

1. Download `Clarity.AppImage` below
2. `chmod +x Clarity.AppImage`
3. Run it

Upgrading from any 1.x? Just replace the AppImage. Your `GameManagerConfig` folder, your entire library, is untouched.
