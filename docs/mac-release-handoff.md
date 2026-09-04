# Handoff: build and release the Mac side at 1.13.1

Written on the Linux machine, for the Mac. Linux is at **1.13.1**; the last macOS
release is **1.9.0**, five versions behind. Everything below has been prepared and
verified from this side. What is left needs macOS, because `.dmg` packaging does.

## what changed for you since 1.9.0

**A startup crash, fixed.** `packages/core/platform/darwin.js` exports
`displayPicker: null`, because the window-rule engine behind it is a KWin feature
that has no counterpart here. The Manager read it unguarded and then called
`.configure()` and `.isSupported()` on the result. The file's own comment already
recorded that a missing null check on exactly this "was an instant crash on this
host once already". The guard existed on the `mac` branch and had never come back
to `main`. It is on `main` now, so any Mac build before 1.13.1 dies at startup.

The two sibling properties that are also null here, `omarchy` and `omarchyTheme`,
were audited at the same time. Both were already guarded correctly.

**The rename.** The app is Clarity everywhere: `Clarity.icns`, `Clarity.dmg`,
`Clarity-arm64.zip`, appId `io.github.fromchaoscomesclarity.clarity`, and the data
paths under `~/Library/Application Support/clarity-installer`.

**A new icon**, an aperture, drawn as a real ICNS container with eight PNG chunks
from `ic11` through `ic10`. Worth knowing because ImageMagick will hand you a plain
PNG with an `.icns` extension and macOS will not read it.

**The lockfile** had drifted to 1.9.3 while `package.json` moved on. Both say
1.13.1 now.

## the branch

`mac` and `main` carry the same tree. The two commits `mac` had that `main` did not
are both on `main`: the null guard, and the lockfile sync. Pull either.

## build it

```bash
git checkout main && git pull
npm install
npm run dist:mac          # dmg + zip, arm64, unsigned
```

`predist` fetches the helper binaries from the `binaries-mac-v2` release. That
asset was renamed during the rebrand, and the URL and its SHA256 pin in
`scripts/fetch-binaries.mjs` have been checked from here: the download resolves and
the hash matches, so the fetch will not stall.

## check it before publishing

The one that matters, because it is the bug this release exists to fix:

1. **It starts.** Launch the Manager. Before 1.13.1 it crashed here immediately.
2. **The display picker is absent, not broken.** Control Panel should show no
   game-display option rather than an error.
3. **Both faces open.** Manager, and `--couch`.
4. **Steam and GOG sign in.** Epic still does not hold on macOS, which is known and
   documented in `docs/macos-guide.md`, not a regression.
5. **The icon is the aperture** in the Dock and in Finder, not a generic document.

## publish it

```bash
gh release create v1.13.1-mac dist/Clarity.dmg dist/Clarity-arm64.zip \
  --repo FromChaosComesClarity/Clarity \
  --title "Clarity 1.13.1 (macOS)" \
  --notes-file docs/mac-release-notes.md \
  --prerelease
```

Or attach both files to the existing `v1.13.1` release instead, if you would rather
the two hosts share one tag:

```bash
gh release upload v1.13.1 dist/Clarity.dmg dist/Clarity-arm64.zip \
  --repo FromChaosComesClarity/Clarity
```

The second is tidier and it is what `docs/macos-guide.md` already implies by
pointing at a single release per version. The first is honest about the two hosts
not always shipping on the same day, which has been true for every release so far.
Your call; the guide will need its version line updated either way.

## still true, still not fixed

- **The build is unsigned.** No Apple Developer account behind it, so a first launch
  needs the right-click Open, or `xattr -dr com.apple.quarantine`. The guide covers
  it.
- **Epic sign-in does not hold.** The browser approval completes but the credentials
  are not written where `legendary` looks for them, so the sync comes back empty.
- **BattlEye and EAC are not wired up.**
- **The recipe catalogue** (Ironwail, GZDoom, the Build-engine games) is Linux only.
