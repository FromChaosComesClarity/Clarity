Clarity 1.3.0

Windows games that quietly refused to start now start — and when something genuinely can't work, the app finally says so instead of leaving you staring at a library that did nothing.

## Fixes

**Windows games no longer fail in silence.** Pressing Play on a GOG or Epic Windows game could do absolutely nothing: no window, no error, no hint. Underneath, the compatibility layer was exiting after about a second because no Proton had been handed to it, and the app cheerfully reported success.

Two things were wrong. Clarity never looked on disk for Proton — it only used one you had set by hand — and the tool it launches games with can only find Proton in folders named exactly `GE-Proton…` or `UMU-Proton…`. Install Proton-GE with ProtonUp-Qt and you get a folder called **`Proton-GE Latest`**, which is invisible to it. A perfectly good Proton, sitting right there, unusable.

The app now finds Proton itself, wherever it lives and whatever the folder is called, and always hands it over explicitly. It reads the real build name from inside the folder rather than trusting the folder name, ignores Steam's runtime folders (which are not Proton and were being mistaken for it), and checks that a Proton you configured earlier still exists before trying to use it.

**If a game dies on startup, you get told.** Every launch is now recorded, and a game that quits immediately raises a dialog explaining what happened, with the technical details one click away if you want them. No Proton installed is recognised by name — see below.

**The window opens at a sensible size again.** On a multi-monitor setup the app could open as a 600×440 postage stamp. It was sizing itself against whichever screen the system happened to name "primary", which on a multi-screen desk is often the smallest one — and the screen list itself turned out to be unreliable, sometimes reporting a single monitor when three were connected. The app now picks the screen your window was last on, or the largest one, and refuses to shrink itself to fit a screen size it doesn't trust.

**"Change…" in the install dialog does something now.** The button that lets you choose where a game installs was silently broken and never opened the folder picker.

## New

**Proton, installed for you.** When a Windows game needs Proton and you don't have one, the app offers to fetch the latest GE-Proton — a single click, with a progress bar, roughly a 400 MB one-time download that every Windows game then shares. If you already have Proton builds, it lists them and lets you pick which one to use instead.

**Game Install Folder** (Control Panel → Library). Where GOG and Epic downloads go, now visible and changeable in one place, defaulting to `~/Games/Clarity`. You can still choose a different folder for any single game while installing it, and games installed under your previous folder stay removable after you change it.

**You can see what a slow launch is doing.** The first Windows game on a new machine takes a few minutes to appear: a one-time runtime download, then building that game's Windows environment. That used to be a blank screen indistinguishable from a crash. Now the Now Playing card — and Couch's game screen on the TV — shows what stage it's at, with the download counting up in megabytes. Launches that are already set up show nothing at all, as before.

## Install

1. Download `Clarity.AppImage` below
2. `chmod +x Clarity.AppImage`
3. Run it

Upgrading from any 1.x? Just replace the AppImage. Your `GameManagerConfig` folder — your entire library — is untouched.
