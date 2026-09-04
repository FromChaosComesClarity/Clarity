# Handoff, bringing `mac` up to date

**Written on Omarchy, 2026-08-31, at `main` = `f9f5927`. To be read on the MacBook Air.**

The `mac` branch has been left behind for three phases. This is what it takes to catch it up,
what to check once it builds, and what not to touch.

---

## The short version

```bash
git fetch --all --tags
git checkout mac
git merge --ff-only origin/main        # a straight fast-forward, no merge commit
npm install                            # lockfile moved; do not skip
npm run dist:mac                       # → dist/*.dmg and the arm64 zip
```

Then work through *What to check on macOS* below. Nothing in the last 48 commits was written
or tested on a Mac.

---

## Where things actually stand

| Branch | At | Note |
|---|---|---|
| `origin/main` | `f9f5927` | 1.12.0 + the contact-address change |
| `origin/experimental` | `f9f5927` | same commit |
| `origin/mac` | `a490e91` | **48 commits behind** |

**It is a clean fast-forward.** Measured, not assumed: `git rev-list --count origin/main..origin/mac`
is **0**, and `git merge-base --is-ancestor origin/mac origin/main` succeeds. `mac` carries
nothing of its own, so there is nothing to merge and nothing to lose.

⚠️ `mac`'s `package.json` still says **1.9.2**. `main` says **1.12.0**.

---

## What arrives with those 48 commits

**Phase 2 tail**, Installer lost its window entirely; its setup and storage views moved into the
Manager. The Control Panel became pages. Ctrl+K command palette.

**Phase 3**. The app writes `~/.config/clarity/desktop.json` on every start, and answers
to two new argv flags beside the existing `--game=<id>`:

- `--play=<id>`, plays a game exactly as pressing Play does
- `--action=<id>`, runs a command-palette action by id

**Phase 4**, Couch stopped managing the library (six features and their subsystems removed),
its installs explain their failures, the jukebox was rebuilt around a real `AnalyserNode`, and
the README, the manual and the website were brought up to date.

**Linux-only work in the same commits**, Hyprland window rules, the XWayland primary-output
fix, the Omarchy theme bridge, and the companion plugin (a separate repo).

---

## What to check on macOS

### 1. It starts at all, the only real crash risk

The Phase 3/4 work reaches for `host.desktop.omarchy` and `host.desktop.displayPicker`, and
**`darwin.js` sets both to `null`**. I audited every call site on Omarchy before writing this:

- `applyHyprlandRules()`, `gameWindowMode()` and the `apply-hyprland-rules-now` handler all use
  optional chaining (`host.desktop?.omarchy?.…`), safe.
- ⚠️ **`kwinDisplay.configure(configDir)` at `apps/manager/main.js:967` does NOT null-check.**
  It survives on darwin only because the block sits inside a bare `try { } catch {}`. That is
  luck rather than design, and `darwin.js` already carries a comment saying a missing null check
  on `displayPicker` was once an instant crash on that host. **First thing to confirm: the app
  launches.** If it does, this is fine as it stands; if you touch that block, add the guard.

### 2. The descriptor

`packages/core/desktop-descriptor.js` runs on every platform. On macOS it will write
`~/.config/clarity/desktop.json` with `exec` pointing at
`…/Clarity.app/Contents/MacOS/…`, because `suiteExecutable()` looks for a file matching
`^Clarity.*\.AppImage$`, finds none, and falls back to `selfExecutable()`.

That is harmless, nothing on macOS reads the file, but worth knowing it exists. If it should
not be written there at all, that is a one-line platform guard, and a decision rather than a bug.

### 3. The three deeplinks

`--game=`, `--play=` and `--action=` are handled in the renderer and have nothing platform-
specific in them, but they have **never been run on macOS**. Worth one pass each:

```bash
open -a "Clarity" --args --action=settings-desktop
```

⚠️ Whether `open --args` reaches Electron's `second-instance` argv on macOS is exactly the kind
of thing that differs from Linux. If it does not, the deeplinks work on first launch only, and
that is a real finding worth writing down.

### 4. Couch, after the cuts

Couch lost Hidden Games, trailer download/delete, Add Launch Command, Rename, Scraping and
Uninstall, plus the subsystems behind them. None of that was platform-specific, but the
**menus were rebuilt around what remains**, so open both:

- **START**, the system menu
- **SELECT**, the game menu, which should now be Fav / Want to Play / Played / Add to Playlist,
  achievements where they exist, and Install where it applies

⚠️ A menu state missing from the input-routing allowlist looks like a **total app freeze**, not
a broken menu. If either menu appears to lock the app, that is the cause.

### 5. The jukebox

The visualiser is now a real `AnalyserNode` on the audio element. `createMediaElementSource`
**reroutes** that element's audio through the graph, connected to the destination, so it should
be fine, but on a different platform the failure mode to watch for is **silent music with moving
bars, or moving bars with no sound**. Check both together.

### 6. The manual

There is a new **21b. On Omarchy** chapter. It is accurate for Linux and simply does not apply
here; nothing needs changing unless you want a macOS equivalent.

---

## Traps this host has cost before

From `docs/mac-port-handoff.md` and the port's own history, all fixed, all worth not
re-learning:

- ⚠️ **`nativeOsKey` is `'osx'`, but GOG's public catalog API calls the same OS `"mac"`.**
- ⚠️ **legendary's config is `~/.config/legendary`**, not the `~/Library/Application Support` path.
- ⚠️ **gogdl writes no manifest on macOS**, the game *is* the `.app` bundle.
- ⚠️ **A Finder-launched `.app` has a minimal PATH with no Homebrew**, so `which()` has to search
  explicitly.
- ⚠️ **`fetch-binaries.mjs` needs `platform/index.js`**, so on a fresh clone the order matters.
- ⚠️ **An Electron main-process error dialog keeps the process alive**, so "it stayed up" is not
  the same as "it worked".

---

## What not to do

- ⚠️ **Do not move a published tag.** `v1.12.0`, `v1.11.0` and everything before them are out in
  the world. A release missing a commit is fixed by a new patch version, never by moving a tag.
- ⚠️ **Do not publish the plugin, and do not use the version number 2.0.** Both are gated on
  Jose saying the word, that same word covers the Omarchy marketplace submission, making the
  plugin repo public, and any general announcement.
- **Do not cut a macOS release from this catch-up alone.** The point of the fast-forward is to
  stop the divergence growing; shipping a dmg is a separate decision after the checks above.
- ⚠️ **`git fetch` before assuming you are ahead.** Two machines push to this repo.

---

## When it builds

Report back with:

1. **Does it launch**, and does anything in the console mention `omarchy`, `displayPicker` or
   `hypr`?
2. **Do the deeplinks work** through `open --args`, or only on first launch?
3. **Couch's two menus**, do they open, and is the game menu down to the five entries?
4. **The jukebox**, bars moving *and* audio playing?
5. Anything Phase 3/4 assumed about Linux that this host disagrees with.

That last one is the real reason for the exercise. Everything else is bookkeeping.
