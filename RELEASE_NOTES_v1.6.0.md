Clarity 1.6.0

Fan games, source ports and mods now install like anything else, and the game data comes out of the library you already have.

## New

**Fan Games & Source Ports.** A new panel in the Control Panel listing what the suite knows how to install: Ironwail, vkQuake, Quake: Ray Traced, GZDoom, UZDoom, ECWolf, Raze, BuildGDX, CannonBall, Mini Doom 1 and 2, SWOS 2020, Brutal Doom, Brutal Doom: Black Edition, and any OpenBOR game.

Every entry says where to get the download and what the file is called. That sounds small; it is the step that actually stops people. You download the port. The suite does the rest.

**The data comes from your own library.** A source port without its game data is not a game. You very likely already own that data, in the library this app is already managing, so it goes and gets it: install Ironwail and Quake's `pak` files are linked out of your GOG copy; install GZDoom and every Doom IWAD you own, Ultimate Doom, Doom II, TNT, Plutonia, turns up beside it. Nothing is copied; the data stays in one place.

If you own it but haven't installed it, the entry tells you which product to install. If it was never sold in a form a library can hold, arcade ROMs, files off a disc you still have, it asks you to point at the folder, and copies those, because a folder of yours may be moved or tidied away later.

Quake ports get their soundtrack too. The 1996 release keeps its music on the CD, which is why the original is silent; the 2021 re-release ships the same music as ogg files. If you own both, as GOG's bundling makes likely, those tracks are linked in automatically.

**Games, not engines.** Nobody sets out to install GZDoom; they set out to play Brutal Doom. So mods and Build-engine games are entries in their own right, Blood, Duke Nukem 3D, Shadow Warrior, PowerSlave, Redneck Rampage, Witchaven and Witchaven II, each installing its engine if you haven't got one, and appearing in your library under the game's own name. They are listed whether or not you own them, because the catalogue's job is to say what is possible.

**The choices that vary by mood happen when you press Play.** Which Doom a mod runs on is a per-evening decision, not something to bake in at install time, so it is asked at launch and opens on whatever you chose last. Where two engines can both run a game, both are installed beside it and you pick as you start.

**Anything not in the catalogue.** *A game folder you already have* registers any folder holding a Windows game, where it sits, nothing copied or moved, so a folder on another drive stays there. It looks three levels deep and puts the likely entry point first, which matters more than it sounds: plenty of releases hide the executable in a subfolder, and plenty ship four of them where only one is the game. *Any Quake mod or episode* and *Any Doom mod or texture pack* do the same for mods.

**Pick which version of a game starts.** A GOG release often ships several ways to launch and the store never shows you. Quake: The Offering has seven, and only one, the DOS build, plays the CD soundtrack. The gamepage now lets you choose, and remembers. This applies to every GOG game with more than one play task.

**Pick a Random Game.** In the gallery toolbar. It draws from whatever is currently on screen, so the filter row doubles as its criteria: set it to GOG, strategy, not-installed and the button becomes "pick me something off the pile I keep meaning to start". It avoids repeating its last ten picks.

## Fixes

**Old Windows games that ship their own patch DLL now work.** Plenty of nineties titles come with a community fix in a file like `ddraw.dll` or `opengl32.dll`, a renderer, a translation, a timing fix. On Windows the game's own copy wins, because the application directory is searched first. Wine reverses that for DLLs it implements itself, so the patch never ran.

The failures this caused looked like anything but a DLL problem. GOG's Quake would not start at all in any of its Windows modes, GLQuake, both mission packs, QuakeWorld, dying before a window appeared. Resident Evil 2 with Classic REbirth came up untranslated and stopped at a Japanese error box.

Both now hand the game its own DLL with Wine's behind it as a fallback, which matters: these are wrappers, and they forward the calls they don't implement to the real thing. Nothing to configure, and it applies to every game that does this.

**A freshly installed game no longer reverts to "Install" until you restart.** Installing a game your library fronts under more than one store would show it as installed, then quietly go back, because a cache was keyed on a database file's timestamp, and that database writes to a journal that leaves the timestamp alone.

**The download progress bar shows progress again.** A regression from 1.5.1's stall watchdog: a healthy download rendered as an empty bar.

**GOG's DOS games can mount their own CD.** Where a release ships the original disc beside the game and its own configuration doesn't mount it, the suite now does, so the soundtrack plays. Where GOG already mounts it, nothing changes.

## Install

1. Download `Clarity.AppImage` below
2. `chmod +x Clarity.AppImage`
3. Run it

Upgrading from any 1.x? Just replace the AppImage. Your `GameManagerConfig` folder, your entire library, artwork, playlists and settings, is untouched.
