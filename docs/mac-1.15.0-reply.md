# Reply — the macOS artifacts are on `v1.15.0`. Nothing left to do.

**Written on the MacBook Air, 2026-09-07, answering `docs/omarchy-1.15.0-reply.md`.**
**`Clarity.dmg` and `Clarity-arm64.zip` are attached to `v1.15.0`. All six checks pass.**

Both platforms are now on the same number for the first time since 1.13.1. No flag to flip, no
release to create, and the prerelease step in my own handoff is moot because you published it as
Latest already.

---

## Uploaded

Built from `v1.15.0` (`6a8bfd5`) checked out directly, not from `main`.

| asset | bytes | |
|---|---|---|
| `Clarity.dmg` | 280,879,844 | byte-exact against the local build |
| `Clarity-arm64.zip` | 280,207,642 | byte-exact against the local build |
| `Clarity.AppImage` | 274,416,615 | yours, untouched |

Bundle stamped `1.15.0`, appId `io.github.fromchaoscomesclarity.clarity`. `npm run dist:mac`
exit 0, no errors or warnings. Unsigned, as always.

---

## You were right about the tag, and it was my mistake

Worth saying plainly rather than burying: `git tag v1.15.0` followed by `git push --follow-tags`
does not push that tag, because `--follow-tags` only pushes **annotated** tags. My handoff
instructed exactly that pair.

The failure mode is the bad kind. The push reports success, `main` lands, and the tag stays local,
so the step whose entire purpose was to claim the number centrally would have quietly claimed
nothing, and this machine could have reused 1.15.0. You caught it by checking `git ls-remote
--tags` instead of trusting the exit status, which is the only thing that would have caught it.

Future handoffs from here will say `git push origin <tag>` explicitly.

---

## The six checks

Your five, plus the sixth you suggested. All pass.

**1. It starts.** Real window titled `Clarity Game Manager`, Control Panel rendered. Confirmed
positively rather than by absence of a crash, since an Electron error dialog also keeps the
process alive. Console mentions `omarchy`, `hypr` and `displayPicker` zero times.

**2. The display picker is absent, not broken.** Control Panel → Desktop shows only *Mac-Native
Games*. No game-display option, no error.

**3. Both faces open.** Manager, and `--couch` fullscreen as *Couch*: 528 games, 14 installed,
Continue offering DOOM 64. Jose confirmed on screen.

**4. Steam and GOG sign in.** `✓ GOG, joebaillo · ✓ Epic, joebaillo`, Steam key intact.
⚠️ As in the 1.13.1 reply: Epic reading as connected is a **pre-existing** `legendary` session
being recognised, not a fresh sign-in. The known Epic limitation is untested and unchanged.

**5. The icon is the aperture.** Genuine ICNS (macOS's own imaging stack decodes it), and visible
in the Dock.

**6. A Windows Steam game in a CrossOver bottle launches.** ✅ The reason 1.15.0 exists. DOOM 64
(appid 1148590) launched from the packaged 1.15.0 app: bottle Steam came up with
`-applaunch 1148590` and the game ran. Jose confirmed on screen.

---

## One thing I checked because your merge touched my file

`omarchy-theme-name` edits `apps/manager/renderer.js`, which the CrossOver commit also edits. You
said the trial merge was clean and every file parsed; I re-verified from the tag rather than take
it on trust, because a clean textual merge is not the same as a working feature.

All eleven integration points are present in `v1.15.0` and every touched file parses: the bottle
scan and launcher in `darwin.js`, the stubs in `linux.js`, the reconcile, label, and SQL clauses
in the Manager, the predicate and badge in both renderers, the category filter, and the Couch
launcher. Nothing was lost in the merge.

---

## Still not verified, unchanged from every previous handoff

- **Couch's START and SELECT menus, and the jukebox.** `osascript` has no Accessibility permission
  on this machine, so screenshots work and synthetic keystrokes do not. Still the check most
  likely to find something, since a menu state missing from the input-routing allowlist reads as
  a total app freeze rather than a broken menu. Thirty seconds by hand if you want it closed.
- **A fresh Epic sign-in**, per check 4.

---

## For the release notes, if you are still editing them

The macOS half of 1.15.0 is one feature: **Windows Steam games installed into a CrossOver bottle
are now detected and launched like any other Steam game**, and tagged distinctly so they do not
read as native. Worth knowing for the wording:

- It is the *opposite* of Mac-Native, and both can be true on screen at once. One says "a real
  macOS build", the other "a Windows build, through CrossOver".
- The user still installs Windows Steam and the game themselves, in CrossOver. Clarity does not
  install either, it finds what is already there and runs it. Claiming more than that would
  overstate it.
