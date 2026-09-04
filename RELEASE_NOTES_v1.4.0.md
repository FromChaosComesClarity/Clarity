Clarity 1.4.0

Your library finally knows the difference between an ARPG and a CRPG.

## New

**Genres that mean something.** Storefronts hand out genres like "Action, Adventure, Indie", which tells you nothing about what you are in the mood for. One scan now sorts your whole library into real genres, **ARPG, CRPG, JRPG, FPS, Metroidvania, Soulslike, Shmup, Roguelike, Survival Horror, Immersive Sim, Point & Click, Racing** and forty more.

It works by reading the tags *players* voted on for each game, which is the only source that can tell a Diablo-like from a Baldur's Gate-like, Grim Dawn's top tag is "Action RPG" by thirty-five thousand votes. Games your stores never listed are looked up on IGDB instead.

Run it from **Control Panel → Tools → Detect Genres**. It works through your games about one a second, so a large library takes a few minutes; you can close the window and keep playing while progress carries on in the corner, and stopping it keeps everything already sorted.

**Filtering by genre.** On the desktop, a Genre dropdown sits next to the search box with the rest of the filters, and it combines with them, *GOG* + *CRPG* + *Installed* is one view. On the TV, it lives in **START → Library → Filter by Genre** and narrows whichever category you are already browsing, shown as a pill beside the category name so it is never a mystery why the shelf looks shorter. Searching for *crpg* or *metroidvania* finds games too.

**Playlists that fill themselves.** Give a new playlist a genre instead of a list of games and it maintains its own membership from then on. It tells you how many games it collects before you commit, and every game you buy that fits simply turns up in it. There is also a **✦** button beside the genre dropdown that turns whatever you are looking at into one of these in a single press.

**Your word is final.** Every game has a **Filter Genre** picker in its edit panel. Anything you set by hand is pinned, and no future scan will ever overwrite it.

## Fixes

**The storefront picker is back for games you own twice.** If a game sits in your library on more than one store, Clarity is supposed to ask which one you mean. It had stopped asking, in two different ways.

Installing never asked at all, an uninstalled game on both Steam and GOG went straight to GOG without offering the choice. Now Install opens the same picker Play uses, with each store showing whether it is installed and routing to its own installer.

Playing sometimes could not ask, because the second launcher had gone missing from the library entry. Opening a game's edit panel hid its GOG or Epic launcher from the list, and saving then rebuilt that list from what was visible, so a single innocent Save quietly deleted it. Those launchers are now shown, read-only, and survive a save. On top of that the picker no longer depends on that list alone: it works out which stores a game is on from the entry itself, so games that lost a launcher long ago get their choice back without you doing anything.

**Games that pointed at an old external launcher now start.** A rename in an earlier version left a number of GOG entries holding a launch command aimed at a Heroic install that is no longer needed. They are repaired automatically on first run.

**A refunded GOG game no longer takes its Steam twin with it.** Removing one store from a two-store entry could delete the whole entry when the surviving store's launcher was implied rather than written down.

## Install

1. Download `Clarity.AppImage` below
2. `chmod +x Clarity.AppImage`
3. Run it

Upgrading from any 1.x? Just replace the AppImage. Your `GameManagerConfig` folder, your entire library, is untouched, and the new genre data is added alongside it.
