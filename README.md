<div align="center">

# Clarity

### *the game manager for Omarchy*

![version](https://img.shields.io/github/v/release/FromChaosComesClarity/Clarity?label=version&color=2fe0d6&style=flat-square)
![status](https://img.shields.io/badge/status-Experimental-ff5fa2?style=flat-square)
![platform](https://img.shields.io/badge/platform-Linux-0e1113?style=flat-square)
![license](https://img.shields.io/badge/license-GPL--3.0-2fe0d6?style=flat-square)

</div>

Every game you own, Steam, GOG, Epic, itch, PICO-8, emulators, fan games, source ports and
mods, in one place. One AppImage, four faces, no cloud, no launcher farm.

### **[What it does, in full, is on the website.](https://fromchaoscomesclarity.github.io/ClarityWebSite/)**

Experimental, used daily on the machine it is built on, still rough in places. Linux edition;
macOS is a deliberate fork in [Clarity-Mac](https://github.com/FromChaosComesClarity/Clarity-Mac).

## Install and run

Download `Clarity.AppImage` from [Releases](https://github.com/FromChaosComesClarity/Clarity/releases),
make it executable, pick a face.

```bash
chmod +x Clarity.AppImage

./Clarity.AppImage              # the Manager, at a desk
./Clarity.AppImage --couch      # Couch, fullscreen for a modern TV
./Clarity.AppImage --crt        # the CRT face, for a tube TV
```

No runtime to install, and no install at all: your library, artwork and settings sit in a folder
beside the AppImage, so copying that folder backs it up and deleting it is the uninstall.

## The four faces

| | | |
|---|---|---|
| **Manager** | the desk | Import, organise, scrape, install, launch. Mouse and keyboard. |
| **Couch** | the sofa | Fullscreen, gamepad-first, for a television across a room. |
| **CRT** | the tube | A menu for 720x480 over composite, driven by a D-pad. |
| **Installer** | underneath | Installs GOG and Epic games headlessly, with no store client. |

**The CRT face** exists because Couch cannot work on one: Couch is built around cover art, and
at 480 interlaced lines a cover is a thumb wide and smears. So this is a menu, where a row of
text is the interface and a D-pad is the whole vocabulary. Installing, scraping, playlists,
compatibility and playing all happen there, without the desktop.
[Longer story on the site.](https://fromchaoscomesclarity.github.io/ClarityWebSite/news.html#crt-face)

## On Omarchy

A [companion plugin](https://github.com/FromChaosComesClarity/omarchy-clarity) adds a bar widget
and a launcher overlay: type a few letters, press Enter, play. Clarity reads your real Omarchy
theme and opens games fullscreen on the screen you picked.

## Build it

```bash
npm install
npm run dist        # -> dist/Clarity.AppImage
```

Needs Node 22.

## Documentation

The manual ships **inside the app**, under Menu &rarr; Manual. The rest is on the website:
[game fixes](https://fromchaoscomesclarity.github.io/ClarityWebSite/fixes.html),
[ports and mods](https://fromchaoscomesclarity.github.io/ClarityWebSite/ports.html),
[what changed](https://fromchaoscomesclarity.github.io/ClarityWebSite/news.html). Contributor
notes are in [`docs/`](docs/), including [`docs/RECIPES.md`](docs/RECIPES.md) on per-game fixes.

## Support it

**Ko-fi:** <https://ko-fi.com/clarity> · **PIX (Brazil):** `b734a9e2-e479-42f9-abd6-c88d1b8b880e`

Starring the repo and reporting what breaks counts too.

---

<div align="center">

**one library · four faces · zero cloud**

Built by J.R.A. · GPL-3.0-or-later

</div>
