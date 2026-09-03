Clarity 1.9.2

GOG installs were broken on every Linux distribution except Fedora's family — in every release so far. That is fixed, along with a library that lied about what was installed. Omarchy gets first-class support.

## The fix that matters

**Installing a GOG game failed on Arch, Debian, Ubuntu, openSUSE and Alpine.** Every title, immediately, in every version of this app that has shipped. The error said the install failed and nothing more, so the account, the token, the network and the store all looked like suspects — and all of them were fine.

The downloader is a frozen Python binary, and the copy of `requests` inside it resolves its list of trusted certificates from wherever that file lived on the machine it was *built* on. These builds are made on Fedora, where it lives under `/etc/pki`. No other distribution puts it there, so the very first secure connection died before it was made. The app now finds the certificate bundle this machine actually has and hands it to the downloader.

If GOG downloads have never worked for you, this is why.

## Your library tells the truth about what is installed

**A library carried to another machine claimed nearly everything was installed.** Restore a backup on a second computer and games showed a Play button for files that were not there. On a real 923-game library the count was 292 — on a machine with four games actually installed.

Only games launched by a direct file path were ever checked. Everything else — PICO-8 carts, Flatpak apps, GOG and Epic titles, source ports and mods, Steam, itch.io — was taken at its word. All of them are now checked against something local: the cart on disk, the Flatpak that is installed, the store's own record, the app that owns the game. A game on an unplugged external drive is not deleted from your library and comes back on its own when the drive returns.

**The Installed filter and the Play buttons now agree.** They were asking different questions, so the filter could list a game whose own cover said Install.

**Installing a source port could put it somewhere it would never be found again.** If the install folder was written with a `~` shortcut, the unpacking took that literally and created a folder actually named `~`. The install reported success — it had written every file — and the game then refused to start, naming a path where nothing was. Existing installs are unaffected; new ones land where they should.

**A game installed from inside the app now says Play immediately**, instead of waiting for the window to lose and regain focus.

## Omarchy

The suite now recognises [Omarchy](https://omarchy.org/) and settles into it.

- **It wears your Omarchy theme** — your actual palette, read from the theme you have set, not a lookalike chosen from the app's own 93. Change your theme and the app follows, without a restart.
- **It tells you what is missing.** Omarchy ships as a developer desktop, so a fresh install has almost none of the gaming stack. The app checks what it needs, explains what each thing is for, and installs it — through a terminal you can watch, never a hidden password prompt. Where Omarchy has its own installer, that one is used: its Steam installer also sets up the graphics drivers chosen for your card.
- **Windows that behave.** Installer, sign-in windows and games open floating instead of being tiled into whatever slot is free a moment before they go fullscreen.
- **The screen will not lock mid-game**, and the power profile switches for the session and is put back afterwards.
- **Compact window chrome** — the title bar goes and its buttons move into the side rail, since a tiling compositor already owns the window controls.
- **A system-tuning report**: the kernel settings a gaming distribution changes, what each costs when it is wrong, and the command to fix it. It reports; it does not touch them.

## Everything else

- **The interface fits smaller screens.** A first run picks a scale that fits, the layout adapts as a window narrows, and a saved scale that came from another machine is re-derived for the screen actually in front of you.
- **The side rail can no longer clip its own buttons.** On a short window the lower ones — including the Control Panel — could be cut off with no way to reach them, which put the setting that fixes an oversized interface behind the problem it fixes. `Ctrl` `+` / `-` / `0` also changes the scale from anywhere.
- **The app opens in its finished shape** rather than visibly rearranging itself for a second or two after the window appears.
- **A game that crashes in the graphics layer says so**, instead of reporting that it closed immediately.
- **"All Games" has its own icon** — it was using the same house as the Home dashboard.
- **The macOS notes are accurate again.** Epic sign-in does not work there yet and no longer claims to; Windows games through CrossOver do.

## Install

**Linux:**
1. Download `Clarity.AppImage` below
2. `chmod +x Clarity.AppImage`
3. Run it

**macOS:** this release is Linux-only. The [1.9.0 `.dmg`](https://github.com/FromChaosComesClarity/Clarity/releases/tag/v1.9.0) remains the current macOS build, with Windows-game support through CrossOver. See the [macOS guide](docs/macos-guide.md).

Upgrading from any 1.x? Just replace the AppImage. Your library, artwork, playlists and settings are untouched — and on first start the app will correct install states that were carried over from another machine.
