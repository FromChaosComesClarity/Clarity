# Clarity on macOS, handoff

**Linux stays the primary platform.** It is the main gaming machine, it is what ships, and it
is not being replaced or wound down. macOS is a *second host in the same codebase*, an
Experimental build alongside the AppImage, not a successor to it. Both are maintained from here
on.

What moves to the Mac is the *macOS work*, because none of it can be written or tested from
Nobara. Everything below assumes an **M2 MacBook Air, 16 GB, macOS Tahoe (26)**, and the `mac`
branch.

**Phases A through E are done and pushed.** The host boundary exists, `darwin.js` is written and
contract-verified, a real unsigned `.app`/dmg builds, `gogdl` is built from the fork and
published as `binaries-mac-v2`, and a real GOG macOS-native game has been installed, launched,
and uninstalled end-to-end against Jose's actual GOG account. Windows games now run too, through
CrossOver, see *Phase E* below for what that turned out to actually require. What's left is the
part of Phase C that needs hardware not yet on this machine (external-volume awareness, no SSD
formatted here yet). See *Status* below each phase for the real, verified-against-reality version
of what this file originally guessed at.

Background: **`docs/mac-port-phase-a.md`** (what was moved, what was verified, what was
deliberately left). This file is the do-this-next companion to it.

---

## Day 0, get the Mac ready

Nothing here is Clarity specific; it's the toolchain.

```bash
# 1. Xcode Command Line Tools, needed to rebuild better-sqlite3 against Electron
xcode-select --install

# 2. Node 22 (matches the Linux box: 22.22.2). Either the official installer, or:
#    brew install node@22        # if you want Homebrew
node -v                          # expect v22.x

# 3. git + gh (gh is optional, but you'll want it for binaries-mac-v2)
brew install gh && gh auth login
```

**Format the external SSD as APFS, not exFAT.** exFAT has no permission bits and no symlinks,
so game executables lose `+x` and `.app` bundles break. This makes the drive Mac-only (Linux
APFS support is read-only and flaky), that's the accepted trade; the Linux box has its own
library.

---

## Day 1, clone and see it fail honestly

```bash
git clone https://github.com/FromChaosComesClarity/Clarity.git
cd Clarity
git checkout mac
npm install
```

`npm install` will:

- rebuild `better-sqlite3` for darwin-arm64 (this is why Xcode CLT is step 1),
- run `scripts/fetch-binaries.mjs`, which downloads **`binaries-mac-v1`** into
  `assets/bin/darwin-arm64/`, five arm64 helpers, all code-signed,
- print a warning that **gogdl is not in the tarball** and how to build it.

Then:

```bash
npm start
```

**It will throw**, and the error is the point:

```
Clarity has no platform backend for "darwin". Supported: linux.
```

That's `packages/core/platform/index.js` doing its job. Writing the backend it's asking for is
the whole of Phase B.

---

## The one file you have to write

**`packages/core/platform/darwin.js`**, sibling to `linux.js`, same shape. `index.js` picks it
up automatically the moment it exists; nothing else needs touching.

Read `linux.js` first. It's ~1000 lines and every comment in it records a real bug, so it
doubles as the specification.

### The contract, and what each member should do on macOS

`init(ctx)` receives `{ homeDir, configDir, getDb, expandTilde }` from the engine.

**Paths, do these first.**

| Member | macOS |
|---|---|
| `id` | `'darwin'` |
| `binDirName` | `'darwin-arm64'` |
| `portableBaseDir({isPackaged, execPath, devDir})` | **Not portable on macOS**, an `.app` in `/Applications` cannot hold user data. Return `~/Library/Application Support/Clarity`, ignoring `devDir` when packaged. |
| `selfExecutable()` | `process.execPath` (there is no `APPIMAGE`) |
| `selfSpawnArgs(faceArgs, repoRoot)` | packaged → `faceArgs`; dev → `[repoRoot, ...faceArgs]` |
| `installerDbCandidates(baseDir)` / `findInstallerDb` / `installerDbCreatePath` | `~/Library/Application Support/installer/library.db` (Electron's `userData` for `app.setName('installer')`) |

**Store identifiers, small, and load-bearing.**

| Member | macOS |
|---|---|
| `nativeOsKey` | `'osx'`, ⚠ **this was wrong as originally written.** `'osx'` is what lands in `games.platform` and what gogdl's own `--platform` flag wants, but GOG's *public catalog API* (`api.gog.com/products?expand=downloads`) calls the same OS `"mac"` in its installer `os` field, not `"osx"`. Comparing that field directly against `nativeOsKey` (as `syncOwnedLibrary` originally did) means **every Mac-native game in the library silently looks Windows-only**, happened to all 298 of Jose's owned GOG games until caught in Phase D. Fixed in `installer-engine.js` with a small `GOG_CATALOG_OS_ALIAS = { mac: 'osx' }` translation before matching, not in `darwin.js`, `nativeOsKey` itself is correct. |
| `gogdlPlatform` | `'osx'` |
| `legendaryPlatform` | `'Mac'` |

**System + stores.**

| Member | macOS |
|---|---|
| `which(bin)` | ⚠ A `.app` launched from Finder inherits a minimal PATH with **no Homebrew**. Search `/opt/homebrew/bin`, `/usr/local/bin` explicitly as well as PATH. |
| `dirSizeBytesCommand(p)` | `du -sk "p"` and multiply the parsed number by 1024, BSD `du` has no `-B1` |
| `dirSizeHumanCommand(p)` | `du -sh "p"` works as-is |
| `legendaryConfigDir()` | ⚠ **not** `~/Library/Application Support/legendary`. That was the Phase B guess, and it's wrong. legendary never adopted macOS's conventions on its own; `legendary status` on a real Mac reports its actual config directory as `~/.config/legendary`, same as Linux, and nothing in `runLegendary()` overrides that with `--config-folder`. Match the tool, not the platform. |
| `steamLibraryPaths()` | `~/Library/Application Support/Steam/steamapps`, plus extra roots from `libraryfolders.vdf`, the vdf parsing is identical, lift it |
| `steamLaunchCommand(appId)` | `open steam://rungameid/<id>` |
| `extraStore` | `{ supported: false, label: '', scan: () => [], findIcon: () => null }`, no Flatpak. `scan-flatpak` becomes a no-op on its own. |

**Native games.**

| Member | macOS |
|---|---|
| `launchNative({exe, args})` | If `exe` is a `.app` bundle → `{ cmd: 'open', args: ['-n', exe, '--args', ...args] }` (`-n`, always a new instance, not `-a`). If it's a plain binary → chmod +x and spawn directly, like Linux. |
| `findNativeGameExe(dir)` | Look for `*.app` first, then a plain executable |
| `findNativeInstallResult(dir, appId)` | **Verified against a real `gogdl --platform osx download` in Phase D**, see below. gogdl writes *no manifest file at all* on macOS (the Phase B guess of `.gogdl-osx-manifest` doesn't exist). The game IS the `.app` bundle, dropped directly under the install root with no extra per-game wrapper folder the way Linux/Windows get one. It self-identifies via `<bundle>.app/Contents/Resources/goggame-<appId>.info`, same `playTasks` JSON shape GOG already uses on Windows, just nested one level in. `install_path` has to be the bundle itself (`headlessUninstall` does an unguarded `rm -rf` on it, pointing it at the shared library root instead would delete every installed game), so `executable` is stored as the self-reference `'.'` rather than a real relative path, and `resolvedExe`'s `path.join(install_path, executable)` still lands on the bundle. |
| `dosbox` | `find()` → look for `dosbox-staging` / `dosbox-x` via the widened `which`; `installHint()` → `brew install dosbox-staging`; `translateArgs` → lift verbatim from Linux |

**Desktop.**

| Member | macOS |
|---|---|
| `desktop.canInstallMenuEntries` | `false`, the `.app` *is* the menu entry. The Manager already handles this and returns a message. |
| `desktop.openUrlScheme(url)` | `spawn('open', [url])` |
| `desktop.focusWindow(win)` | `win.focus()`, no `wmctrl` equivalent needed or wanted |
| `desktop.displayPicker` | `null`, no window-rule engine. `manager/main.js` already guards on `isSupported()`; make sure a `null` here doesn't throw at require time. |
| `desktop.getAutostart` / `setAutostart` | A LaunchAgent plist in `~/Library/LaunchAgents`, or `app.setLoginItemSettings()`, the Electron API is simpler and probably enough |
| `desktop.appsDir` / `desktopDir` / `writeLauncher` / `removeLauncher` / `refreshMenu` / `markTrusted` / `launcherFileName` / `autostartPath` | Only reached when `canInstallMenuEntries` is true, except `desktopDir`. Stub them to no-ops returning `false`/`''` for now. |

**Runtime, leave stubbed until Phase E.**

Everything under `runtime.*` can throw `NOT_IMPLEMENTED` or report unavailable through Phases
B–D. The minimum that must behave so the app doesn't crash:

```js
runtime = {
  id: 'none',
  prefixesDirName: 'bottles',
  setupPhase: '',
  management: { supported: false, label: '', installDirs: () => [], managedDirs: () => [],
                resolveInstallDir: () => '', isManagedDir: () => false,
                listReleases: async () => ({ ok: false, error: 'not supported', releases: [] }),
                latestRelease: async () => ({ ok: false, error: 'not supported' }),
                install: async () => ({ ok: false, error: 'not supported' }),
                cancel: () => false, remove: () => ({ ok: false, error: 'not supported' }) },
  tools: () => [], canInstallRunner: false,
  installRunner: async () => ({ ok: false, error: 'not supported' }),
  scan: () => [], resolve: () => '', isRuntimeDir: () => false,
  inUse: () => false, canRun: () => false,
  assertAvailable() { throw this.unavailableError(); },
  compatEnv: () => ({}),
  buildLaunch() { throw this.unavailableError(); },
  buildRedistLaunch() { throw this.unavailableError(); },
  regeditCommand: () => ({ cmd: 'true', args: [], env: {} }),
  toWindowsPath: p => p,
  diagnose: () => ({ code: 'NO_RUNTIME', message: 'Windows games are not supported yet on macOS.' }),
  unavailableError() { const e = new Error('Windows games are not supported yet on this build.'); e.code = 'NO_RUNTIME'; return e; },
  findAntiCheatRuntime: () => null,
  startupSteps: () => [], setupBytes: () => 0,
  redistUnavailableMessage: 'Windows games are not supported yet on macOS.',
  findUmu: () => null, findWine: () => null,
};
```

Check your work against the real thing:

```bash
node -e "const h=require('./packages/core/platform/index.js');
  const l=require('./packages/core/platform/linux.js');
  const walk=(a,b,p='')=>{for(const k of Object.keys(b)){const q=p?p+'.'+k:k;
    if(!(k in a)) console.log('MISSING '+q);
    else if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])&&k!=='displayPicker') walk(a[k],b[k],q);
    else if(typeof a[k]!==typeof b[k]) console.log('TYPE    '+q+' '+typeof a[k]+' vs '+typeof b[k]);}};
  walk(h,l); console.log('contract check done');"
```

---

## Phases, with an acceptance test each

### Phase B, it launches, ✅ DONE
`darwin.js` is written (paths, store IDs, system inventory, desktop/autostart via a
`~/Library/LaunchAgents` plist, `runtime.*` stubbed through Phase E) and passes the contract
check below with no missing members or type mismatches. `npm start`, `npm run start:couch`, and
`npx electron . installer` all launch clean, verified by screenshot, not just an empty terminal
(the fresh-install onboarding wizard rendering correctly in each face is what "the library
renders" actually looked like on a brand-new profile).

One real, host-agnostic bug caught along the way: `apps/manager/main.js`'s `display-options`
IPC handler called `host.desktop.displayPicker.isSupported()` with no null guard, fine on
Linux (never null there), but an immediate crash on macOS where `displayPicker` is legitimately
`null` per this very table. Fixed with a null check; Linux behaviour is unchanged since a real
object still passes through untouched.

Also found and fixed: `scripts/fetch-binaries.mjs` requires `platform/index.js` to resolve
`host.binDirName`, which means on a **fresh clone before `darwin.js` exists**, `postinstall`
(`fetch-binaries.mjs && electron-builder install-app-deps`) dies on the darwin platform error
and the `&&` never lets `electron-builder install-app-deps` run. `better-sqlite3` ends up built
for plain Node, not Electron's bundled Node, and the app fails with an ABI mismatch that looks
unrelated. This resolves itself for anyone cloning *after* `darwin.js` is committed (which it
now is), if you ever hit the ABI error anyway, `npx electron-builder install-app-deps` fixes it.

```bash
npm start                 # Manager
npm run start:couch       # Couch
npx electron . installer    # Installer GUI
```

**Read the terminal, not the window**, an Electron main-process error dialog keeps the process
alive, so "it stayed open" proves nothing. That mistake cost two bugs in Phase A.

### Phase B.5, build a real app, ✅ DONE
```bash
npm run dist:mac          # dmg + zip, arm64, unsigned
```
`build.mac.icon` points at `apps/manager/assets/icons/Clarity.icns`. **`sips` cannot rasterize
SVG** (`Error: Can't write format: public.svg-image`) and no other converter (`rsvg-convert`,
`imagemagick`, `inkscape`, `cairosvg`) was installed. The icon was rendered by loading the SVG
into a hidden, offscreen `BrowserWindow` at 1024px via Electron itself and downscaling with
`nativeImage.resize()` for the other 9 sizes, then `iconutil -c icns`. No new dependency needed.

Verified by actually launching the packaged `.app` (not just checking the build log), the menu
bar correctly reads "Clarity", not "Electron", confirming the icon and identity are both
wired. Because it's built locally, the `.app` never gets a quarantine bit and **Gatekeeper
doesn't appear at all**. That friction only exists for someone who *downloads* the dmg, for
them, `xattr -dr com.apple.quarantine /Applications/Clarity.app`.

### Phase B.6, gogdl, and close the tarball gap, ✅ DONE
```bash
git clone https://github.com/FromChaosComesClarity/gogdl.git gogdl_fork && cd gogdl_fork
git submodule update --init --recursive     # xdelta3, needed for the gogdl_xdelta3 C extension
python3 -m venv .venv && source .venv/bin/activate
pip install . pyinstaller
python3 -m PyInstaller --onefile --name gogdl installer_entry.py --clean --noconfirm
```
The fork wasn't already cloned on the Mac (contrary to what `fetch-binaries.mjs`'s error message
implies), that clone command above is the real one. `binaries-mac-v2` is published with the
full six-binary set; `SOURCES.darwin` in `scripts/fetch-binaries.mjs` no longer has a `missing`
block. Verified two ways: the built `gogdl --version`/`--help` run correctly (arm64 Mach-O,
ad-hoc re-signed by PyInstaller), and a full `npm run fetch-bin` end-to-end, wiped the local
binaries, re-downloaded from the actual published release, and let the script's own SHA256
check verify the hash before it was committed.

**Do not shortcut this with upstream's `gogdl_macos_arm64`.** It still has three of the four
bugs the fork exists for, see the table in `docs/mac-port-phase-a.md`.

### Phase C, scan and launch what's already installed, Steam ✅, GOG .app ✅ (via Phase D), external volumes ⏳
Steam library scan and `open steam://…` verified against a real installed Mac Steam library (7
native games), picked a small one (Wizorb), launched it via
`host.steamLaunchCommand()`, and confirmed the actual game process running full-screen.
GOG `.app` bundle detection turned out to be inseparable from Phase D (you cannot verify install
detection without doing a real install), so it's covered there instead.

**Not done: external-volume awareness for `/Volumes/`.** Zero references to `/Volumes` exist
anywhere in the codebase. This is unimplemented, not just untested. No external SSD has been
formatted on this machine yet (Day 0's step), so there's no real mount point to design or test
against. Do Day 0's SSD step before picking this up.

### Phase D, the actual goal: download and install, ✅ DONE (GOG native; Epic blocked on auth)
Verified end-to-end against Jose's real GOG account: synced the owned library (298 games, GOG
Web API `os` values translated via the `GOG_CATALOG_OS_ALIAS` fix above, 66 turned out to be
genuinely Mac-native), installed a real title (`gogdl --platform osx download`), launched it
(confirmed the actual game process, not just an `{ok:true}` return), and uninstalled it cleanly
(bundle removed from disk, DB row reset to `installed:0, install_path:null`).

**The two "two things to settle" this file originally flagged turned out to be red herrings.**
Neither `activePlat = platform || 'windows'` (now at installer-engine.js:430, not line 582, line
numbers drifted after Phase A) nor "stop trusting the singular `platform` column" needed to
change. The singular column is fine to trust at launch time *once it's computed correctly*, the
real bug was purely in how it got computed (the catalog `os`-field mismatch above). Leaving the
per-row `platform` column as user-overridable (only `platforms`, plural, refreshes on every
re-sync, see `apps/manager/main.js`'s "Linux-native vs Windows" toggle, which explicitly
persists a user's choice) turned out to be a deliberate, correct design, not an oversight.

One more real bug, found while reading the surrounding code rather than by a failure: GOG's
`goggame-<appId>.info` file (used by `gogPlayTaskList` in `installer-engine.js` for the
DLC/alternate-executable task picker) is looked up at `install_path`'s root, correct for
Windows/Linux, wrong on macOS where `install_path` **is** the `.app` bundle and GOG nests that
file in `Contents/Resources/` instead. Fixed by branching on whether `install_path` ends in
`.app`; no-op on every other host.

**Epic/legendary is not verified.** Signing in through the app's browser-based OAuth window
did not actually persist legendary auth, `~/Library/Application Support/legendary` doesn't
exist on this machine. `syncOwnedLibrary`'s Epic half fails with `ValueError: No saved
credentials` from legendary itself. The headless Epic sign-in flow (`apps/manager/main.js`
`epic-login`, mirroring `gog-login`) needs to actually complete before Epic installs can be
tested the same way GOG was here. This is a real, un-investigated gap, not a platform-backend
issue.

### Phase E, Windows games, ✅ DONE, 2026-08-24
**CrossOver, not Sikarugir.** Sikarugir was tried first (Jose's ask, since he'd already installed
it) and dropped: its app is "Sikarugir Creator.app", a GUI-only Wineskin-lineage wrapper generator
with no CLI to drive headlessly, a fundamentally worse fit than everything else this codebase
talks to. CrossOver has a real one, confirmed by hand on this machine (26.3, native ARM64,
clears the 26.5+ threshold this file used to warn about) before any code was written:

- The sanctioned entry point is `wine --bottle NAME [--no-gui] EXE args…`, at
  `Contents/SharedSupport/CrossOver/CrossOver-Hosted Application/wine` inside the app bundle
  (**not** `Contents/SharedSupport/CrossOver/bin/`, an earlier guess that was wrong). It sets up
  CX_ROOT, the GPTK/D3DMetal library paths, WINEDLLPATH etc. itself, calling the engine binary
  underneath (`wineloader`) directly skips all of that.
- `CX_BOTTLE_PATH` (an env var) relocates where a *named* bottle is looked up/created, which is
  what let installer-engine.js's existing per-game prefix scheme (`configDir/prefixes/<safe-name>`,
  unchanged from Linux) work with zero changes: the directory becomes the bottle's parent, its
  own name becomes the bottle name.
- Bottles do **not** self-initialize the way umu/Proton prefixes do, `wine --bottle` against a
  name with no bottle yet is a fatal error, and `cxbottle --create` refuses to create one at a
  path that already exists (even empty, which is exactly what installer-engine.js's own
  `fs.mkdirSync(prefix, {recursive:true})` leaves behind before `host.runtime` is ever consulted).
  `darwin.js`'s `ensureBottle()` treats "no `system.reg`" as "not a real bottle yet" and is safe
  to wipe-and-recreate from, verified against exactly that pre-created-empty-directory shape.
- `z:` still maps to `/`, same as vanilla Wine/Linux (CrossOver additionally maps `y:` to
  `$HOME`, unused here).

Because bottle creation (~15-20s, one-time per game) has to happen before a launch can be spawned
at all, `buildLaunch`/`buildRedistLaunch`/`regeditCommand` are `async` on darwin, and
installer-engine.js's three call sites (plus one in `apps/installer/main.js`) now `await` them, a
harmless no-op for Linux's plain-sync versions. Verified end-to-end with real spawns, not just
unit-style calls: a fresh, never-touched prefix directory → `buildLaunch` → bottle created →
`cmd.exe` actually ran inside it and printed real output; a second launch against the same prefix
skipped creation entirely (0.2ms vs ~10s). Not yet tested against a real Windows *game*, every
verification so far used `cmd.exe`, which proves the plumbing but not any one title's actual
compatibility. Not wired up: BattlEye/EAC (`findAntiCheatRuntime` returns `null`, CrossOver 26
advertises its own support built into the engine, unverified against a real anti-cheat title),
and there's no structured first-run progress panel the way Linux's `STARTUP_STEPS` regex-matches
umu's output (`startupSteps()` returns `[]`, the bottle-creation delay is real but silent).

---

## Three traps, in the order they'll bite

1. **App Management (macOS 15+, still in Tahoe).** Writing inside another app's `.app` bundle
   is blocked without permission, and TCC keys the grant to code signature, so an *unsigned*
   dev build can look like a new app and lose its grant on **every rebuild**.
   Mitigations: install games as plain directory trees on the SSD rather than into
   `/Applications`, and ad-hoc sign with a stable identifier:
   `codesign -s - --identifier io.github.fromchaoscomesclarity.clarity <app>`.
   **Test this on day one of Phase B**, fifteen minutes, and it shapes the whole install layout.
2. **The minimal PATH.** A Finder-launched `.app` has no Homebrew in `PATH`. Anything found via
   `which()`, dosbox, wine, 7z, will be invisible unless `which` searches
   `/opt/homebrew/bin` explicitly.
3. **Rosetta's clock.** Full support through macOS 27; from macOS 28 (~autumn 2027) only a
   games-only subset survives. It doesn't affect Phases B–D (everything there is arm64-native)
   but it decides Phase E's shape.

---

## File map

**Read these:**

| File | Why |
|---|---|
| `packages/core/platform/linux.js` | The specification. ~1000 lines, comments record real bugs. |
| `packages/core/platform/index.js` | 31 lines. How a backend is selected. |
| `docs/mac-port-phase-a.md` | What moved, what was verified, what was left. |

**Written (Phases B–D, done):**

| File | |
|---|---|
| `packages/core/platform/darwin.js` | Phase B's platform backend, plus the Phase D fixes to `findNativeInstallResult`. |
| `packages/core/installer-engine.js` | The `GOG_CATALOG_OS_ALIAS` fix in `syncOwnedLibrary` (~line 1794) and the `.app`-aware path in `gogPlayTaskList` (~line 605), both Phase D. |
| `scripts/fetch-binaries.mjs` | `SOURCES.darwin` bumped to `binaries-mac-v2`, `missing`/`provides` dropped, Phase B.6. |
| `package.json` → `build.mac.icon` | Points at `apps/manager/assets/icons/Clarity.icns`, Phase B.5. |
| `apps/manager/main.js`, `apps/installer/main.js`/`preload.js`/`renderer.js`, `apps/manager/preload.js`/`renderer.js`, both `index.html`s | Native traffic lights on macOS (`titleBarStyle:'hidden'`) instead of the custom win-btn row, not part of the original phase plan, added on request. Gated on `process.platform`/`window.api.platform`; Linux/other hosts unaffected. |

**Still to touch:**

| File | When |
|---|---|
| `packages/core/custom-installers.js` | Phase D follow-up, Mac recipes, tagged `hosts: ['darwin']`, from macsourceports.com (192 notarized Universal 2 ports) |
| `apps/installer/renderer.js` | Whenever, the External Tools panel hardcodes the Linux tool names; `check-tools` already returns a `runtimeTools` array for it to move onto |
| `apps/manager/main.js` `epic-login` | Epic/legendary auth genuinely isn't verified yet, see Phase D's status above |

**Don't touch:** the three `apps/*/main.js`, for macOS-*specific* business logic. That line got
crossed twice, deliberately, for things that weren't actually macOS-specific: the
`display-options` null-guard (a latent bug any second backend would have hit, not something
about macOS) and the traffic-light window chrome (a real `process.platform` branch, but the fix
lives in the shared window-creation code because that's where `frame`/`titleBarStyle` already
was, there's no `darwin.js` equivalent for "how a BrowserWindow gets constructed"). If you find
yourself writing `if (macOS-specific thing) { ... }` inside `apps/*/main.js`, that's still the
signal the boundary is wrong; a platform-agnostic bug that only *manifests* on a second host, or
a genuinely shared file with no platform-backend home, isn't the same thing.

---

## Rules for a two-host repo

One repo, one branch, both machines push and pull. **Don't fork.** Long-term, `mac` merges back
into `experimental` and both hosts live in one codebase, the boundary exists precisely so they
can.

**Linux is the shipping platform and outranks macOS in every conflict.**

1. **A Linux regression blocks the merge. A macOS gap does not.** The AppImage is the product;
   the Mac build is labelled Experimental and is allowed to be incomplete.
2. **Never reshape `linux.js` to suit `darwin.js`.** If the macOS backend wants a different
   contract, widen the contract, add a member, give it a sensible Linux value, rather than
   changing what Linux already does. In practice the Phase D fixes turned out not to need this:
   both `syncOwnedLibrary`'s `GOG_CATALOG_OS_ALIAS` and `gogPlayTaskList`'s `.app`-aware path
   are additive branches that are no-ops on every host but macOS, not reshapes of existing
   Linux behaviour.
3. **Anything shared gets verified on Linux before it merges**, the engine, `shared-ipc.js`,
   the renderers, `custom-installers.js`. That means `npm run dist` on the Linux box plus the
   six-path launch smoke test in `docs/mac-port-phase-a.md`, not just "it built".
   When you confirm a fix actually landed in a packaged bundle, grep the asar with **`grep -a`**
 , `app.asar` is binary, and without `-a` the check can report "not found" for a fix that is
   present. Full explanation, and the extract-and-grep alternative, in `docs/omarchy-handoff.md`
   rule 1. Locate the macOS asar rather than assuming its path, electron-builder's output dir
   depends on the arch it built: `find dist -name app.asar -path '*Contents/Resources/*'`.
4. **If a fix belongs to both hosts, make it on Linux first**, confirm the AppImage, then pull
   it over. The Linux box is the reference implementation: when something on the Mac looks
   wrong, diff against what `linux.js` does.
5. **`apps/*/main.js` should stay host-agnostic.** Phase A got them there. If macOS work needs
   to touch one, that is a signal the boundary is in the wrong place, fix `darwin.js` instead.

Copy the memory directory across too. The Mac's project key will be `-Users-jose-…`, so it's a
copy into the Mac's own memory dir, not a symlink.
