# Handoff — cut 1.15.0 on Omarchy, then the Mac attaches its artifacts

**Written on the MacBook Air, 2026-09-07, at `main` = `3089233`. To be read on Omarchy.**

You bump and release. The Mac builds its dmg afterwards against whatever tag you create, and
uploads it to the same release. This doc says what is waiting, what the version has to be, and
the one ordering rule that keeps Linux from ever being Latest without an AppImage.

---

## Why a bump is needed at all

`main` is **4 commits past the `v1.14.0` tag**, and one of them is a real feature:

```
3089233  Detect and launch Windows Steam games installed in a CrossOver bottle   ← macOS feature
267e486  Merge pull request #13 from FromChaosComesClarity/tagline
f94ab36  The motto replaces the old sign-off
16b13db  README: say 1.14.0, and that macOS ships on the same release (#12)
```

`package.json` still says **1.14.0**, so a build made from `main` today would be stamped with a
version whose tag does not contain this code. That is the "two builds answering to the same
number" problem 1.13.1's own notes call a debugging problem you only get to have once. Hence the
bump, before anything is built on either host.

---

## ⚠️ Where the two platforms actually are

Not what the release page implies at a glance:

| | version | evidence |
|---|---|---|
| Linux | **1.14.0** | `Clarity.AppImage` on `v1.14.0`, a real build from tag `5b9e273` |
| macOS | **1.13.1** | see below |

**There has never been a macOS 1.14.0.** The Mac assets sitting on the `v1.14.0` release are the
1.13.1 builds, copied across and honestly renamed. Verified byte-for-byte, not guessed:

| asset on `v1.14.0` | bytes | same file as |
|---|---|---|
| `Clarity-1.13.1.dmg` | 280,817,259 | `Clarity.dmg` on `v1.13.1` |
| `Clarity-1.13.1-arm64.zip` | 280,196,239 | `Clarity-arm64.zip` on `v1.13.1` |

So 1.15.0 closes a 1.13.1 → 1.15.0 gap on the Mac side. That is fine and worth a line in the
notes; it is not an error to explain away.

---

## What to do

### 1. Decide what goes in first

Two branches are unmerged, each 1 commit ahead of `main` and 1 behind it:

- `origin/launch-log-quoting` — `739c41b` The launch log prints the command it actually ran
- `origin/omarchy-theme-name` — `ba42674` Say which desktop theme, not just that there is one

**Neither is in 1.15.0 unless you merge it first.** Both are Linux-side work and both look like
they belong in this release rather than trailing it, but that is your call, and it is much easier
to decide now than to explain later why 1.15.0 shipped without them.

### 2. Bump, tag, push

```bash
git fetch --all --tags --force      # ⚠️ two machines push here; --force or a moved tag stays stale
git checkout main && git merge --ff-only origin/main
# merge the two branches above first, if you want them in

# bump BOTH, they drifted apart once already and it was caught by accident
#   package.json      "version": "1.15.0"
#   package-lock.json two places: the top-level and packages."".version
npm install --package-lock-only      # or edit both by hand, then verify:
grep -m2 '"version"' package.json package-lock.json

git commit -am "Bump to 1.15.0 — Windows Steam games through CrossOver on macOS"
git tag v1.15.0
git push origin main --follow-tags
```

Pushing the tag is the part that matters for the two of us: it **claims the number centrally**,
so this machine cannot pick 1.15.0 for something else. Nothing anywhere claims it right now, I
checked both branches and both are still on 1.14.0.

### 3. Build and publish, prerelease FIRST

```bash
npm install
npm run dist                          # → Clarity.AppImage

gh release create v1.15.0 dist/Clarity.AppImage \
  --repo FromChaosComesClarity/Clarity \
  --title "Clarity 1.15.0" \
  --notes-file <your notes> \
  --prerelease
```

⚠️ **`--prerelease` is not optional, and this is the whole ordering rule.** GitHub computes
"Latest" as the newest release that is not a draft or prerelease. Publish 1.15.0 as a normal
release and it becomes Latest immediately — with, for a while, no macOS asset on it. Left as a
prerelease, **`v1.14.0` stays Latest** and nobody lands on a half-populated release.

### 4. Tell the Mac

Once the tag is pushed, the Mac builds `Clarity.dmg` + `Clarity-arm64.zip` from `v1.15.0`, runs
its checks, and uploads them to that same release. **Then** flip it:

```bash
gh release edit v1.15.0 --repo FromChaosComesClarity/Clarity --prerelease=false --latest
```

At that point 1.15.0 is Latest with both platforms present, and macOS is finally on the same
number as Linux for the first time since 1.13.1.

---

## What 1.15.0 actually changes for Linux

**Behaviourally, nothing.** Worth knowing before you wonder what to write in the notes.

The CrossOver feature is macOS-only by construction. Linux gets **9 lines** in `linux.js`, all
no-op stubs (`steamBottleForApp` returning null and two siblings), purely so callers can ask on
any platform without branching on `host.id` — the same shape `extraStore` uses to say "not
supported here".

I checked the one thing that could have bitten you, because a reconcile that writes to the
library on the wrong platform would be a bad surprise:

> `reconcileSteamBottleCommands()` runs on every platform, but its guard is
> `if (!isBottleCmd(want) && !isBottleCmd(LaunchCommand) && !isBottleCmd(LaunchCommands)) continue;`
> On Linux `steamLaunchCommand()` never returns a `steambottle://` command and no Linux row can
> contain one, so **every row hits `continue` and nothing is ever written.**

The rest of the diff on shared files is additive: extra `OR … LIKE '%steambottle://%'` clauses in
the Steam SQL, and one extra branch each in `guessLauncherLabel`/`launcherStore`. No existing
behaviour changes.

So for Linux, 1.15.0 = 1.14.0 + the README/tagline commits (+ whatever you merge in step 1).

---

## What not to do

- ⚠️ **Do not move the `v1.14.0` tag** or rebuild its AppImage. It is out in the world and it is
  Latest. A release missing a commit is fixed by a new version.
- ⚠️ **Do not publish 1.15.0 as a normal release before the Mac artifacts are on it.** See step 3.
- **Do not build a Mac artifact here.** `npm run dist:mac` needs macOS; that half is mine.
- ⚠️ **`git fetch --tags --force` before you push.** Two machines push to this repo, and a plain
  fetch will not update a tag ref that already exists locally.
