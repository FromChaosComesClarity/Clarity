# Clarity 1.10.0, "At home on Omarchy"

**Experimental, Linux only.** The 1.9.0 `.dmg` remains the current macOS build.

Phase 2 of the Omarchy work. Phase 1 made the app *behave* correctly on a tiling Wayland
desktop; this one makes it smaller and more obvious. **12,196 lines removed, 1,438 added.**

---

## One layout instead of twenty-four

The icon side rail is now the only layout. The TTY family (htop, ranger, BBS, vi, adventure,
Midnight Commander, NetHack, GRUB), the OS pastiches (Mac OS 1.0, Windows XP, Mandrake/KDE,
C64, Amiga, BeOS, Windows 95, NeXTSTEP), the flat family (Catalog, Newspaper, Timeline,
Kanban), the split pane, Commander, the labelled sidebar and the top nav are all gone, along
with the floating FLATGAMEPAGE overlay.

⚠️ **None of them could be reached in a shipped build.** Startup always applied the rail and
ignored your saved layout, and the picker sat behind `display:none`. They were roughly 9,000
lines of renderer and CSS that could never execute. If you had one saved, it migrates to the
rail once and never asks again.

**The 93 themes are untouched.** They cost 107 lines of colour tokens between them, they are
the app's personality, and the Omarchy palette bridge maps into that same table.

## Settings are pages now

Two new ones, **Ports & Mods** and **Desktop**, joining Library, Appearance, Behavior,
Connections, System and Danger Zone.

⚠️ Seven of the twenty settings cards were never filed into a page, and because a hidden pane
hides the *pane* rather than the cards outside it, those seven rendered on top of **every**
page at once. That is why the panel read as one long list. Fixed, and a card that escapes the
map now reports itself instead of failing quietly.

The settings search is gone. A search box over your own settings was the tell that the
settings had no shape.

## Installer has no window

Everything its window did now lives in the Manager:

- **Compatibility** (per game), Proton/runtime, Wine prefix, launch arguments, custom
  executable, environment variables, winetricks verbs, Esync/Fsync/DXVK-NVAPI/BattlEye/EAC,
  notes, and the GOG launch-target selector for titles with several play tasks.
- **Manage Storage**, installed games by size on disk, biggest first, with a total.
- **Refresh GOG / Epic** now syncs in place instead of opening a second window.

⚠️ `installer://launch/…` and the `installer` CLI are unchanged. Headless means no window, not no
entry point, every installed game's launch command depends on that scheme.

## First boot reads the machine before it asks anything

The welcome screen opens with **What This Machine Has**, measured when it opens: which gaming
tools are present (with one click to install exactly the missing ones), whether GOG and Epic
are connected and under which account, and whether your Steam credentials are already saved,
in which case the fields come pre-filled.

## Two things only this desktop needed

- **Ctrl+K** opens a command palette over your games *and* the app's actions. Type `kcd`, get
  Kingdom Come: Deliverance. Enter opens a game's page rather than launching it, because a
  fuzzy match is too easy to hit by accident for something that starts a process.
- **"Which screen games open on" works on Hyprland.** It previously existed only as a KDE
  script and was removed on Omarchy. A rotated monitor is listed by its *rotated* size, so a
  portrait panel reads as 900x1440 rather than pretending to be landscape.

---

## Fixes

- **Themes that declare `selection` no longer wash the library out.** On the Crimson Omarchy
  theme every list row rendered as a 62%-white sheet with light-grey text on it: the floating
  panel colour was being taken from `selection`, which is a text-highlight colour and is often
  pure white. Surfaces are now validated against the page they sit on.
- **"Open in Steam" only appears for games you own on Steam.** The scrapers attach a Steam id
  to anything they can match by name, so GOG-only titles were offering it, 224 of them in one
  library. The same bug made "Uninstall via Steam" appear for games Steam never installed.
- **The interface scale is 100% for everyone.** It used to derive a scale per screen and pick
  75% for anything it judged small, including a monitor rotated to portrait, so one install
  disagreed with itself across two displays. It is a plain default now and yours to change;
  a scale you pick is kept. Existing installs are reset once, because almost none of those
  saved values were ever a choice.
- Two crashes' worth of dead controls removed: buttons whose only job was opening a window
  that no longer exists.

---

## Notes

- **Experimental**, and Linux only. macOS stays on the 1.9.0 `.dmg`.
- Built on Omarchy 4 and verified by running it: every wave was packaged into the AppImage and
  launched before being committed.
- If you had a layout, a scale, or a Installer window habit, those are the three things that
  will feel different.
