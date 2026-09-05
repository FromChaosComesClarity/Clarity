Clarity 1.1.1

A maintenance release: two playlist lists that quietly hid their contents, and a new default look.

## Fixes

**"Add to Playlist" now scrolls.** The picker was capped at a fixed height, but a stray `overflow:hidden` on the same element cancelled its own scrolling, so if you had more than about seven playlists, the rest were simply clipped off the bottom with no way to reach them. It scrolls properly now, and the cap adapts to the window height so the *Add Selected* / *Close* buttons never get pushed off screen.

**The Playlists menu scrolls too.** The topnav/split Playlists modal had no height limit at all and would grow past the bottom of the screen on a long list. Same treatment.

## Changes

**Corner Style now defaults to Sharp.** New installs get the flat, sharp-cornered look out of the box. If you have explicitly chosen *Round* in Control Panel → Appearance, that choice is kept, and the toggle is right where it always was.

Everything else from 1.1 is unchanged, same database, same 92 themes, same three faces, same `--game=<id>` deep-links.

## Install

1. Download `Clarity.AppImage` below
2. `chmod +x Clarity.AppImage`
3. Run it

Upgrading from 1.1.0 or 1.0.0? Just replace the AppImage. Your `GameManagerConfig` folder, your entire library, is untouched.

```sh
./Clarity.AppImage            # The Manager, the desktop library hub
./Clarity.AppImage --couch    # Couch, fullscreen, gamepad-first
./Clarity.AppImage installer    # Installer, the GOG/Epic engine
```

## Notes

- Linux only. The suite ships as a single AppImage; there are no Windows or macOS builds.
- The About dialog now reads 1.1.1.

## Spread the good vibes

If Clarity got your gaming life together, consider sending a little support my way. It keeps the good vibes flowing. *"From Chaos Comes Clarity."*

- **Ko-fi (Intl):** https://ko-fi.com/clarity
- **PIX (Brazil):** `b734a9e2-e479-42f9-abd6-c88d1b8b880e`

Built by J.R.A. · GPL-3.0-or-later
