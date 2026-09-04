# Launch posts, drafts

Untracked working file. Not committed; delete or keep as you like.

Post the **screenshots** natively wherever possible (Reddit image posts, Mastodon media)
rather than a bare GitHub link, link-only posts get far less reach.

---

## r/linux_gaming, the open letter (USE THIS ONE)

**Title:** Clarity, a Linux game manager that puts GOG, Epic, Steam, emulators and source ports on one shelf, plus a gamepad TV mode

**Body:**

Hello everyone!

I've been building and using this for about a year and it's finally at the point where I'm
comfortable showing it. It's a very personal project, built little by little to solve my own
problems and add the features I wanted. But if it's good for me it may be good for someone
else too, so here it goes.

**First, the thing you should know going in:** Clarity is built with heavy AI assistance
(Claude). The design is mine, every feature, every screen, every decision about how the thing
should behave. I spec it, I direct it, I debug it, and I test every build on my own machine
before it ships. But the code itself is written by AI, and you should know that before you
download anything.

Now, what it actually is.

**One AppImage, three faces, one database:**

- **The Manager**, your library on the desktop
- **Installer**, the GOG/Epic download and install engine, running in-process
- **Couch**, fullscreen, gamepad-driven, made for a TV

Favourite a game on the couch and it's favourited on the desktop. Same library, same saves,
same everything.

**What it does:**

- Steam, GOG, Epic, Flatpak, itch.io, PICO-8, emulators, source ports, mods, custom engines and
  vintage CD games, all on one shelf. Anything that launches from a command line can live in it.
- GOG and Epic sign-in happens inside the app, download, install, update. No browser dance, no
  second launcher sitting in the background.
- It fixes games that don't otherwise work: GOG's DOS games, a growing list of individual titles
  with their own quirks, and Proton found wherever ProtonUp-Qt actually put it rather than only
  in the folder names umu-run expects.
- Covers, artwork, descriptions, HowLongToBeat, Metacritic and ProtonDB tiers, scraped once and
  stored **locally**, so nothing rots when a storefront changes its API.
- Source ports, fan games and mods installed from your own downloads, with the data files linked
  automatically from the copy already in your library.
- Save-game backup and restore, as portable ZIPs.
- 93 themes, including twenty retro-OS palettes each with the typeface of its era. I wanted it to
  look good, and that turned into a hobby of its own.
- On KDE, you can pick which monitor a game opens on.
- No account, no telemetry, no cloud. Everything lives in a folder next to the AppImage.

**"Why not Heroic or Lutris?"** Fair question, and honestly, use them, they're great. Heroic in
particular is excellent, and Clarity ships the same underlying downloaders it does, gogdl
and legendary, which I owe its authors a great deal for. I built this because I wanted one place
for *everything*: the store games and the emulators and the source ports and the weird CD-ROM
stuff from 1997, plus a gamepad mode for the TV, and I kept bouncing between three applications
to get it. If your library is mostly store games you're already well served. If your library is a
mess like mine, this might suit you.

**Practical things:**

- It's Electron. Yes, really. The AppImage is about 274 MB. That's the trade I made to ship one
  binary that just runs.
- Tested on Nobara 44, KDE Plasma, Wayland, on exactly one machine with one GPU. That is the
  entire test lab.
- GPL-3.0.

**About me:** I'm 47, married, two children, and a full-time job that has nothing to do with
software development. I'm also a musician and producer. This is what I do in the evenings.

Downloads and source: https://github.com/FromChaosComesClarity/Clarity

Happy to answer anything. Bug reports very welcome, I'm one person and I only have my own
hardware to test on.

Cheers,
JRA

---

## r/linux_gaming, shorter alternative (earlier draft)

**Title:** Clarity, one app for your GOG, Epic, Steam and emulator library, with a gamepad-first TV mode

**Body:**

I've been building this for about a year and it's finally at the point where I'm comfortable showing it.

Clarity is a Linux game library manager. One AppImage, three faces:

- **The Manager**, windowed library hub for the desktop
- **Installer**, the GOG/Epic download and install engine, in-process
- **Couch**, fullscreen, gamepad-driven, meant for a TV

All three share one database, so favouriting a game on the couch favourites it on the desktop.

What it does that I couldn't get elsewhere in one place:

- Steam, GOG, Epic, Flatpak, itch.io, PICO-8 and emulators in a single shelf. GOG and Epic sign in inside the app, no browser dance, no second launcher running.
- Artwork, descriptions, HowLongToBeat, Metacritic and ProtonDB tiers scraped once and stored **locally**, so nothing rots when a storefront changes its API.
- Finds Proton wherever it lives regardless of folder name, and tells you when a game dies on startup instead of silently doing nothing.
- Save-game backup/restore as portable ZIPs with a manifest.
- 93 themes, including twenty retro-OS palettes each with its era typeface.
- Everything lives in a folder next to the AppImage. No account, no telemetry, no cloud.

It's GPL-3.0. Downloads and source: https://github.com/FromChaosComesClarity/Clarity

Happy to answer anything. Bug reports very welcome, I'm one person and I only have my own hardware to test on.

---

**Disclosure to include** (see the AI note below, put this in the post body, not a comment):

> Built with heavy AI assistance (Claude). Every feature is tested on my own machine before it ships, but you should know that going in.

---

## Show HN

**Title:** Show HN: Clarity – A Linux game library manager with a gamepad TV mode

**Body:**

One AppImage that manages a Linux game library across GOG, Epic, Steam, Flatpak, itch.io and emulators, and ships three interfaces over one SQLite database: a desktop manager, an install/launch engine for GOG and Epic, and a fullscreen gamepad interface for a TV.

The parts I found most interesting to build:

- **Proton discovery.** umu-run only auto-detects Proton in folders literally named `GE-Proton*` or `UMU-Proton*`. ProtonUp-Qt installs to `Proton-GE Latest`, which is invisible to it, so a perfectly good Proton sits there unusable and the game dies in about a second with no output. The app now scans for Proton itself and reads the real build name from inside the folder rather than trusting the folder name.
- **GOG's second manifest.** GOG ships `goggame-<id>.info` (how to launch) and `goggame-<id>.script` (what the Galaxy installer does afterwards, registry keys, config files). Downloaders read the first and ignore the second, so some games install perfectly and then fail in ways that look nothing like a packaging bug.
- **Everything is local.** Artwork and metadata are scraped once and stored on disk. No account, no telemetry.

GPL-3.0: https://github.com/FromChaosComesClarity/Clarity

---

## GamingOnLinux tip

Short and factual, they get a lot of these.

> Hi Liam,
>
> I've released Clarity, a GPL-3.0 Linux game library manager. It's a single AppImage
> with three interfaces over one database: a desktop library manager, a built-in GOG/Epic
> install engine, and a fullscreen gamepad mode for playing on a TV. It handles Steam, GOG,
> Epic, Flatpak, itch.io, PICO-8 and emulators, scrapes artwork and metadata locally, finds
> Proton regardless of what the folder is called, and does save-game backup/restore.
>
> Repo and downloads: https://github.com/FromChaosComesClarity/Clarity
> Screenshots are in the README.
>
> Thanks for everything you do for Linux gaming.
>, Jose

---

## Mastodon / Bluesky

> Clarity 1.7.0 is out, a Linux game library manager that puts GOG, Epic, Steam,
> itch.io and emulators on one shelf, and adds a gamepad-first fullscreen mode for the TV.
>
> Local artwork, no account, no telemetry. One AppImage. GPL-3.0.
>
> https://github.com/FromChaosComesClarity/Clarity
>
> #Linux #LinuxGaming #FOSS #OpenSource

---

## Before you post

- [ ] **Fix the README first**, the post sends everyone there. Badge says 1.6.0, the ASCII block
      says 1.3, `package.json` says 1.7.0.
- [ ] **Get more screenshots.** `docs/screenshots/` has two. Want six to eight: Manager library,
      Couch on the TV, a gamepage, the dashboard, two or three contrasting themes.
- [ ] Read each community's self-promotion rules; some want a flair or a specific day.
- [ ] Post images natively, not as links.
- [ ] Be around for the first few hours to answer replies, that's most of what drives reach.
- [ ] Expect "why not just use Heroic/Lutris/Playnite?" Have a one-line answer ready: those
      don't give you one shelf across every store *plus* a gamepad TV mode over the same database.
