# Reply — 1.13.1 is out on macOS, and the migration script had a hole

**Written on the MacBook Air, 2026-09-04, answering `docs/mac-release-handoff.md`.**
**`Clarity.dmg` and `Clarity-arm64.zip` are attached to `v1.13.1`. All five checks pass.**

The startup crash is fixed and the release is published. But getting there turned up a real
defect in `scripts/migrate-to-clarity.mjs` that would have cost any macOS user their GOG session
and four broken game paths, silently. That is the part worth reading.

---

## Published

Both artifacts uploaded to the existing `v1.13.1`, so the two hosts share one tag:

| Asset | Bytes |
|---|---|
| `Clarity.dmg` | 280,817,259 |
| `Clarity-arm64.zip` | 280,196,239 |
| `Clarity.AppImage` (yours, already there) | 274,408,371 |

Sizes confirmed byte-exact against the local files after upload. Build was `npm run dist:mac`,
exit 0, no errors or warnings. Unsigned, as expected.

`docs/macos-guide.md` still needs its version line moved off 1.9.0 — I have not touched it,
since you flagged it as a decision that follows the release-target choice.

---

## ⚠️ The migration script strands the installer database on macOS

**Found by running it, not by reading it.** After a clean `--apply` that reported
`needs attention: 0`, the Connections page said **GOG not connected**. It had been connected as
`joebaillo` four days earlier.

### What happened

The installer database has **two** possible homes, and `findInstallerDb()` in both platform
backends looks in both, in this order:

1. the engine's own userData — `~/Library/Application Support/clarity-installer/library.db`
2. beside the app data — `<appDir>/InstallerConfig/library.db`

The script only ever migrated **the first**. On this Mac the database was in **the second**,
because the Manager face creates it next to the app data rather than in the installer's
userData. So `~/Library/Application Support/grinder/grinder.db` genuinely did not exist — the
script said so, truthfully — while the real 73 KB database sat in `CafeNeurotico/GRINDERConfig/`
and rode along under the parent-directory rename, keeping its **old filename**, at a path
nothing looks for any more.

The damage was not only the disconnect:

- **The GOG access and refresh tokens, the user id, and `gogdl_auth.json`** were all in there.
- **Four installed games** (`VVVVVV`, `BIOTA`, `Torment: Tides of Numenera`, `VirtuaVerse`)
  still had `install_path` pointing at `/Games/CafeNeurotico/`, which no longer exists. The
  rewrite pass never ran on this database because the script never found it.
- ⚠️ **The next sign-in or install would have created a fresh empty `library.db`** at the
  userData path, next to 11 GB of games it could not see. That is precisely the failure the
  script's own header warns about — reached *through* the script rather than by skipping it.

It had not happened yet when I found it: `findInstallerDb` returned null and nothing had called
`ensureInstallerEngine(createIfMissing)`.

### Fixed here

`scripts/migrate-to-clarity.mjs` now:

- renames `<appDir>/GRINDERConfig` → `<appDir>/InstallerConfig` as a whole directory, because
  the engine resolves `gogdl_auth.json`, `prefixes/` and the logs from `path.dirname(dbPath)`
  (`apps/manager/main.js:440`) — they have to stay with the database, not be moved piecemeal;
- migrates and rewrites the database in **both** candidate homes, in `findInstallerDb`'s own
  order, instead of only the engine's userData.

This is **not macOS-only**. `linux.js:115` has the same two-entry candidate list, so a Linux
install whose database lives at `<appDir>/InstallerConfig` had the same hole. Worth a look on
your side before anyone else migrates.

### Repaired on this machine

Directory renamed, `grinder.db` → `library.db`, then the fixed script applied the rewrite it had
missed. Verified after: `PRAGMA integrity_check` = ok, tokens present, **0 rows** containing
`CafeNeurotico`, and all four `install_path` values now resolve to directories that exist on
disk. GOG reads `✓ GOG, joebaillo` again.

---

## The five checks

**1. It starts.** ✅ The bug this release exists to fix is fixed. Confirmed positively rather
than by absence: a real window titled `Clarity Game Manager` with the Control Panel rendered —
an error dialog would carry neither. Console clean.

**2. The display picker is absent, not broken.** ✅ Control Panel → Desktop shows only
*Mac-Native Games*. No game-display option, no error.

**3. Both faces open.** ✅ Manager, and `--couch` fullscreen as *Couch* — 527 games, Today's
Pick, and the Continue / Surprise Me tiles.

**4. Steam and GOG sign in.** ✅ **only after the fix above.** Steam's key survived untouched
(it lives in `games.db`). GOG needed the repair.

⚠️ Epic also reads `✓ Epic, joebaillo`, but do not take that as Epic being fixed — it is a
**pre-existing** `~/.config/legendary/user.json` being recognised, not a fresh sign-in. The
known limitation is about the browser approval not writing credentials where `legendary` looks,
and I did not re-test that. Nothing here contradicts the handoff.

**5. The icon is the aperture.** ✅ Cyan aperture on dark, in Finder and in the bundle — not a
generic document. The ICNS is genuine: 8 chunks, `ic11` through `ic10`, declared length matching
actual, and **macOS's own imaging stack decodes it** (`sips` converted it), which is the real
test against the ImageMagick trap you flagged.

---

## Also verified

**The `binaries-mac-v2` pin.** Downloaded independently from this host: the URL resolves and the
SHA256 matches `892a2512…6559c3` exactly. A fresh clone will fetch correctly. Worth stating
plainly that the build itself did **not** exercise this — `predist` skipped the fetch because
helper binaries were already on disk from the pre-rename builds, so the pin was checked by hand
rather than by the build.

**Bundle metadata.** `CFBundleIdentifier` = `io.github.fromchaoscomesclarity.clarity`,
`CFBundleShortVersionString` = `1.13.1`.

---

## Not checked

- **Launching a game.** No `--play=`, no Play button. The four repaired paths were verified to
  exist on disk, but nothing was actually started.
- **Couch's START and SELECT menus, and the jukebox.** Same blocker as the last handoff:
  `osascript` has no Accessibility permission here, so screenshots work and keystrokes do not.
  Still the check most likely to find something, since a menu state missing from the
  input-routing allowlist reads as a total freeze rather than a broken menu.
- **A fresh Epic sign-in**, per above.
