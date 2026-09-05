Clarity 1.2.0

Updates, the game kind and the app kind, plus a per-game desktop shortcut, and a fix for games you own on more than one store.

## New

**Scan for Updates** (Control Panel → Library). Checks the games you have installed and hands you a list; nothing downloads on its own.

- **GOG and Epic** are checked for real against the store, showing *installed version → latest version*. **Update** re-runs the normal install, so it lands in the Download Manager like any other download.
- **Steam** is flagged only. Clarity reads Steam's own local files to see that an update is waiting and offers **Open in Steam**. It can't query Valve's servers, so it never pretends to update Steam games itself.
- The GOG side is checked one game at a time (its tooling isn't safe to ask in parallel), with a progress bar. "Everything is up to date" is a perfectly good result.

**Add to Desktop** (gamepage). Writes a proper `.desktop` launcher for a single game, with the game's own artwork as the icon, that opens straight into it through the suite. You're asked each time whether it goes in the app menu, on the desktop, or both.

**Your version, on the way in.** The Control Panel's opening splash now shows the version you're running, next to a **Check for Updates** button that opens the releases page in your browser. That is the entire mechanism: no auto-updater, no background check, no phone-home. Compare, read what changed, and download it yourself if you want it.

## Fixes

**Games owned on more than one store now know they're installed.** A library row can front several stores at once, *Grim Dawn* on Steam and GOG, say, but every install check only ever looked at the primary launcher. A game installed on Steam but fronted by GOG read as *not installed*: Play was hidden, and the fallback offered an impossible GOG install for a game you only owned on Steam.

Install state is now OR'd across every launcher on the row (Steam via its appmanifest, GOG/Epic via Installer's database), and Refresh Library, the boot reconcile and the install watcher no longer undo each other. Pressing Play on such a game opens a **store-aware picker**: the copies already on disk offer *Play*, the others offer to install first, instead of failing silently.

## Install

1. Download `Clarity.AppImage` below
2. `chmod +x Clarity.AppImage`
3. Run it

Upgrading from any 1.x? Just replace the AppImage. Your `GameManagerConfig` folder, your entire library, is untouched.

```sh
./Clarity.AppImage            # The Manager, the desktop library hub
./Clarity.AppImage --couch    # Couch, fullscreen, gamepad-first
./Clarity.AppImage installer    # Installer, the GOG/Epic engine
```

## Notes

- Linux only. The suite ships as a single AppImage; there are no Windows or macOS builds.
- Scan for Updates and Add to Desktop are desktop-face features (The Manager); Couch is unchanged.
- The in-app manual covers both in section 6 and section 11, and the About dialog now reads 1.2.0.

## Spread the good vibes

If Clarity got your gaming life together, consider sending a little support my way. It keeps the good vibes flowing. *"From Chaos Comes Clarity."*

- **Ko-fi (Intl):** https://ko-fi.com/clarity
- **PIX (Brazil):** `b734a9e2-e479-42f9-abd6-c88d1b8b880e`

Built by J.R.A. · GPL-3.0-or-later
