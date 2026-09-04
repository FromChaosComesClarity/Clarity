# Phase 4, Couch gets simpler, and the project gets a face

**Opened 2026-08-31**, from a single instruction: cut management out of Couch, make its
installs seamless, redesign the jukebox, give the bar widget a menu, refresh the public face
(website, README, manual), and publish the plugin when testing says so.

The through-line: **the Manager manages, Couch plays.** Everything below either enforces that
split or shows the result to someone who has never seen the app.

---

## The gate, LIFTED 2026-08-31

W1 came back the same day. Jose took the recommendations as written and settled the two open
calls: **Add to Playlist, keep. Uninstall via Installer, cut.** W2 is unblocked, and the table
below is now the specification for it rather than a proposal.

---

## W1, Couch feature inventory (review, no code)

Every user-reachable feature in Couch today, with a recommendation. Couch is 4,886 lines of
renderer, 1,136 of main, 1,047 of markup.

### System menu (START), 20 items in 5 sections

| Section | Item | Recommend | Why |
|---|---|---|---|
| Audio | Jukebox Mode | **keep** | The thing being redesigned in W4 |
| Audio | Sound Settings | **keep** | Volume and BGM belong where you listen |
| Appearance | Color Scheme | **keep** | 93 themes; changing one is a couch decision |
| Appearance | Interface Font | **keep** | Same |
| Appearance | Home Screen | **keep** | Which face Couch opens on |
| Appearance | Start Screen | **keep** | Same |
| Appearance | Browse Mode | **keep** | How you move through the library |
| Appearance | Gamepage Style | **keep** | Same |
| Appearance | Screensaver | **keep** | Only meaningful on a TV |
| Controls | Keybindings | **keep** | Unusable from another room if it moves |
| Controls | Gamepad Icons | **keep** | Same |
| Controls | Wake Method | **keep** | Same |
| Library | Filter by Genre | **keep** | Browsing, not management |
| Library | History | **keep** | Browsing |
| Library | PICO-8 Games | **keep** | A visibility filter |
| Library | Free-to-Play Games | **keep** | A visibility filter |
| Library | Hidden Games | **cut** | Editing what the library contains, the Manager owns it |
| System | About | **keep** | |
| System | Quit | **keep** | |

### Per-game menu (SELECT), 12 items

| Item | Recommend | Why |
|---|---|---|
| Download / Delete Trailer | **cut** | Fetches and deletes media: library maintenance |
| Add / Remove Favourite | **keep** | One-button taste, the point of a couch UI |
| Add / Remove Want to Play | **keep** | Same |
| Mark / Unmark Played | **keep** | Same |
| Add to Playlist | **KEEP** | Jose's call. Assigning a game from the couch is a taste decision, like the flags above it |
| Add Launch Command | **cut** | Typing a command line on a gamepad |
| Rename | **cut** | Editing library data |
| Scraping | **cut** | The heaviest management feature in Couch |
| View Achievements | **keep** | Read-only, and it belongs beside the game |
| Install via Installer | **keep, rebuild** | See W3. This is the seam that needs fixing |
| Uninstall via Installer | **CUT** | Jose's call. Deleting an install is management, and doing it by accident from a gamepad is the failure that matters |

### Known defect to fix while in here

`apps/couch/renderer.js:4726`, the install dialog swallows a null size into "Size info
unavailable". Deliberately unfixed until now because Couch exposes no auth-status IPC and must
never offer a store login; the honest fix is a "sign in from The Manager" message plus two new
handlers. **This is the oldest open item in the project.**

**Status: done.** Every verdict above is now a decision, not a recommendation.

## W2, Cut what W1 says to cut

Mechanical once W1 returns. Expect a large deletion in `renderer.js` and `index.html`, and the
menus to shrink.

⚠️ **The overlay input-routing allowlist trap.** A menu's `gameState` missing from the
allowlist looks like a *total app freeze*, not a broken menu, it cost a bug on the font
picker. Removing states is safer than adding them, but the allowlist has to shrink with them.

⚠️ Deleting by line range has bitten this codebase twice (a lost `renderGallery`, 18 unclosed
CSS comments). Delete by structure, then check brace *and* comment balance, then run the app.

## W3, Installs, seamless

The ask: "the installs should be as seamless as possible."

Today Couch's install path opens a confirm dialog, hands to Installer's headless installer, and
polls `installer-progress.json`. The failure modes are the interesting part: no auth (the null
above), not enough disk, a store that needs a browser login. On a gamepad, in another room,
each of those is a dead end.

- Progress that reads at three metres, a real bar, bytes and ETA, not a line of text
- Every failure ends in an instruction, not a shrug ("Sign in from The Manager on your desk")
- Cancel and resume without leaving the game's page
- Install from the gamepage, in place: no modal stack

## W4, The jukebox, redesigned

Reference: **cliamp.stream**, dark near-black, cyan accent with magenta secondary, monospace
throughout, box-drawing borders, CRT/scanline feel, numbered file-name section labels, terse
copy, flat surfaces, generous vertical rhythm.

A complete redesign, not a restyle: transport, spectrum visualiser, playlist, now-playing with
art, all readable from a sofa and drivable on a gamepad. It should look like the thing Winamp
would have been if it had been written for a TV.

## W5, A menu for the bar widget

One click from the bar: the Manager · Couch · the launcher overlay · Manage Storage, plus what
is playing when something is. Modelled on the shell's own popup surfaces, themed from the same
tokens as the launcher.

## W6, The website, as a teaser

Currently **offline on purpose** (Pages disabled, nothing deleted) and three releases behind.

- The cliamp.stream identity, and **drop the old themed styling** for this phase
- The message: the app is changing, and it has found a home in Omarchy
- A slideshow from `/home/jose/Pictures/CN_Omarchy Screenshots`, **106 shots, 78 MB**, a
  selected handful converted to webp
- Restoring Pages is a separate, deliberate step: source `main`, path `/`

## W7, README, short and assertive

Currently 196 lines. Cut hard: what it is, what it runs, how to get it, one screenshot.
Details live in the manual and on the site.

⚠️ Two mentions of the old identity's email address remain at lines 188 and 196, **the only
mentions left in the repository**, and they need Jose's call on which address replaces them.

## W8, The manual, revised (not rewritten)

730 lines, well structured, and the outline is right. Recommendation: **revise, do not
rewrite**, a rewrite discards correct prose to re-derive the same outline.

What is stale, measured: **Installer appears 18 times** and its GUI no longer exists · "sidebar"
and the layout system are gone · the display picker is described as KDE-only · **Omarchy
appears zero times** despite being where the app now lives.

⚠️ **This goes last.** Couch's chapters describe features W2 is about to delete.

## W10, First run, without the app

Asked whether the plugin can detect a missing app and make getting it easier. It already
detects it, no descriptor means "not installed, or never run", but today that is a dead end
that only states a fact. It should offer the next step.

- The launcher's empty state and the widget's tooltip become **actionable**, not just honest
- Installing runs **in its own terminal**, the pattern the app already uses for package
  installs (`terminalLauncher()` → `xdg-terminal-exec`, which is what Omarchy itself sets
  `TERMINAL` to). A bar widget silently pulling 274 MB in the background is the wrong shape:
  no progress, no cancel, and an arbitrary binary fetched by a shell script is exactly what a
  marketplace reviewer should object to
- `scripts/cn-install` downloads the AppImage, marks it executable, and runs it once so it
  writes the descriptor the plugin then reads

⚠️ **`/releases/latest` is the wrong endpoint and would ship a broken install.** GitHub
excludes pre-releases from it, and every experimental build is a pre-release, measured
2026-08-31: `/releases/latest` returns **v1.9.3**, which does *not* write the descriptor, so
the plugin would sit at "not installed" forever having just installed the app. The script must
walk `/releases` and take the newest with an `.AppImage` asset (**v1.11.0**).

⚠️ **Where it lands matters.** The app's data directory is the AppImage's own folder, so the
install path is also where the library will live. The script proposes a location and says so
rather than choosing silently.

## W9, Publish the plugin

Gated on Jose's testing, not on the app: 1.11.0 ships the descriptor the plugin needs. When
unblocked: flip the repo public, add `preview.png`, submit to Omarchy's plugin marketplace.

---

## Done already, 2026-08-31

- **`docs/omarchy-phase3.md`**, Phase 3 written up.
- **The old handle is gone from the repository.** Three release notes had live links rewritten
  (a claimed handle would repoint them at a stranger); the timeline was redacted; three
  finished cross-machine rename handoffs (621 lines) deleted; and `package.json`'s author,
  which ships inside every AppImage, corrected to `J.R.A.`. Only the README's two email
  mentions remain, pending W7.
- **`github.com/FromChaosComesClarity/omarchy-clarity`** created **private**, default
  branch `main`, three commits pushed. One command makes it public when testing says so.

## Order

W1 gates W2. W8 follows W2 and W4. Everything else is independent.

With W1 closed: **W2 → W3 → W4** is the Couch block and is ready to start. **W5 → W6 → W7**
are visible and independent. **W8** last. **W10** belongs with **W9**, whenever Jose says.
