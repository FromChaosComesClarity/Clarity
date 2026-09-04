# Clarity, development timeline

**Compiled 2026-08-29** from the five repositories that make up the project, read directly:
`ClarityGameManager`, `Couch`, `Installer`, `EmuLatte`, and `Clarity` (the monorepo,
at `main` = `75ad08c` = v1.9.3).

Everything here comes from `git log`, tag metadata, shipped release notes, and the repos' own
READMEs. Interpretation is marked as such.

> The GitHub account was renamed from its original handle to **`FromChaosComesClarity`**
> (account ID 276099054, unchanged). Links below use the new handle.

---

## At a glance

| Repo | Commits | Active | Fate |
|---|---|---|---|
| **ClarityGameManager** (Clarity) | 247 | 2026-05-11 → 2026-06-07 | Folded into the monorepo |
| **Couch** | 120 | 2026-05-11 → 2026-06-07 | Folded into the monorepo |
| **Installer** | 74 | 2026-05-18 → 2026-05-26 | Folded into the monorepo |
| **EmuLatte** | 99 | 2026-05-24 → 2026-08-01 | **Still independent** |
| **Clarity** (suite) | 205 | 2026-06-08 → 2026-08-26 | Current |
| **Total** | **745** | **2026-05-11 → 2026-08-26** | ~15 weeks |

**The monorepo is not the beginning.** Its first commit is titled *"unified suite"* because it
unifies three applications that already had 441 commits between them. The project is a month
older than `Clarity/` suggests.

```
May 11 ──────────────────────────── Jun 7  Jun 8 ─────────────────────────── Aug 26
   Clarity     ████████████████████████████████│
   Couch    ████████████████████████████████│
   Installer          ███████                 │
                                            │  Clarity ████████████████████
   EmuLatte           ████  ███████████████████████████████████  (independent)
                      May 24                            Aug 1
```

---

## Era 1, Two apps, one database (May 11–17)

**Clarity and Couch are created on the same day**, and their first five commits are identical in
both repos:

```
Initial commit
Remove binaries from tracking
Remove GameManagerConfig symlink from tracking
Remove GameManagerConfig from tracking
Add .gitignore
```

That shared `GameManagerConfig` is the point: the two apps were **never separate products**.
They were two faces over one SQLite database from the first hour, Clarity the desktop library
manager, Couch the fullscreen gamepad face. Both enable WAL mode on the shared DB the next day,
within hours of each other.

What Clarity was, at birth: a game library manager with theme support, Steam trailer fetching,
IGDB and HowLongToBeat metadata, and store filters. `05-11` alone carries a security sweep,
*"Fix shell injection, missing CoverArt/Screenshot in update-game"*, and its Couch twin fixes
*"shell injection, SQL injection, and missing clear-history handler"*.

Early decisions visible in this week:

- **Themes are a first-class feature, and they sync between apps.** `05-15`: *"Sync all theme
  changes from Couch: 11 redesigns, 2 removed, 21 new, 2 new categories."* Then 19 more themes
  the same day, including two new categories (Sci-Fi Universes, Horror Realm).
- **i18n from week one** (`05-13`, both apps, with a `pt_BR` locale).
- **Heroic was the original launcher.** `05-16`: *"Add Heroic Launch & Auto-Sync."* This matters
  for what happens next.
- **GPL v3** added to both on `05-17`.

Couch's own concerns are console-shaped from the start: gamepad glyph vs keyboard hints that
auto-switch, an on-screen keyboard, carousel/grid/list start-screen modes, a screensaver, and
background music (default changed JAZZ → AMBIENT on `05-12`).

## Era 2, The engine, and the ecosystem (May 18–26)

**Installer is created on May 18** and burns through 74 commits in eight days, 35 of them on
`05-19` alone. It is the install-and-launch engine for GOG and Epic, and it exists because
Heroic wasn't enough.

Its build order is a good record of what that problem actually involves:

| Day | Work |
|---|---|
| `05-18` | Scaffold, Proton version scanner, bundled legendary, umu-run installer, Epic login |
| `05-19` | Epic auth debugging (four commits), then **GOG support**, OAuth2, library import, gogdl install, native Linux launch; the **forked gogdl** appears the same day |
| `05-20` | Compat toggles; Steam added then **removed** (*"GOG and Epic only"*); theme sync from Clarity; **headless mode for Couch** |
| `05-21` | Welcome screen, built-in GE-Proton downloader |
| `05-23` | Custom exe override, install queue, Download Manager, GOG DLC |
| `05-24` | GOG achievements with a **Comet sidecar** for live unlocking |

The launch chain it settled on, *"umu-run → direct Proton → Wine, in order of preference"*,
plus reading GOG's own `goggame-*.info` `playTasks` so mods and DLC load without manual setup,
is the logic that survives into the monorepo unchanged.

**Heroic's demotion is traceable to the day.** `05-19` Clarity: *"Installer is default launcher…
prefer_heroic flag."* `05-21`: *"Heroic is now optional secondary."* Three weeks later the
monorepo purges it entirely.

**EmuLatte is created on May 24**, a ROM library manager, built in explicit numbered phases
(scaffold → ScreenScraper integration → playlists/cores → 55 bundled system presets) in a single
day. It is a fourth app, not a face: separate library, separate domain, its own releases.

### The ecosystem is declared on one day

On **2026-05-26**, all four repositories receive the same commit:

```
Update ecosystem map in README, Clarity as central hub
```

Four repos, one day, one message. It is the moment the four programs stop being separate
projects and become a named ecosystem with a hub. **It is also Installer's last commit ever**,
74 commits in eight days, then frozen until absorbed.

## Era 3, The layout museum (May 26 – Jun 7)

Clarity then does something unusual. Over twelve days, including **55 commits on `05-27` and 32 on
`05-28`**, the two densest days in the project's whole history, it grows a *collection of
interfaces*.

It starts as ordinary work: a three-way layout switcher (Icon Rail, Classic Sidebar, Command
Bar), then a Top Nav Bar, then **Split Pane**, whose refinement takes 26 commits
carrying its name, arguing with itself about where one button goes:

```
Split pane: move PLAY button to right side of info row
Split pane: revert info to column layout, right-align PLAY with align-self
Split pane: action buttons below cover art in horizontal row
Split pane: move action buttons into hero area (bottom-right, btn-hero with icons)
Split pane: hero action buttons, icon-only squares, top-left corner
Split pane: action buttons, small discreet circles inline after game title
Split pane: align PLAY button bottom with cover art bottom
Revert PLAY button placement experiment
Split pane: PLAY as floating action button, fixed bottom-right of panel
```

Then it turns into a museum. **Commander** (a terminal prompt that launches GUI and TUI apps,
with Fira Code bundled). Then flat layouts, Data Hero, Catalog, Newspaper, Mosaic, Poster Wall,
Streaming Rows. Then, on `05-29` and `05-30`, **operating systems**: Mac OS 1.0 (with Chicago
font and a working File menu), Windows XP, Mandrake Linux 9 / KDE 3, C64, Amiga, BeOS, Win95,
NeXTSTEP, *"Redesign NeXTSTEP layout from screenshot reference."* Then on `06-04`, **TTY
layouts**: Midnight Commander, NetHack, irssi, QBASIC, Emacs, GRUB.

Not all survived. Constellation, Mosaic, Poster Wall, irssi, QBASIC, Emacs, and Navigator were
each added and then removed within days.

Meanwhile the apps borrow from each other in both directions: Clarity adopts *"EmuLatte-style
category sidebar"* and a three-panel layout *"mirrors EmuLatte"* (`05-26`), while EmuLatte later
ports Couch's interface *"1:1"* into its own Couch Mode.

Clarity and Couch both stop on **2026-06-07**. The monorepo begins **2026-06-08**. A clean handover,
with no overlap.

## Era 4, The unification (Jun 8–11, 31 commits)

The merge is executed as a numbered plan, in public, in the commit titles:

| Phase | What it did |
|---|---|
| **0–1** | Initial unified suite |
| **2** (slices 1–4) | Engine into `packages/core`: window-free engine, then install/launch/auth, then in-process installs, then *"the byte-identical shared IPC handlers"* |
| **3** (stages 3a–3d) | Scaffold the Couch face onto shared core, *"verify each twin first"* |
| **4** (cutover) | Unified menu launcher and window association |

Two decisions outlived the week: **Heroic purged** (`ef8255d`), and the **AppImage put on a
diet**, wallpapers moved to a first-run download, *"532M → 261M"*.

## Era 5, Home, then the library (Jun 11 – Jul 19)

June builds the **Home dashboard**, re-based on Gridstack for a draggable 2D layout. `69202e7`
is labelled *"experimental, not merged"*, risky work staged on a branch, a pattern that recurs.

`5f27e63` (Jun 21) carries *"bundle all fonts"*. **The local-fonts rule is 10 weeks old** and
predates the blog by a full quarter. (The *website* repo never adopted it, the inconsistency
that surfaced later.)

July is library management: Steam import including free-to-play, Hidden Games, a multi-download
queue, GOG DLC, **detecting store removals** (Steam uninstalls, GOG/Epic refunds), a **Save
Manager** for GOG then Epic, and headless store sign-in so Installer's window is never shown.

In parallel, **EmuLatte builds Couch Mode**, `06-28` to `06-29`, 28 commits carrying its name, porting Couch's
gallery, list, OSK, gamepad glyphs, ~60 themes, screensaver and ambient sound into itself. It
also gains *"Add to Clarity"* (`06-20`), pushing a ROM into Clarity's Emulation category, and
becomes a full **RetroArch front-end**: config ownership, save-state manager, shader browser,
control templates, core downloader.

## Era 6, 1.0, in lockstep (Jul 20 – Aug 8)

**Clarity v1.0.0 and EmuLatte v1.0.0 ship on the same day: 2026-07-20.**

The suite's 1.0 commit is *"Add the GPL-3.0 LICENSE file; drop the stale Heroic references from
the manual"*, 1.0 marked by licensing and honest documentation, not a feature.

The lockstep continues, and is not coincidence, the same features land in both on the same day:

| Date | Clarity | EmuLatte |
|---|---|---|
| 2026-07-17 | *"Import BrewBalance's 5 brand themes"* | *"5 BrewBalance themes"* |
| 2026-07-20 | **v1.0.0** | **v1.0.0** |
| 2026-07-21 | *"Accept `--game=<id>` to open straight to a game page"* | *"Accept `--game=<id>`…"* + **v1.1.0** |
| 2026-07-21 | **v1.1.0** |, |

August 2–8 is compatibility work, with commit titles that name symptoms: *"Fix GOG DOS games
spawning DOSBox and closing instantly"*, *"Fix Fallout: New California launching to a dead-end
installer"*. `1a509ec`, *"Pin the build to our patched gogdl, not upstream's"*, formalises the
fork Installer started in May. **EmuLatte's last release, v1.2.0, ships 2026-08-01.**

## Era 7, Source ports and mods (Aug 12–14, 46 commits)

**31 commits on Aug 13 alone.** The idea: *a source port without its data is not a game*, and
you probably already own the data. Install Ironwail and Quake's `pak` files are linked out of
your GOG copy; install GZDoom and every IWAD you own appears beside it. Suite-managed data is
symlinked; user-supplied data is copied, *"because a folder of yours may be moved or tidied away
later."*

The framing is stated outright, **"Put the mods in the menu, not the engines"**, and in the
1.6.0 notes: *"Nobody sets out to install GZDoom; they set out to play Brutal Doom."*

It also holds the clearest debugging session in the log, four consecutive commits on one
integration:

```
4780815  Write BuildGDX's per-game ini instead of passing -path
7e4c08d  Start BuildGDX games with -game, which is the argument that does it
be148af  Keep spaces out of paths BuildGDX has to parse
f763649  Hand BuildGDX a C: path, because Java asks Wine the wrong question
```

## Era 8, The portability rewrite (Aug 22–24, 37 commits)

**Phase A put a platform boundary under the entire engine** in a single day, nine commits, each
moving one class of host assumption behind it: the Installer engine, compatibility runtimes, path
resolution, Steam/Flatpak discovery, desktop integration, build tooling, and *"the last three
host-shaped spots outside the backend."*

**Phases B–E then delivered macOS** on top of it: the darwin backend, a real app bundle, native
traffic lights, native GOG install/launch/uninstall, a Mac-native filter and badge, and finally
**Windows games on macOS through CrossOver**.

Two commits for character: *"Correct the framing: Linux is primary, macOS is a second host"*,
and *"macos-guide: drop the 'years of mileage' claim, it's not true."*

## Era 9, Omarchy and the tiling desktop (Aug 25–26, 29 commits)

The final act adapts to Omarchy (Arch + Hyprland). *"Know the distro, wear its theme, name what's
missing"* sets the goal; the rest works through what tiling breaks, opening *"in the final shape
instead of rearranging in front of the user"*, games opening **floating** rather than tiled,
window rules surviving theme changes.

Alongside it, definition-tightening that reads like maturity: *"One definition of 'installed',
used everywhere"*, *"Judge every launcher type, not just absolute paths"*, *"stop blaming the GPU
for every failure it cannot explain."*

The last commit, `75ad08c`, **takes the website out of the app**, the Support pill became an
in-app panel with Ko-fi and PIX values and Copy buttons, because *"a URL baked into a shipped
build is the one link that cannot be corrected afterwards."*

---

## Release history

**Clarity**, 17 versions in five weeks:

| Version | Date | Headline |
|---|---|---|
| v1.0.0 | 2026-07-20 | GPL-3.0 licence; manual corrected |
| v1.1.0 | 2026-07-21 | `--game=<id>` deeplinks |
| v1.1.1 | 2026-07-23 | Scrollable playlists; sharp corners default |
| v1.2.0 | 2026-07-26 | Multi-store install detection; update check |
| v1.3.0 | 2026-08-02 | Proton, install folder, slow-launch progress |
| v1.3.1 | 2026-08-04 | *Fallout: New California* installer fix |
| v1.4.0 | 2026-08-07 | Library sorted by what a game actually is |
| v1.5.0 | 2026-08-07 | Per-game manuals; DOSBox discovery |
| v1.5.1 | 2026-08-08 | Stalled-download reporting |
| v1.6.0 | 2026-08-13 | **Fan games, source ports and mods** |
| v1.7.0 | 2026-08-14 | OpenBOR; per-game fixes; KDE screen picker |
| v1.8.0 | 2026-08-24 | **macOS as a second host** |
| v1.8.1 | 2026-08-24 | Follow-up fixes |
| v1.9.0 | 2026-08-24 | **Windows games on macOS via CrossOver** |
| v1.9.1 | 2026-08-24 | Optional desktop tools can't kill the app |
| v1.9.2 | 2026-08-25 | **Omarchy support**; laptop-fit interface |
| v1.9.3 | 2026-08-26 | Website removed from the app; install fixes |

**EmuLatte**, 4 versions: v1.0.0 (2026-07-20), v1.1.0 (2026-07-21), v1.1.1 (2026-07-26),
v1.2.0 (2026-08-01).

Binary-asset tags on the monorepo: `binaries-v1` (Jun 8), `binaries-v2` (Aug 7),
`binaries-mac-v1`/`-v2` (Aug 14), helper binaries fetched at build time rather than committed.

---

## Patterns worth naming

*Interpretation, not log facts.*

**Phased, numbered, and public.** Structural work is planned as phases and the plan lives in the
commit titles, EmuLatte's Phases 1–4 in May, the suite's Phases 0–4 in June, Phases A–E in
August. Each time the refactor came *before* the feature it enabled.

**Two faces, one database, from hour one.** Clarity and Couch were never merged so much as
*rejoined*; they shared a schema from their identical first five commits.

**Ownership over integration.** Heroic added, demoted, purged. A `gogdl` fork adopted in May and
pinned in August. A KWin script written when a window rule wouldn't do. Steam added to Installer
and removed two days later to keep its scope honest.

**Commit messages changed voice.** May and June are written for a compiler, *"Phase 2 (slice 1):
start window-free installer-engine in core"*. August is written for a person, *"Stop deleting the
game's own temp folder"*, *"Say what the Raze entry actually does."*

**Corrections are committed, not hidden.** Reverts, *"Fix the real root cause…"*, *"Correct the
framing…"*, *"drop the 'years of mileage' claim, it's not true."* The history preserves being
wrong, including a 26-commit argument about one button.

**Work arrives in bursts.** May 27 (55), May 28 (32), Aug 13 (31) are the three densest days.
Between bursts, 8–10 day silences.

---

## Caveats

- Counted from each repo's default branch only. The monorepo's `experimental` and `mac` branches
  carry commits not included; `origin/mac` is 6 behind `main`.
- Commit counts are of history as it stands after merges, a measure of activity, not effort.
- Four author identities appear across the repos (a personal address, an older one, the
  GitHub noreply address, one `jose@Jose-MBAir.local`); all are the same person on different
  machines.
- Clarity, Couch and Installer are read at their final state; they are archived, not deleted, and
  their histories remain the authoritative record of the pre-suite era.
- **Nothing here predates 2026-05-11.** If code existed before the first `Initial commit`, this
  history cannot see it.
