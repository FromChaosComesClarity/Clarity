# Clarity on Omarchy Linux, handoff

**This is a new desktop environment, not a new platform.** Omarchy is Arch with Hyprland;
`host.id` is `linux` and it runs the exact same `packages/core/platform/linux.js` every Linux host
here has always run. Nothing like the macOS port is needed, and there is no `omarchy.js` to write.

⚠️ **Omarchy is now the only Linux machine.** This document was written on 2026-08-24 for an
Omarchy *laptop* joining a Nobara desktop and a Mac. On **2026-08-25**, hours after 1.9.2 shipped,
Nobara was wiped and Omarchy installed on the gaming desktop itself. So there is no desktop to
defer to, no second Linux host to check a regression against, and **releases are cut here.**
Wherever this document says "the reference desktop", it means this machine.

What is genuinely new here is the **desktop environment**: a Wayland tiling compositor instead of
KDE/KWin. That is a layer the codebase already has a place for, see *Where Hyprland features go*.

Companion documents: `docs/mac-port-handoff.md` (the macOS equivalent) and
`docs/mac-port-phase-a.md` (what the host boundary is and why).

---

## The rules that matter before you write anything

1. **Verify the artifact before publishing, from whichever host you build on.**

   This rule used to read "Nobara is the only release host, because building on rolling Arch
   raises the glibc floor for everyone." That was measured on 2026-08-25 and **it is not what
   happens**. An AppImage built on Omarchy (glibc 2.44) demands at most:

   | Binary | Highest symbol |
   |---|---|
   | `clarity` (the Electron binary) | `GLIBC_2.25` |
   | `better_sqlite3.node`, `comet` | `GLIBC_2.34` |

   `GLIBC_2.34` is from 2021. Nothing is compiled against the build host's glibc: Electron ships
   prebuilt from upstream, `better-sqlite3` arrives as a downloaded prebuild
   (`electron-builder` logs `buildFromSource=false`), and our helpers come from the pinned
   binaries tarball.

   ⚠️ **The risk is real but conditional.** If `prebuild-install` ever fails, a new Electron ABI
   with no published prebuild, or anyone passing `--build-from-source`, then node-gyp compiles
   `better-sqlite3` locally and *that* build bakes in the host's glibc. On Arch that is 2.44, and
   users on older distributions find out as `GLIBC_2.xx not found`.

   So the rule is not "never build here". It is **verify the artifact, every release**.

   **First check: the glibc floor.**

   ```bash
   # after `npm run dist`, before uploading anything
   find dist/linux-unpacked -type f | while read f; do
     head -c4 "$f" | grep -q $'\x7fELF' || continue
     objdump -T "$f" 2>/dev/null | grep -oE "GLIBC_[0-9]+\.[0-9]+"
   done | sort -uV | tail -3
   ```

   Anything above **`GLIBC_2.34`** means something got compiled locally, stop and find out what
   before you publish. Also confirm the build log still says `buildFromSource=false`.

   Reproducibility is still a good reason to cut releases from one known machine. The glibc
   argument, on its own, is not.

   **Second check: the release's headline fix is actually in the artifact.** A release exists for
   a reason, confirm that reason shipped. Grep the packaged asar for a symbol only the fix
   introduces. For 1.9.2 that was `ensureCaBundle`, the CA-bundle resolution that unbroke GOG
   installs everywhere outside Fedora:

   ```bash
   grep -ac ensureCaBundle dist/linux-unpacked/resources/app.asar   # expect a non-zero count
   ```

   ⚠️ **The `-a` is not optional, and leaving it off fails silently.** `app.asar` is a binary
   file, so without `-a` this can print nothing and exit 1, which is indistinguishable from
   "the fix is missing", depending on which `grep` actually runs:

   | Runner | `grep -c` | `grep -ac` |
   |---|---|---|
   | GNU grep 3.12, in your own terminal | `2` ✅ | `2` ✅ |
   | Claude Code's `grep` (bundled ugrep, `-I`) | *nothing*, exit 1 ❌ | `2` ✅ |

   Claude Code injects a shell **function** that shadows `grep`, it routes to its own bundled
   ugrep with `-I` (skip binary files) among the default flags, so the asar is never even read.
   The check therefore passes by hand and lies when an agent runs it, which is the worst possible
   direction for a pre-publish gate to fail in. `LC_ALL=C` does **not** help; only `-a` (or
   `--binary-files=text`) does. Verified on 2026-08-25 while cutting 1.9.2.

   If you want certainty rather than a count, extract the file and grep plain text. This is
   immune to whose `grep` is on the path:

   ```bash
   cd "$(mktemp -d)" && npx --yes @electron/asar extract-file \
     ~/Documents/DEVELOPMENT/CLAUDE/Clarity/dist/linux-unpacked/resources/app.asar \
     packages/core/platform/linux.js && grep -n ensureCaBundle linux.js
   ```

   ⚠️ `npx asar extract-file` writes into the **current** directory. Never run it from the repo
   root. It will overwrite the real `linux.js` with the packaged copy. Hence the `mktemp -d`.
2. **Linux outranks macOS, and this is the Linux host.** A regression here blocks a merge; a
   macOS gap does not. A KDE-only feature not existing under Hyprland is not a regression, and
   neither is the reverse.

   ⚠️ **KWin code still ships but can no longer be exercised.** `kwin-display.js` is behind an
   `isSupported()` gate and simply disappears under Hyprland, so it cannot visibly regress here.
   Treat it as code you can read but not test, and do not delete it because it looks dead.
3. **Two machines push to one repo, this one and the Air. `git fetch` first, always.** This
   cost three rejected pushes on 2026-08-24, back when there were three. A rejected push is
   **not** all-or-nothing, git pushes refs independently, so a tag can land while the branches
   fail. Use `--atomic` when it matters.
4. **`apps/*/main.js` stays host-agnostic.** If Hyprland work needs to touch one, the boundary
   is in the wrong place. Same rule the macOS port lives under.

---

## Day 0, the toolchain

```bash
sudo pacman -S --needed git base-devel nodejs npm fuse2 github-cli
node -v                       # want v22.x, the last Nobara build ran 22.22.2
```

- **`fuse2` is not optional.** AppImages will not run without it, so you cannot test your own
  build otherwise.
- **`base-devel`** is what rebuilds `better-sqlite3` against Electron's ABI.
- **`gh auth login` is required, not optional.** Releases are cut here now, and `gh` is also the
  git credential helper (`credential.https://github.com.helper = !/usr/bin/gh auth git-credential`)
 . There is no global helper, so **nothing pushes until gh is logged in.** Scopes: `repo`,
  `workflow`, `gist`, `read:org`.

---

## Day 1, clone and run

```bash
git clone https://github.com/FromChaosComesClarity/Clarity.git
cd Clarity
npm install
npm start
```

`npm install` runs `postinstall`, which:

- downloads the pinned helper binaries (`binaries-v2`) into `assets/bin/linux/`, **six
  binaries, gitignored, and the tarball is the only place our patched `gogdl` lives.** Never
  point that pin at an upstream build; see `docs/` and the gogdl fork's history.
- rebuilds `better-sqlite3` for Electron via `electron-builder install-app-deps`.

Three faces, three commands:

```bash
npm start                 # The Manager
npm run start:couch       # Couch
npx electron . installer    # Installer
```

**Read the terminal, not the window.** An Electron main-process error dialog keeps the process
alive, so "it stayed open" proves nothing. That mistake has cost real bugs twice on this project.

`npm run dist` builds the AppImage and `postdist` copies it to `~/Games/Clarity/`, that path is
hardcoded in `package.json`. See gap 2 below before you run it.

---

## Three gaps the clone doesn't cover

Everything above assumes `git clone` hands you a working machine. These three are the places it
doesn't, and each one wastes a first day if you meet it cold.

**1. `.claude/` is gitignored, so Claude Code arrives with no project config.**
`.gitignore:28` ignores the whole directory, which means `.claude/settings.local.json`, the
`defaultMode: bypassPermissions` and the long Bash allowlist grown over months of sessions,
never leaves the machine it was written on. ClaudeMemKeeper's `projectConfig` set covers
`~/.claude.json`; do not assume it covers a file living inside the repo. The symptom is Claude
stopping to ask permission for routine `git`/`npm`/`node` calls. All six repos' copies were
rescued before the wipe:

```bash
mkdir -p .claude
cp /run/media/jose/backup/irreplaceable/06-claude-config/repo-settings-local/Clarity/settings.local.json \
   .claude/
```

**2. `postdist` fails loudly on a machine with no `~/Games/Clarity`.** The script is
`[ -f $D/$F ] && mv …; cp dist/$F $D/$F`, with the directory missing, `cp` exits non-zero and
npm prints a red `postdist` failure **after the AppImage has already built correctly**. Nothing is
broken and `dist/Clarity.AppImage` is fine, but the error reads like a failed build. Create
the folder once and it never comes up again:

```bash
mkdir -p ~/Games/Clarity
```

While you are there: restoring `GameManagerConfig/` gives you a real library to test against.
Without it the machine starts empty and no library-shaped bug reproduces.

```bash
rsync -a /run/media/jose/backup/irreplaceable/01-game-manager-config/ \
         ~/Games/Clarity/GameManagerConfig/
```

**3. `npm run dist` here is both the test build and the shipped one.** This gap used to read
"never shippable", on the theory that building on rolling Arch links `better-sqlite3` and Electron
against Arch's glibc and silently raises the floor for every downloader. **That was measured on
2026-08-25 and it is not what happens**, nothing compiles against the host's glibc, and an
Omarchy-built AppImage demands at most `GLIBC_2.34`. See rule 1.

So build freely, and publish from here too. There is nowhere else. What replaced the old rule is
not caution about the machine but **verification of the artifact**: both checks in rule 1, every
release, built from the tag, immediately before publishing.

---

## What to check on this machine, first hour

**1. `/etc/os-release`.** `linux.js:394-397` picks the package-manager hint for DOSBox from `ID`
and `ID_LIKE`, and `:901` does the same for pipx. Arch is already handled:

```bash
grep -E '^(ID|ID_LIKE)=' /etc/os-release
```

If Omarchy sets `ID=omarchy` **without** `arch` in `ID_LIKE`, those hints fall through to a
generic message. One-line fix in the `is(...)` chain, worth doing, since a wrong hint tells the
user to run a command their distro doesn't have.

**2. Which optional tools exist.**

```bash
for t in wmctrl update-desktop-database gio xdg-open flatpak dosbox dosbox-staging umu-run; do
  printf '%-24s %s\n' "$t" "$(command -v $t || echo MISSING)"
done
```

Nothing here *breaks* if they are missing. That was made true in `0f80ab3`, see below, but it
tells you which features will silently do nothing.

**3. That the app starts all three faces without an error dialog.**

---

## Things that already handle a tiling Wayland WM correctly

Verified by reading the code on 2026-08-24, not assumed:

| Thing | Behaviour here |
|---|---|
| **KWin display picker** (`packages/core/kwin-display.js`) | `isSupported()` requires `kde` in `XDG_CURRENT_DESKTOP`/`DESKTOP_SESSION` **and** `kscreen-doctor` **and** `qdbus`. Under Hyprland it is false and the whole feature disappears. `apps/manager/main.js` guards on it. |
| **`focusWindow`** (`linux.js`) | Returns early with no `DISPLAY`, so a pure-Wayland session skips it. Under XWayland (`DISPLAY` set, real X11 handle) it works as it always did. |
| **Optional desktop tools** | `spawnOptional()` attaches a real `'error'` listener, a missing `wmctrl` / `gio` / `xdg-open` / `update-desktop-database` is now a no-op instead of a fatal error. |
| **Desktop entries** | Plain XDG: `~/.local/share/applications` + `update-desktop-database`. Whatever launcher Omarchy ships reads those. |
| **Package hints** | `sudo pacman -S dosbox-staging` and `sudo pacman -S python-pipx` already exist. |
| **Helper binaries** | Plain x86-64, distro-independent. |

### ⚠️ The bug this machine surfaced before it even existed

`try { spawn(tool, args).unref() } catch {}` **is not a guard.** `spawn` reports a missing binary
through an *asynchronous* `'error'` event, so the `try/catch` never sees it, and an unhandled
`'error'` on a ChildProcess is fatal. Four sites had that shape, each spawning a tool a minimal
Wayland-only Arch box plausibly lacks, `wmctrl` most of all, being an X11 tool. `focusWindow` is
reached from Couch, so **Couch is the face that would have died on startup.**

Fixed in `0f80ab3` with `spawnOptional()`. If you add another optional-tool spawn, use it.
**`spawnSync`/`execSync` are unaffected, they really do throw.**

⚠️ **The published 1.9.0 AppImage does not contain this fix** (built before it). Build from
source on this machine, or wait for the next tag.

---

## Where Hyprland features go

**Copy the `kwin-display.js` pattern.** That module is the existing precedent for a
desktop-environment-specific feature:

- a self-contained module under `packages/core/`,
- exposing an **`isSupported()`** that checks for the environment *and* the tools it needs,
- wired into `linux.js`'s `desktop` object (`desktop.displayPicker`),
- with every caller guarding on `isSupported()`, and tolerating `null`.

⚠️ That last point is not theoretical: `apps/manager/main.js`'s `display-options` handler called
`displayPicker.isSupported()` with no null guard, which was fine on KDE and an instant crash on
macOS where the picker is legitimately `null`. A second *desktop environment* can expose the
same class of bug a second *platform* did.

So a Hyprland equivalent, a display/workspace picker, say, is a new module beside
`kwin-display.js`, selected at runtime, **not** a branch inside `linux.js` and definitely not
inside `apps/*/main.js`.

What Hyprland plausibly offers that KWin's picker does: `hyprctl` is a clean IPC surface
(`hyprctl monitors -j`, `hyprctl dispatch`, and window rules via `hyprctl keyword windowrulev2`)
and is far less hostile than KWin turned out to be, KWin 6.7 **ignores** rules written into
`kwinrulesrc` by anyone but itself, which is why that module drives the Scripting D-Bus API
instead. Do not assume the same constraint applies here; check before designing around it.

---

## Branches and the release cycle

```
main == experimental == mac        # kept level; all three push to origin
```

New work goes on `experimental`, ff-merges into `main` when Jose says so, then both are pushed
and `mac` is brought level. Releases: bump `package.json` + `package-lock.json`, write
`RELEASE_NOTES_vX.Y.Z.md`, tag, push, then: `git checkout <tag>`, build from the tag, never from
`main`, `npm install`, `npm run dist`, run **both checks in rule 1**, and only then
`gh release create`.

Two hard-won constraints on that last step. **Build immediately before publishing**: 1.9.0 shipped
an AppImage built eleven minutes before its own fix merged, and 1.9.1 exists solely to correct
that. **Never move a published tag**, the fix for a release missing a commit is a new patch
version, not a retagged old one. Also clear `dist/` first; a stale AppImage from the previous
release sits there looking exactly like a fresh one.

Do not delete the `mac` branch, the Air pushes to it, and macOS work continues there.

---

## Where the project's real memory is

Everything about the app's history, decisions and traps lives in Claude Code's memory directory,
not in this repo. Restore it with **ClaudeMemKeeper**, see `MEMORY_RESTORE.md` beside this file.
Start the first session on this machine with:

> "Resume the Clarity project. Read your memory files for context."

### ⚠️ `.claude/` is gitignored, so the project config does not arrive with the clone

`.gitignore:28` ignores the whole directory. That includes **`.claude/settings.local.json`**, the
`bypassPermissions` default and the Bash allowlist grown over months of sessions, so it never
leaves the machine it was built on, and `git clone` cannot bring it.

ClaudeMemKeeper's `projectConfig` set covers `~/.claude.json`; **do not assume it covers a file
living inside the repo.** The symptom is Claude stopping to ask permission for routine
`git` / `npm` / `node` calls on an otherwise fully restored machine.

It was rescued before the wipe, the restore command is in **gap 1** above, and all six repos'
copies are under `06-claude-config/repo-settings-local/` on the backup drive.

While you are copying things: restoring `GameManagerConfig/` (gap 2) gives you a real library to
test against. Without it the new machine starts empty and no library-shaped bug reproduces, and a
restored library is itself worth testing, since several bugs only appear in one (install paths
written on another machine, a UI scale chosen for another screen).
