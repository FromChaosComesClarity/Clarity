# Recipes

A **Recipe** is Clarity's fix for one named game.

Not "improved compatibility". A real game that did not work, the exact fault, and the fix,
written down so nobody has to find it twice. Nothing needs configuring: a Recipe goes on when
the game launches. The public list is the **Game fixes** page on the site, and every entry there
is one of these.

Two rules decide what belongs here:

- **A Recipe is knowledge about one specific game.** If the same fix helps a whole class of
  games, it belongs in the engine instead, and several already live there: the shipped-wrapper
  detection, the working-directory handling, the missing runtimes.
- **Nothing fires on a guess.** Every Recipe matches on the executable's own filename, so a fix
  cannot land on a game that merely shares a folder, a title, or a common DLL name.

## Where they live

| Piece | File |
|---|---|
| The catalogue | `packages/core/game-fixes.js` |
| Applied at launch | `packages/core/installer-engine.js`, in `launchGame` |
| Bigger per-game repairs | `packages/core/installer-engine.js` (Fallout: London, New California) |
| Install-time recipes | `packages/core/custom-installers.js` |
| The public list | `fixes.html` on the site |

## What a Recipe can do

An entry may carry any combination of these:

- **`env`** , variables the game needs at launch. Applied every time it starts.
- **`settings`** , keys in the game's own configuration file. Written once, then respected.
  Only a key still holding the exact value known to be wrong is touched, never the whole file,
  because a player who changed it back meant to. The default shape is an ini line,
  `key = value`; a game whose config is not an ini supplies its own `match` regex, which needs
  exactly one capture group holding everything before the value. RC Cars' `Config.gm` reads
  `Set "AutoRunIntro"   1` and needs one. The line ending is preserved, these files are CRLF.
- **`wrapperExceptions`** , DLLs the game ships that must stay shadowed by the runtime's own.
  The engine normally hands a game the wrapper it shipped with, which is right nearly every
  time. A game listed here is one where that wrapper cannot survive the runtime.
- **`scale`** , the fixed resolution a game of a certain age insists on. A game that asks the
  display to become 640x480 draws into the corner of anything larger; named here, the launch is
  handed to gamescope, which gives it the small display it wants and scales the result up.
  Ignored where gamescope is not installed, so the game still runs, just small.

## Adding one

1. Reproduce the fault, then prove the fix on a real machine. Measure both sides: what happens
   with the fix and what happens without it. The `why` field carries those numbers.
2. Add the entry to `packages/core/game-fixes.js` with `id`, `title`, `exe`, `symptom`, `why`
   and whichever of those fields apply. `symptom` is what the player sees, phrased the way
   they would describe it, so a bug report can be matched to it.
3. Add it to `fixes.html` on the site, under a named game with the named fault.
4. Never touch a user's files when an environment variable will do.

## Worked example: Arcanum

GOG's build ships DDrawCompat as `ddraw.dll`. That wrapper fixes the game on modern Windows by
hooking DirectDraw's internals, and it cannot survive those hooks under Wine. The engine's
general rule, hand the game the wrapper it shipped with, is what killed it: measured on one
machine, same prefix, same Proton build, the game produced no window at all in 26 seconds with
the shipped wrapper, and ran with a visible window for 22 of 26 seconds on Wine's builtin. So
Arcanum declares `wrapperExceptions: ['ddraw.dll']`, the one game so far that has to keep the
runtime's own library. `DDrawCompat.ini` is left on disk, untouched.

## Worked example: RC Cars

Two faults at once, and the useful part is that only one of them is a Recipe.

GOG ships this 2002 game with its own wrapper set, `dxcfg`: `ddraw.dll`, `d3d8.dll` and
`dinput8.dll` reading one `dxcfg.ini`, where `display=desktop` sizes the window to the screen
and `scaling=fit` scales the game up into it. The engine's shipped-wrapper list knew `ddraw`
and `dinput8` but not `d3d8`, so the game was handed two thirds of a set that only works whole:
DirectDraw opened a 3440x1440 window and Wine's own `d3d8` drew 640x480 into the corner of it,
the rest black. Nothing about that is particular to RC Cars, so the fix is one name added to
`SHIPPED_WRAPPERS` in the engine, not an entry here.

What *is* particular is the intro. `AutoRunIntro` runs an in-engine sequence before the menu
and under Proton it never ends: black picture, no crash, no error, nothing further written to
the game's own `game_dbg.log`. Measured on one machine, same prefix, same Proton build: intro
on, still black and still stuck after five minutes with the log frozen on one line; intro off,
main menu in about seventy seconds and the game running. So the Recipe carries one `settings`
entry turning the intro off, and `Config.gm` keeps every other line it had.
