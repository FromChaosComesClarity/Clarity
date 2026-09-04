# Phase 2, Clarity at home on Omarchy

**Status: proposal. Nothing implemented.** Drafted 2026-08-29 on Omarchy at `experimental`.
Phase 1 is `docs/omarchy-tasklist.md` (8/8 done) and its user-facing write-up is
`docs/omarchy-features.md`. This is the plan for what comes after.

Phase 1 made the app *behave* correctly on a tiling Wayland desktop. Phase 2 is about making it
**smaller, more obvious, and shaped like the desktop it runs on**, the difference between an app
that works on Omarchy and one that feels like it was written for it.

---

## Measurements first

Everything below is counted from the tree at `a3e50cf`, not estimated.

| Surface | Count | Where |
|---|---|---|
| Control Panel cards | **21** | one flat scrolling modal, `#modal-tools` |
| Home dashboard widgets | **24** | `HOME_WIDGETS`, `renderer.js:2764` |
| Layouts (structural skins) | **24** | `data-layout=` in `index.html` |
| Themes (palettes) | **93** | `THEMES`, `renderer.js:11725` |
| Custom-installer recipes | **25** | `custom-installers.js` |
| Persisted setting keys | **33** | `setSetting()` call sites |
| Layout-specific CSS | **779 lines** | of `index.html`'s 7,270 |
| `apps/manager/renderer.js` | **12,413 lines** | single file |

Two numbers matter more than the rest: **21 cards behind one search box**, and **12,413 lines in
one renderer**. The search box over the Control Panel is the tell, a settings screen you have to
search is a settings screen that lost its shape.

---

## The four things you asked for

### 1. Cut the fat, but not where it looks like it is

⚠️ **My recommendation is to keep all 93 themes and cut the layouts instead.** That is the
opposite of how it looks, so here is the measurement behind it.

The 93 themes are **107 lines of data**, one line of colour tokens each. They cost nothing to
carry, they are the app's personality, and the Omarchy palette bridge *maps into that same table*,
so the theme system is load-bearing for Phase 1's best feature. Cutting them would save no
meaningful complexity and would remove the thing an Omarchy user is most likely to enjoy.

The 24 **layouts** are different: **779 lines of structural CSS overrides**, spread through a
7,270-line HTML file, each one able to break the others. This is not theoretical, Phase 1
already hit it twice. The `display-card` and `mac-native-tool-card` both carried `.tools-section`,
and the Control Panel resets `display` on every `.tools-section` **in three separate places**, so
an inline `display:none` was undone the moment the panel opened. Removal was the fix in both
cases. That bug class exists *because* the layout surface is this wide.

**Proposal:** keep the layouts that are real working shapes, `sidebar`, `topnav`, `split`,
`commander`, `catalog`, `kanban`, `timeline`, `newspaper`. Retire the novelty terminal skins
(`nethack`, `grub`, `bbs`, `vi`, `adventure`, `mc`, `ranger`, `htop`) and the OS pastiches
(`c64`, `beos`, `w95`, `xp`, `nextstep`, `amiga`, `kde`, `mac`) **as layouts**, keeping any that
you love as *themes*, which is where their value actually lives, the C64 blue and the XP Luna
palette are colours, not structures.

✅ **DECIDED 2026-08-29, cull them, preserve nothing.** Jose: *"do it, no need to preserve
anything, we already have those colour palettes on our themes."* Verified: `AMIGAWORKBENCH`,
`BEOS`, `NEXTSTEP`, `WINXP`, `WINDOWS95` and `CLASSICMACOS` all already exist in the `THEMES`
table. The only skin with no palette twin is **C64**, noted, not preserved, per the decision.
No compatibility shim: a one-time migration maps each removed layout to its nearest survivor.

**Also cut, with no hesitation:**
- The **Control Panel search box**, once the cards are paged (item 4). It exists to paper over
  the flat list.
- **Home widget count**: 24 hardcoded widget types collapse to ~8 real ones plus one parametric
  "shelf" (item 3). Most of the 24 are the same component with a different query.
- **`renderer.js` at 12,413 lines** should be split. Not cosmetic: it is the single biggest reason
  a change anywhere risks something everywhere.

### 2. Installer goes headless

**This is 90% done already and nobody wrote it down.** `packages/core/installer-engine.js` is 2,080
lines and runs *in-process* inside the Manager. Headless GOG/Epic sign-in already exists. There
is a comment at `main.js:677` saying "No Installer window ever". Launching, installing, DLC, manuals,
disk space, redists, the GOG registry injection: all in-process.

**Exactly four GUI spawn points remain**, all in `apps/manager/main.js`:

| Line | Call | What it opens for |
|---|---|---|
| 112 | `spawnInstaller(['setup', id])` | per-game Proton/prefix setup |
| 2860 | `spawnInstaller(args)` | `search <name>` / `sync-*` |
| 2866 | `spawnInstaller(['storage'])` | Manage Storage |
| 3642, 3660 | `spawnInstaller(['launch', id])` | fallback only when `library.db` is missing |

Installer's whole GUI is **two screens** (`#view-games`, `#view-settings`). Absorbing four entry
points into the Manager retires an entire face.

**What this buys beyond tidiness:**
- ⚠️ It kills the **two-`library.db` split** recorded in the technical memory, the bug where a
  face computing its own db path orphans the entire library. One process, one path, gone.
- It removes the Hyprland float rule for Installer, and with it the title-matching workaround
  needed because all three faces share the app id `clarity`.
- One less window for a tiling WM to place.

✅ **DECIDED 2026-08-29, headless is total.** Jose: *"Let's make installer totally headless, let's
incorporate its features inside CN."* No debugging GUI is kept; the two Installer screens go.

**⚠️ Two things that must not break.** The `installer://launch/…` scheme is written into
`LaunchCommand` for every installed game and has already survived two migrations (the
`heroic://` rename and the Flatpak-wrapper unwrap, `main.js:315–330`). Phase 2 must **keep the
scheme** and keep the `installer` CLI subcommands, desktop entries and the Clock's `--game=`
handoff depend on them. Headless means *no window*, not *no entry point*.

### 3. A dashboard that knows what kind of games you have, ⏸️ DEFERRED

⏸️ **DEFERRED 2026-08-29.** Jose: *"Don't change the Home Dashboard for now."* The analysis below
is kept because it stays true and the work is cheap whenever it is wanted.

⚠️ **One piece should be lifted out of this deferral**: the `Store = r.category || 'Others'` bug
below is a *library filing* bug, not a dashboard feature. It is why source ports are invisible in
filters and playlists today, and it belongs with the Source Ports page in wave 2A.

Today's 24 widgets are library-wide aggregates. Shelves per kind of game would be better *and*
smaller, because they replace most of the 24 with one parametric component.

**The good news: it needs no schema change.** `_registerCustomInstall()` (`main.js:1004`) writes
every custom install as `cn_<recipeId>` into `InstallerGameId`, and each recipe carries a `kind`:
`Source port`, `Mod`, `Fan game`, `OpenBOR`, `Custom engine`. So the recipe identity is already
recoverable by prefix. A **Source Ports** shelf is a join away.

⚠️ **But the library row currently gets `Store = r.category || 'Others'`**, so unless a recipe
declares a category, your source ports are filed under *Others*. That is precisely why they feel
invisible today, and it is a one-line fix at the same site.

For genres the substrate is already excellent: `genres.js` has a curated vocabulary with a
**specificity-weighted classifier** (`(votes / top-votes) × specificity`), so it can tell a CRPG
from an ARPG rather than filing both under RPG.

**Proposal, one `shelf` widget, parameterised:**

```
shelf: { source: 'genre'|'kind'|'store'|'playlist', value: 'crpg', size: n }
```

and then the part that makes it *smart*: **the dashboard proposes its own shelves from your
library.** On first run, and behind a "Refresh suggestions" action after that, it looks at what
you actually own, top 3 genres by installed count, whether you have source ports at all, whether
you have a dormant favourite franchise, and offers those shelves pre-filled. A user with 40 CRPGs
and no shooters should never see an empty Shooters shelf, and should not have to know the widget
picker exists to get a CRPG one.

That is the difference between configurable and smart, and it is the answer to "no-nonsense":
the default dashboard is *derived*, not chosen.

### 4. Settings become pages in a left column

Today: one modal, 21 stacked cards, a search box. Proposed: a two-pane Settings with a category
rail, grouping the 21 into **7 pages**:

| Page | Absorbs |
|---|---|
| **Library** | update/sync/scrape, recently imported, hidden games, add game, PICO-8 + F2P visibility |
| **Games & Compatibility** | install folder, storage, updates, DOSBox, genres |
| **Source Ports & Mods** | the custom-installer catalogue, promoted from one card to a page |
| **Appearance** | theme, scale, corners, fonts, layout |
| **Desktop** | the Omarchy card, Hyprland behaviour, display picker |
| **Accounts** | GOG / Epic / Steam |
| **System & Data** | backup/restore, notifications, cleanup, menu entry |

⚠️ **The paged rewrite must replace the `.tools-section` display reset, not inherit it.** Three
separate places reset `display` on every `.tools-section`; that is what made per-card hiding
impossible and forced two cards to be deleted rather than hidden. A page router owns visibility, and
those three resets go away with it. If they survive the rewrite, the same bug arrives on day one.

This is also where **Source Ports** and **Omarchy Tweaks** stop being cards buried in a scroll and
become destinations, which is what you asked for.

---

## What I would add, making it feel like an Omarchy app

### A. A command palette (my strongest suggestion)

Omarchy is keyboard-driven. Hyprland users launch everything from a fuzzy menu, `omarchy-menu`,
walker, `SUPER`-something. Clarity is mouse-driven: to play a game you find it in a grid
and click it.

**One `Ctrl+K` palette that fuzzy-matches games *and* actions** ("install", "sync GOG", "theme
…", "source ports") would do more for how native this feels than any amount of restyling. It also
becomes the escape hatch for a narrow tile, where the grid is at its worst, the same argument that
already put `Ctrl +/−/0` on the interface scale in Phase 1: *an escape hatch must not live behind
the thing it rescues you from.*

### B. Distribution, ⚠️ the AUR is the wrong target, and I was wrong to lead with it

**Researched 2026-08-29 after Jose pushed back. The pushback was correct.**

**What the AUR looks like now.** Seven malware incidents in twelve months. In June 2026 the
"Atomic Arch" campaign adopted roughly **1,500 orphaned AUR packages** and rewrote their
`PKGBUILD`s to pull a credential-stealing Rust payload aimed at developer workstations and CI.
The attack vector was the *orphan adoption* process, precisely the mechanism a small
single-maintainer package eventually depends on.

**What Omarchy did about it, verified on this machine, not from an article:**

```
$ grep -A1 '^\[omarchy\]' /etc/pacman.conf
[omarchy]
Server = https://pkgs.omarchy.org/stable/$arch
$ grep VERSION_ID /etc/os-release
VERSION_ID="4.0.1"
```

Omarchy 4 ships **its own package repository**, built on its own machines, mirrored roughly a
month behind Arch so a bad upstream package does not reach users the day it ships. The AUR is
explicitly no longer a runtime dependency. There is **no documented third-party submission
process** for `pkgs.omarchy.org`, so shipping there is not something we can decide unilaterally.

**So: publishing to the AUR would put us on a channel the target distro is actively walking away
from.** It stays technically possible and is not dangerous *to publish* to, the malware story is
about consuming, not producing, but it buys much less than I claimed.

#### The real native surface: Omarchy's plugin system

Omarchy 4 has a first-class plugin API, and it is already thriving. On this machine:

```
$ omarchy plugin list
expose.window-overview            third-party  overlay
im0001gt.hw-tooltip               third-party  bar-widget
io.github.randazraik.xray         third-party  overlay, bar-widget
… 9 third-party plugins installed
```

A plugin is a **git repo** containing `manifest.json` plus QML entry points, installed with
`omarchy plugin add <git-url>`. Kinds are `bar-widget`, `overlay`, `panel`, `service`, `bar`.

**This is the "feels at home" move, and it costs a small repo rather than a packaging pipeline.**
A `clarity` bar-widget showing what is installed/playing, with an overlay that fuzzy-launches
the library, would put the app in the same surface as the rest of the user's desktop, and it is
entirely in your control, no submission process, no gatekeeper.

⚠️ It is QML/Quickshell, not web. That is a genuinely new stack for this project and should be
scoped as such, not hand-waved.

#### Is the AppImage a disadvantage? Yes, and it is measurable

Measured on this machine at `a3e50cf`:

| Cost | Detail |
|---|---|
| **156 MB of duplicated binaries** | `ffmpeg` 77 MB + `ffprobe` 76 MB + `yt-dlp` 3.1 MB are bundled in `assets/bin/linux/`. All three are **system packages already installed here** (`ffmpeg 2:9.0.1-1`, `yt-dlp 2026.08.19-1`). They exist only for trailer downloads. |
| **~296 MB of bundled Electron** | We ship Electron 41.7.1. Arch has **`extra/electron41 41.10.6-1`**, an exact major match, and `electron43` is already installed on this box. |
| **No update path** | A repo package updates with `omarchy update`. Ours needs a manual 262 MB re-download. The in-app "check for updates → open GitHub releases" button *is* the workaround. |
| **No desktop integration** | The Control Panel ships an **"Add to app menu"** action. That feature exists only because AppImages do not integrate themselves. |
| **No signature chain** | An unsigned binary from a GitHub release. Omarchy's repo carries SHA-256 checksums and ships an `omarchy-keyring`. |

Total: **262 MB shipped, of which ~156 MB is software the user already has.**

⚠️ **The AppImage still earns its place** as the universal channel, one file, every distro, no
root, no packaging matrix, and it is what the README and the website point at today. The
recommendation is **not** to replace it.

#### Recommendation

1. **Keep the AppImage** as the primary, universal download. Nothing changes for existing users.
2. **Add a `PKGBUILD`** that depends on system `electron41`, `ffmpeg` and `yt-dlp` instead of
   bundling them. Distribute it from our own repo, `makepkg -si`, or a small self-hosted pacman
   repo. This is where the 156 MB goes away and where `omarchy update` starts working.
3. **Treat the AUR as optional and low-priority**, not the goal.
4. **Build the Omarchy plugin**, the highest "feels at home" return of anything in this document,
   and the only item that puts Clarity into the desktop's own furniture.

✅ **DECIDED 2026-08-29, keep bundling `ffmpeg`/`ffprobe`/`yt-dlp`.** Jose: *"keep bundling
ffmpeg/yt-dlp."* Trailers never degrade, on any distro, and the universal channel stays genuinely
universal.

⚠️ **This removes 156 MB of the PKGBUILD's justification.** Be honest about what is left: a native
package is now worth building for **`omarchy update` and desktop integration**, not for size. That
is a weaker case than the one made above, and the PKGBUILD should be judged on it, it drops to the
back of 2E rather than leading it.

### C. Finish the per-game monitor picker on Hyprland

`docs/omarchy-features.md` lists this under *Not done yet*, and the hard part is already solved:
Phase 1 proved that `hyprctl keyword` **does not work on Omarchy 4** (non-legacy Lua parser,
refuses on stdout with exit 0) and that `hyprctl eval` with `o.window(...)` does. A
`hypr-display.js` implementing the same interface as `kwin-display.js`, selected at runtime, makes
the *existing* UI start working instead of being removed on Hyprland.

### D. First boot: detect, then propose, one screen

A fresh Omarchy has no gaming stack at all: no Steam, no wine, no umu. The Omarchy card already
computes that gap in three honest tiers. **Promote it to step one of first boot.**

The honest first-run sequence for an Omarchy user is:

1. *"Here's what this machine is missing for gaming"*, one terminal command, their password,
   their terminal. (Already built. Just not where a new user meets it.)
2. *"Here's what I found"*, Steam library detected on disk, GOG/Epic offered as one button each.
3. Done. Everything else, artwork scraping, menu entries, is a post-import chore and already
   lives behind a disclosure.

The current welcome modal offers six actions at once with no ordering. Making it three steps that
*know what this machine has* is the whole "easy to set up on first boot" ask.

### E. Smaller ones worth doing

- **Waybar-friendly now-playing.** A tiny status file or D-Bus name while a game runs, so a user
  can put it in their bar. Cheap, and very Omarchy.
- **A `--launch "<name>"` CLI** so a game can be bound to a key or launched from walker. The
  `--game=<id>` plumbing already exists for the Clock handoff.
- **Split `renderer.js`.** 12,413 lines is the tax on every other item here.

### F. Deliberately NOT doing

- **Omarchy theme hooks.** Already decided against in Phase 1 and still right: it writes a script
  into the user's system that outlives uninstalling us. Watching
  `~/.local/state/omarchy/current` costs nothing.
- **Adopting Omarchy's font.** `omarchy font current` is the *monospace* font; following it puts
  the whole library in JetBrains Mono. Your call from Phase 1: *"Keep our fonts."*
- **Heroic / Lutris**, anywhere, ever.

---

## Sequencing

Updated after the decisions of 2026-08-29.

| Wave | Contents | State |
|---|---|---|
| **2.0** | **Layout cull**, 24 → 8, no preservation, one-time migration | ✅ decided; do first, it shrinks everything after it |
| **2A** | Settings → left column + 7 pages; kill the search box; kill the three `.tools-section` display resets; Source Ports becomes a page; fix `Store='Others'` | ✅ decided |
| **2B** | **Installer fully headless**, absorb all 4 spawn points, delete both GUI screens, keep the `installer://` scheme and CLI | ✅ decided, total |
| **2C** | ~~Dashboard shelves~~ | ⏸️ deferred by Jose |
| **2D** | First boot: detect → propose → done | proposed |
| **2E** | Command palette · Hyprland monitor rule · **Omarchy plugin** · PKGBUILD | proposed; plugin is the standout |

**Why 2.0 goes first:** every retired layout is CSS the settings rewrite does not have to keep
working. Culling after 2A means doing 2A twice.

---

## Open questions after 2026-08-29

1. **Trailers vs unbundling.** Dropping `ffmpeg`/`ffprobe`/`yt-dlp` saves 156 MB but breaks
   trailers where those are absent. AppImage keeps them and only the PKGBUILD drops them, or
   trailers degrade with a message everywhere?
2. **Is the Omarchy plugin worth a new stack?** It is QML/Quickshell, not web. Highest payoff
   here, but genuinely new ground for this project.
3. **Does the command palette outrank first boot?** Both are in 2D/2E; the palette probably does
   more for daily use, first boot does more for a new user.

## Constraints carried from earlier work

- **Linux is primary; a Linux regression blocks a merge and a macOS gap does not.** Never reshape
  `linux.js` to suit `darwin.js`.
- **Everything Omarchy-specific gates itself off elsewhere.** `isOmarchy()` for Omarchy-only
  things, `isHyprland()` for window management, plain Arch + Hyprland users get the behaviour
  without being told they are on Omarchy.
- **No backwards-compatibility shims.** A cut is a cut plus a one-time migration.
- **Nothing runs `sudo` on the user's behalf.** Commands go to a real terminal the user can read.
- **`packages/core/omarchy*.js` import node builtins only**, so they stay copyable into EmuLatte.


---

## Appendix, Omarchy plugin scope

**Scoping only. Not to be released until Jose approves the app as ready to ship** (his call,
2026-08-29: *"I don't want to launch it as a plugin before I consider it ready."*). Building and
testing it locally is fine; publishing the git URL is what waits.

### What an Omarchy plugin actually is

Read off the nine third-party plugins installed on this machine, not from docs:

- A **git repo** containing `manifest.json` + QML entry points. Installed with
  `omarchy plugin add <git-url>`; validated by `omarchy plugin validate <folder>`, which mirrors
  the checks in the shell's own `PluginRegistry.qml`, `schemaVersion` exactly `1`, required
  fields, safe relative entry points that exist, no symlinks, non-reserved id.
- `kinds`: `bar-widget`, `overlay`, `panel`, `service`, `bar`.
- Ids are reverse-DNS: `io.github.<user>.<name>`.

⚠️ **The QML layer is thin, and this is the key scoping fact.** `io.github.randazraik.xray`'s
entire `BarWidget.qml` is **25 lines**, it draws an icon button and calls
`bar.shell.toggle(moduleName, "{}")`. All the real work lives in a **`backend/`** directory that
the QML spawns as a long-lived `Process` speaking **line-delimited JSON over stdin/stdout**:

```qml
property Process backend: Process {
    command: ["python3", root.backendPath]
    stdinEnabled: true
    stdout: SplitParser { onRead: function(line) { root.handleLine(line); } }
}
```

So this is **not** "rewrite Clarity in QML". It is a thin QML shell over a backend process
we already know how to write. That materially lowers the risk I flagged earlier.

### Proposed shape

| Field | Value |
|---|---|
| id | `io.github.fromchaoscomesclarity.clarity` |
| kinds | `bar-widget` + `overlay` |
| barWidget | what is installed / what is running |
| overlay | fuzzy-launch the library, the command palette, on the desktop |

### The backend, and the trap to avoid

Three options, in order of preference:

1. **A state file for the bar widget.** Clarity already has a single spawn choke point (the
   `onGameSession` hook added for the idle inhibitor in Phase 1). Writing a tiny JSON file there,
   what is running, since when, makes the bar widget nearly free: no process, no polling.
2. **`python3` + `sqlite3` for the overlay.** Python 3 is present on Omarchy and its `sqlite3` is
   stdlib, so a read-only library query needs **no dependencies at all**. This is exactly the xray
   precedent.
3. **Spawning the AppImage** as a backend, rejected. Booting a full Electron app to populate a bar
   widget is the wrong weight.

⚠️ **The trap: the plugin must not compute its own database path.** The two-`library.db` split in
[[project-technical]] happened precisely because a second consumer derived its own path and
orphaned the library. A third consumer doing the same would repeat it. The plugin reads the path
from the same place the app does, or asks the app for it, it never guesses.

⚠️ Launching a game from the overlay should go through the **existing** `installer://launch/<id>`
scheme and CLI, not a new entry point. That is the interface 2B is explicitly preserving.

### Effort

The QML is small and the backend is a script. The real work is the overlay's interaction design,
which is **the same design as the command palette**, so building the palette first means the plugin
overlay is largely a port of it rather than new thinking. Another argument for palette-before-plugin.
