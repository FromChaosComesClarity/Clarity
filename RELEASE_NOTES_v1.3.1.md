Clarity 1.3.1

A fix for Fallout: New California, and for the class of GOG games it turned out to represent.

## Fixes

**Fallout: New California now starts.** Installing it from GOG gave you every file in the right place and then a dead end: instead of the game you got the old Fallout: New Vegas launcher, insisting that *"Fallout: New Vegas does not appear to be installed"* and asking you to point it at a DVD-ROM drive to install a game that was already sitting on your disk.

Nothing was wrong with the download. GOG ships two manifests alongside a game, one describing how to launch it, which Clarity already read, and a second describing the finishing touches the GOG Galaxy installer performs after the files land. That second one was never being read by anybody. For most games that costs you nothing. For New California it cost three things at once: the registry entry that tells the New Vegas launcher where the game lives, the display configuration file whose absence makes the game hand off to that launcher in the first place, and the plugin list that loads New California's content, without which even a game that did start would have been plain New Vegas.

All three are now applied when you launch the game, using the files GOG already shipped inside the game folder. It repairs an installation you already have, with no reinstall, and reapplies itself if the game's Windows environment is ever rebuilt.

You'll see the New Vegas launcher run its display detection once, which is normal and happens on Windows too, it checks your graphics card and writes the result. Every launch after that goes straight into the game.

## Install

1. Download `Clarity.AppImage` below
2. `chmod +x Clarity.AppImage`
3. Run it

Upgrading from any 1.x? Just replace the AppImage. Your `GameManagerConfig` folder, your entire library, is untouched.
