# Omarchy polish — working task list

Agreed 2026-08-25. Working list; `docs/omarchy-features.md` is the user-facing write-up and gets
updated as items land. Everything Omarchy-specific must gate itself off on other hosts.

| # | Item | State |
|---|---|---|
|✅1| **One-click wined3d.** The NO_VULKAN dialog offers to set `PROTON_USE_WINED3D=1` for the game itself instead of telling the user to add it by hand | done |
|✅2| **Installer floats over CN.** Under Hyprland it tiles, which is wrong for a transient window — it should float and stay on top | done |
|✅3| **Hold off idle/lock while a game runs.** Omarchy locks on idle; a gamepad-only Couch session or a long cutscene gets locked out | done |
|✅4| **Power profile while playing.** Switch to performance for the session, restore afterwards | done |
|✅5| **Compact chrome.** Hide the titlebar entirely on Omarchy, move the Support/Couch pills into the icon rail. User-toggleable | done |
|✅6| **Responsive shell.** Degrade the layout as the tile narrows — rail to icons-only, filter row wraps, split pane to single pane | done |
|✅7| **Streamline the welcome screen.** First run needs one thing: get games on the shelf | done |
|✅8| **Match Hyprland's geometry.** Read `rounding` from `~/.config/hypr/looknfeel.lua` and mirror it in panel radius | done |

**Decided against / out of scope**

- **Adopting Omarchy's font.** `omarchy font current` is `fc-match monospace` — it is the *monospace*
  font, so following it would put the whole library in JetBrains Mono. The system's UI font resolves
  to Liberation Sans, a fontconfig default nobody chose. Jose: *"Keep our fonts."*
- **Heroic / Lutris** anywhere in the app (see `omarchy-features.md`).

## Notes worth keeping

⚠️ **The titlebar carries more than window controls.** `#titlebar` holds the brand, the amber
Support pill (`#support-cta`, opens the website) and the Couch call-to-action (`#couch-cta`).
Hiding the bar means those need a home, not deletion — hence the rail.

⚠️ **macOS already hides the window controls** (`body.platform-darwin .titlebar-controls`), so the
mechanism exists; what is new is removing the whole bar and the drag region, which is dead weight
under a tiling WM anyway.

## What each one turned into

**1 — one-click wined3d.** `installer-set-env-var` merges a single variable into the game's own
`custom_env`, so the dialog that diagnoses the failure can also fix it. ⚠️ Merges rather than
overwrites; a game may already carry variables that matter.

**2 — Installer floats.** ⚠️ **`hyprctl keyword` does not work on Omarchy 4 at all.** Hyprland 0.56
with Omarchy's Lua config runs a non-legacy parser and answers *"keyword can't work with
non-legacy parsers. Use eval."* — **on stdout, with exit status 0**, so a naive success check
counts the refusal as a success. The runtime API is `hyprctl eval` with Omarchy's Lua helper:
`o.window({ class = "...", title = "..." }, { float = true })`. The keyword form is kept as a
fallback for plain Arch + Hyprland, and both are now checked for a literal `ok`.
⚠️ All three faces ship as one Electron app and share the app id `clarity`, so rules match
on **title**, which is the only thing that tells Installer from the Manager from Couch.

**3 — idle inhibit.** `powerSaveBlocker` held for exactly as long as a game runs, via a new
`onGameSession` hook on the engine's single spawn choke point. ⚠️ An inhibitor rather than
`omarchy toggle idle`: an inhibitor dies with the process holding it, a toggle left flipped by a
crash disables the user's lock screen indefinitely. Counted, not boolean.

**4 — power profile.** Captures the current profile before switching and restores it on the way
out, so it cannot strand a laptop in `performance`.

**5 — compact chrome.** The bar's buttons are **moved** into the rail, not duplicated —
`appendChild` relocates a node with its listeners intact.

**6 — responsive.** Driven by `ResizeObserver` on the window, **not** CSS media queries: a media
query reads the *screen*, and on a tiled desktop the window and the screen are different numbers.
Breakpoints 900px / 680px.

**7 — welcome.** Artwork scraping and app-menu entries are deferred into a closed disclosure, not
deleted — both are post-import chores that already live in the Control Panel.
⚠️ Wrapping existing markup in a `<details>` split a block mid-structure the first time: the
totals still balanced, which is why a plain open/close count said "fine" while the modal rendered
as a narrow column with its footer escaped. **Count the wrapped region, not the whole file.**

**8 — geometry.** Read from `hyprctl getoption decoration:rounding`, not from
`~/.config/hypr/looknfeel.lua` — the config is Lua in Omarchy 4, and it would still be wrong the
moment the value changed at runtime. Applied only while the Omarchy palette is the active theme,
so it needs no toggle of its own.
