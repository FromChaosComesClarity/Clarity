# Reply — 1.15.0 is tagged, built and published. Build and upload whenever you like.

**Written on Omarchy, 2026-09-07, answering `docs/omarchy-1.15.0-handoff.md`.**
**`v1.15.0` exists, `Clarity.AppImage` is attached, and the release is already Latest.**

Everything asked of this side is done. The tag is pushed, so the number is claimed and you can
build against it. One thing changed from your plan and one thing in your instructions was
broken; both are below, and the second is the one worth reading.

---

## Where it stands

| | value |
|---|---|
| tag | `v1.15.0` at `6a8bfd5` |
| release | **Latest**, not a prerelease |
| asset | `Clarity.AppImage`, 274,416,615 bytes |
| `package.json` / both lockfile fields | `1.15.0`, all three |

Verified from the artifact rather than the build log: the AppImage carries
`X-AppImage-Version=1.15.0`, and extracting its asar confirms your `steamBottleForApp` stubs and
both Linux fixes are inside. The published asset is byte-identical to the local build.

---

## ⚠️ Two changes from your plan

**1. It is Latest already. Do not flip it, just upload.**

You asked for a prerelease so `v1.14.0` would stay Latest until your artifacts landed. I did
publish it that way, then Jose asked for a normal release and that is his call: Linux is the main
version, so a release carrying the Linux AppImage is a complete release from here, and yours
attach to it when they are ready.

So skip the last step of your own doc. `gh release edit --prerelease=false --latest` has already
happened. Until you upload, Latest has a Linux download and no macOS one, which is the known and
accepted cost of that decision.

**2. Both in-flight Linux branches went in.**

You left the call to me and both belonged in the release rather than trailing it:

- `739c41b` the launch log prints the command it actually ran
- `ba42674` the theme picker names the desktop theme it is wearing

Merged as `#14` and `#15`. Neither touches macOS behaviour. `omarchy-theme-name` edits
`apps/manager/renderer.js`, which your CrossOver commit also edits, so I trial-merged before
committing to anything: clean, and every merged file still parses.

---

## ⚠️ The tag command in your doc does not push the tag

This is the part to fix in the next handoff, because it silently defeats the thing you wanted
most from this step.

```bash
git tag v1.15.0
git push origin main --follow-tags     # ← does NOT push this tag
```

`--follow-tags` pushes **annotated** tags only. `git tag v1.15.0` creates a lightweight one, so
the push reports success, main lands, and the tag stays on the machine. I only caught it because
I checked `git ls-remote --tags` afterwards rather than trusting the exit status.

Since your stated reason for pushing the tag was to claim the number centrally so this machine
could not reuse it, a tag that never left would have quietly given us exactly the collision the
step exists to prevent. Pushed explicitly with `git push origin v1.15.0`. It is on the remote
now, and lightweight matches `v1.13.1` and `v1.14.0`, which are both lightweight too.

Either `git tag -a v1.15.0 -m ...` with `--follow-tags`, or an explicit `git push origin <tag>`.
Not the pair as written.

---

## Your half

```bash
git fetch --all --tags --force
git checkout v1.15.0
npm install
npm run dist:mac

gh release upload v1.15.0 dist/Clarity.dmg dist/Clarity-arm64.zip \
  --repo FromChaosComesClarity/Clarity
```

Nothing else. No release to create, no flag to flip.

Your own five checks from `docs/mac-release-handoff.md` still apply, and the startup-crash one
still matters most. Worth adding a sixth this time, since 1.15.0 exists for it: **a Windows Steam
game in a CrossOver bottle actually launches**.

---

## What Linux carries, for your notes

The release notes are written and cover both platforms; edit them if your build turns up anything
worth saying. For the record, your reading of the Linux impact was correct and I checked it rather
than taking it on trust:

- `linux.js` gains exactly nine lines, all no-op stubs
- `reconcileSteamBottleCommands()` cannot write to a Linux library: the guard at
  `apps/manager/main.js:2638` is as you quoted it, and `steambottle://` appears nowhere in
  `linux.js`, so every row hits `continue`

Nothing in the CrossOver diff changes existing Linux behaviour.
