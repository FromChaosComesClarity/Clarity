# Phase 3 — the desktop can reach in

**Shipped 2026-08-31 in 1.11.0** (app side) and in the plugin repo at `795b28b` (desktop side).

Phase 2 made Clarity feel at home *inside its own window* on Omarchy. Phase 3 is about
the other direction: the desktop reaching into the app. A bar widget that says what is
installed and what is playing, and a launcher overlay that starts any game without the app
window being open at all.

The two halves live in different repositories on purpose — different stack (QML/Quickshell),
different release cadence, different audience. The app half shipped in 1.11.0; the plugin is
built, installed and unpublished, gated on testing.

---

## The contract between them: one file

`~/.config/clarity/desktop.json`, written by `packages/core/desktop-descriptor.js` on
**every Manager start**:

```json
{
  "app": "Clarity",
  "version": "1.11.0",
  "exec": "/home/you/Games/Clarity/Clarity.AppImage",
  "faces": { "manager": [], "couch": ["--couch"], "installer": ["installer"] },
  "baseDir": "/home/you/Games/Clarity",
  "libraryDb": "/home/you/Games/Clarity/GameManagerConfig/games.db",
  "installerDb": "/home/you/.config/installer/library.db",
  "updatedAt": 1788145501,
  "actions": [ { "id": "control-panel", "name": "Control Panel" }, … ]
}
```

**Why it exists.** A desktop integration needs three things only the app knows for certain:
which binary to run, where its databases are, and what its command palette can do. The two
alternatives were both wrong:

- **Deriving the paths** — a second consumer computing its own `library.db` path is exactly
  how the library got orphaned in the two-database split fixed in 1.8.0.
- **Hardcoding them in the plugin** — works on precisely one machine. The first draft of the
  bar widget defaulted to `/home/jose/Games/Clarity/…`, and would have shipped that way.

So the app publishes, and everything else reads.

⚠️ **Writes merge, never overwrite.** The file is written in two halves: `main.js` has the
paths at startup, and the renderer sends the palette actions over `publish-palette-actions`
once the UI is up. Either half clobbering the other loses real data.

⚠️ **For consumers: a missing file means "not installed, or never run".** It is never a licence
to fall back to a guessed path. Report nothing rather than the wrong thing.

## Three deeplinks

| Flag | Does | Since |
|---|---|---|
| `--game=<id>` | Opens that game's page | 1.1.0 (the Clock uses it) |
| `--play=<id>` | Plays it, exactly as pressing Play does | 1.11.0 |
| `--action=<id>` | Runs a command-palette action by id | 1.11.0 |

All three share one argv parser and the single-instance path, so they work whether the app is
running or not — a second instance hands the request to the first and quits.

⚠️ **All three are performed by the renderer, not by main.** That is the whole point of
`--play`: the launch keeps the multi-store picker, the "which engine?" and "which Doom?"
dialogs, the install-state verification and the last-played write, because it is the same call
the Play button makes. A launcher that spawned games itself would be a second implementation
of `_doLaunch`'s five branches — correct the day it was written and wrong by the next release.

Ids for `--action=` are stable names in `_PAL_ACTIONS` (`control-panel`, `settings-library`,
`themes`, `manage-storage`, …). Rename one with the same care as a CLI flag.

## Games open fullscreen, and X agrees which screen is primary

Two bugs, one visible and one underneath it.

**Ours:** the app told Hyprland to *float* every game. Right about tiling — a game shoved into
half a layout and resized is a bad first frame — but floating only moved the problem, because
a floating game opens at whatever size it decided on and keeps it. Games now open
**fullscreen**, matching what Omarchy's own rules do for RetroArch and Moonlight, with
Floating and Tiled kept as choices in Settings → Desktop.

**Underneath, and measurable:** Hyprland's XWayland starts with **no primary output** —
`xrandr --query` prints no `primary` at all. An X11 game (on Proton, nearly all of them) takes
the first output RandR lists, the one nearest the origin of the X screen. On a desk with a
small panel left of the main monitor that is the small panel: a 1440x900 screen chosen beside
a 3440x1440 ultrawide. **Which Screen Games Open On** now also sets the XWayland primary to the
screen already chosen for games.

⚠️ **A Hyprland window rule cannot be withdrawn.** The Lua API has `unbind` for keys and
nothing at all for window rules (checked against 0.56.2's `hl` table). `hyprctl reload` does
clear runtime rules, which is what the **Apply To This Session** button uses — it reloads and
puts back everything the app owns. It is a button rather than automatic because the reload
drops rules other tools set this session and only ours come back.

## The plugin

`~/Documents/DEVELOPMENT/CLAUDE/omarchy-clarity` —
`github.com/FromChaosComesClarity/omarchy-clarity` (private until publishing is
unblocked). One plugin, two kinds, `keepLoaded: true`.

- **Bar widget** (`Clarity.qml`) — installed count, or a controller glyph and the title
  while a game runs. Left click opens the Manager, middle click Couch.
- **Launcher overlay** (`Launcher.qml`) — a fuzzy list of games *and* the app's palette
  actions, with a preview pane: cover art, genre · year · store, hours played, a sentence.
  Bound to `SUPER + CTRL + G`.
- **`scripts/cn-watch`** — the bar's backend, a loop emitting one JSON object per line.
- **`scripts/cn-index`** — the overlay's backend, one shot, ~335 KB of JSON for 877 games.

**What is playing comes from the compositor, not the app.** Clarity launches a game and
gets out of the way, so it is usually *not* running while you play — asking it would give the
wrong answer for the exact case the widget exists to show. `hyprctl -j clients` matched against
the same `GAME_CLASS_RE` the app uses.

**The fuzzy scorer is the app's own `_palScore`, character for character** — 13,155 title/query
pairs compared against the app's copy with zero mismatches. The in-app Ctrl+K palette and the
overlay rank a query identically, which is why the palette was built first in Phase 2E. Two
deliberate differences, both commented: an installed game outranks an uninstalled one that
scored the same, and an empty query is ordered by recency.

## Traps paid for, in case they come round again

1. **`hyprctl dispatch exec` silently does nothing on Omarchy 4.** Same family as the
   `hyprctl keyword` refusal: the Lua config's non-legacy parser. It prints a "dispatch in lua
   is a shorthand" note and runs nothing, which makes a working keybinding look broken.
   `hyprctl eval 'hl.dispatch(hl.dsp.exec_cmd("…"))'` is the form that works.
2. **An overlay is handed `shell` / `manifest` / `omarchyPath` but NOT `settings`** — only bar
   widgets get those, from their shell.json layout entry. Another reason the descriptor exists.
3. **A QML edit needs `omarchy-restart-shell`.** Disable/enable and `reloadConfig` leave the
   stale component on screen. ⚠️ **Never `omarchy-refresh-shell`** — it resets shell.json to
   defaults and takes the whole bar layout with it.
4. **Rounded images need `layer.effect: MultiEffect` with a mask.** A `Rectangle`'s radius does
   not clip its children.
5. **A `Column` is as tall as its children**, so the preview pane's long descriptions ran past
   the bottom of the card and through the footer. Anchors, with the blurb given what is left.
6. **A timestamp folded into a ranking score saturates.** `LastPlayed` is milliseconds;
   squeezing it into one number made all 125 played games equal and left "recently played"
   silently alphabetical. Compare tier first, timestamp second.
7. **Never `pkill -f` or `kill -9` a running AppImage.** The pattern matches its helper
   processes; Electron loses its GPU process and exits with `GPU process isn't usable.
   Goodbye.`, or wedges into the compositor's "Application Not Responding" dialog. Children
   left faulting on a torn-down FUSE mount die of SIGBUS and dump core. Close the window, or
   SIGTERM the main pid.
8. **`wtype` does not reliably deliver multi-modifier chords**, and its modifier is `logo`, not
   `super`. `ydotool key 125:1 29:1 34:1 34:0 29:0 125:0` fires them first try — but a stuck
   `ydotool` button leaves the whole desktop unable to left-click, so prefer not to synthesise
   input at all.

## How it reaches a user

The plugin is ~9 KB of QML and two scripts. It has no library, no launcher and no games of its
own, so **it requires Clarity ≥ 1.11.0** — the first release that writes the descriptor.
Installed without the app it degrades honestly: the bar shows a bare icon with no count,
and the launcher says the app has not been run on this machine yet.

```
omarchy plugin add https://github.com/FromChaosComesClarity/omarchy-clarity
omarchy plugin enable io.github.fromchaoscomesclarity.clarity
```

Nothing to configure: the settings exist only as overrides for an unusual install.
