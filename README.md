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

### **[More info on the website.](https://fromchaoscomesclarity.github.io/ClarityWebSite/)**

Experimental. I use it every day on my own machine and it is still rough in places. This is the
Linux version, there is a Mac fork
[here](https://github.com/FromChaosComesClarity/Clarity-Mac).

## Install and run

Grab `Clarity.AppImage` from [Releases](https://github.com/FromChaosComesClarity/Clarity/releases),
make it executable, pick a face.

```bash
chmod +x Clarity.AppImage

./Clarity.AppImage              # the Manager, at a desk
./Clarity.AppImage --couch      # Couch, fullscreen on a modern TV
./Clarity.AppImage --crt        # the CRT face, on a tube TV
```

Nothing to install. Your library, artwork and settings go in a folder next to the AppImage.
Copy that folder to back it up, delete it to uninstall.

## The four faces

| | | |
|---|---|---|
| **Manager** | the desk | Import, organise, scrape, install, launch. Mouse and keyboard. |
| **Couch** | the sofa | Fullscreen, gamepad first, for a TV across the room. |
| **CRT** | the tube | A menu for 720x480 over composite, driven with a D-pad. |
| **Installer** | underneath | Installs GOG and Epic games on its own, no store client. |

**The CRT face** is for an actual tube TV. Couch Mode is built around cover art and a CRT has
nowhere to put it, a cover ends up about a thumb wide and smeared. So this one is just a menu:
up and down move, one button goes in, one goes back. You can install, scrape, make playlists,
set compatibility and play from it without going back to the desk.
[More about it here.](https://fromchaoscomesclarity.github.io/ClarityWebSite/news.html#crt-face)

## On Omarchy

There is a [plugin](https://github.com/FromChaosComesClarity/omarchy-clarity) too: a bar widget,
and a launcher overlay where you type a few letters and press Enter. Clarity picks up your
Omarchy theme and opens games fullscreen on the screen you chose.

## Build it

```bash
npm install
npm run dist        # -> dist/Clarity.AppImage
```

Needs Node 22.

## Docs

The manual is in the app, under Menu &rarr; Manual. Everything else is on the website:
[game fixes](https://fromchaoscomesclarity.github.io/ClarityWebSite/fixes.html),
[ports and mods](https://fromchaoscomesclarity.github.io/ClarityWebSite/ports.html),
[what changed](https://fromchaoscomesclarity.github.io/ClarityWebSite/news.html). Notes for
anyone poking at the code are in [`docs/`](docs/), and
[`docs/RECIPES.md`](docs/RECIPES.md) covers how per-game fixes work.

## Support it

**Ko-fi:** <https://ko-fi.com/clarity> · **PIX (Brazil):** `b734a9e2-e479-42f9-abd6-c88d1b8b880e`

Starring the repo and reporting what breaks counts too.

---

<div align="center">

**one library · four faces · zero cloud**

Built by J.R.A. · GPL-3.0-or-later

</div>
