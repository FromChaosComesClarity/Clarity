# Clarity on Omarchy

**A running list of everything the suite does specifically for [Omarchy](https://omarchy.org/).**
This file is the source for anything shown to Omarchy users — a forum post, a release note, a
page on the site. Add to it whenever an Omarchy-specific feature lands; keep it honest about
what is implemented versus planned.

Omarchy is **not a separate build**. `host.id` is `linux` and it runs the exact same
`packages/core/platform/linux.js` as any other Linux host. Everything below is a *desktop-level*
integration that switches itself on when Omarchy is detected and is invisible everywhere else —
the same shape as the KDE display picker, which does the reverse.

**Where the code lives:** `packages/core/omarchy.js` and `packages/core/omarchy-theme.js`. Both
import node builtins only and nothing from the rest of the suite, so they can be copied into
EmuLatte unchanged.

---

## Shipped

### 1. It knows it is on Omarchy

Reads `/etc/os-release`, so `ID=omarchy` is detected properly rather than being lumped in with
generic Arch. Version, Hyprland presence and the compositor's own version are all reported.

Two questions are kept deliberately separate:

- **`isOmarchy()`** — gates the things only Omarchy has (`omarchy pkg`, `omarchy install gaming`,
  the theme bridge).
- **`isHyprland()`** — gates window-management behaviour, and is true for anyone running Hyprland
  on plain Arch too. Those users get the Hyprland behaviour without being told they are on Omarchy.

> ⚠️ `ID_LIKE=arch` is what makes the existing pacman hints elsewhere in the app fire correctly.
> `isArchLike()` exists so nothing depends on `ID` alone if a future release drops `ID_LIKE`.

### 2. Clarity wears your Omarchy theme

**The app applies your actual Omarchy theme — not the closest-looking one of its own 93.**

Omarchy declares its palette in `colors.toml` per theme, in named roles (`background`,
`foreground`, `accent`, …). The suite's themes have the same shape, so the palette is read and
mapped directly into a live theme. Switch themes with `omarchy theme set` and the app follows
within a moment — no restart, and nothing written to your system.

Read from `~/.local/state/omarchy/current/theme/colors.toml`, which is the *materialised* current
theme. That one path sidesteps resolving display names against slugs and stock themes against
user overlays.

> ⚠️ **Only three roles are guaranteed.** Measured across all 46 themes on a real Omarchy 4 box:
> `accent`, `background` and `foreground` appear in all 37 that ship a `colors.toml`; the richer
> roles appear in 23–24, and `mode` in 24. So declared roles are preferred and everything else is
> *derived* — an early version that just fell back through a preference chain collapsed every text
> tier into one colour and made menus invisible on minimal themes.
>
> Validated across all 46: **37 generate a clean theme, 0 failures**, lowest text-on-background
> contrast 6.66:1. The 9 with no `colors.toml` report unavailable rather than half-working.
>
> Two edge cases worth keeping: a theme whose `dark_background` equals its `background`
> (tokyoled) is treated as not having declared one, and a pure-black background derives its menu
> layer *lighter*, since darkening `#000000` goes nowhere.

Light themes (catppuccin-latte, flexoki-light) work without inverting anything — the role names
mean the same thing, and only the size of the step between layers changes.

**How it gets applied.** On a fresh install on Omarchy it is simply the default — the app comes up
already matching the desktop. For anyone who has run Clarity before there is a one-click
**Match My Omarchy Theme** button in the Omarchy card, and the theme also sits in the picker under
**Your Desktop**.

> ⚠️ The button is not a convenience, it is the only route for an existing user. `applyTheme()`
> writes `clarity_theme` on *every* call, including when it falls back to the built-in default — so
> "this user has never chosen a theme" stops being true after the very first launch in the app's
> history, and the fresh-install default can never fire for them. Overriding a theme somebody
> deliberately picked would be worse than asking, so adopting it is one button rather than a
> silent takeover.

**Couch follows too.** The couch face mirrors the Manager's theme by name when its theme source is
`MANAGER`, resolving it against its *own* theme table — so the palette is registered in both faces
and the IPC lives in `packages/core/shared-ipc.js` rather than the Manager's `main.js`.

> ⚠️ This is a correctness fix, not tidiness. A theme the Manager knows and Couch does not
> resolves to `null` in `mapManagerThemeToCouch()`, and the couch face silently drops back to its
> own default — so a user matching their desktop on one face would stop matching it on the other.

### 3. It tells you what a fresh Omarchy is missing for gaming

Omarchy is aimed at developers, so a clean install has almost none of the gaming stack. The suite
knows what it needs and what a gaming setup normally has, and reports the gap in three honest
tiers:

| Tier | Meaning |
|---|---|
| **Required** | Something in the app degrades without it, and the entry says exactly what. `umu-launcher`, a DOSBox. |
| **Optional** | Useful, not load-bearing. `wine`, `pipx`, `flatpak`, `wmctrl`. |
| **Extra** | Worth having for gaming, but the suite never calls it itself: `gamemode`, `mangohud`, `gamescope`, `winetricks`, `protontricks`. |

Every entry names the binary actually probed for, so nobody is told they need something the app
does not use. Alternates count — plain `dosbox` satisfies the DOSBox requirement, not just
`dosbox-staging`.

### 4. One-click install, through a terminal you can watch

Installing packages needs root. Rather than escalate privileges behind a GUI, the suite hands the
command to a terminal — `xdg-terminal-exec` where present, so it honours the terminal you actually
chose — and the window stays open afterwards so a failure is readable.

Repo and AUR packages become separate commands (`omarchy pkg add` / `omarchy pkg aur add`),
because mixing them produces a "target not found".

> ⚠️ **Nothing in this app ever runs `sudo` on your behalf.** You see the command, you type your
> own password, in a real terminal. This matches Omarchy's own guidance.

### 5. Omarchy's own installers, where Omarchy has one

For anything `omarchy install gaming …` covers, the suite defers to it rather than installing the
package itself — Omarchy's Steam installer also pulls the 32-bit graphics drivers selected for
*your* GPU, which is the step people miss and the reason a fresh Arch box runs Proton games badly
or not at all.

- **Steam** — detected, and if missing you are taken to `omarchy install gaming steam`. The Steam
  library is the largest part of most collections here and the suite reads it directly from disk,
  so this is surfaced prominently rather than as one item in a list.
- **32-bit graphics drivers** (`gpu-lib32`) — Proton needs the lib32 Vulkan stack.
- **Xbox controller support** — Couch is gamepad-first, so this is worth having for couch play.

> ⚠️ **Heroic and Lutris are deliberately never mentioned.** The suite signs in to GOG and Epic
> itself and runs Windows games through Proton directly. A second launcher is not a missing piece,
> and offering to install one would undercut the thing this app exists to do.

RetroArch is carried in the module but hidden in Clarity — emulation is EmuLatte's pillar,
and the flag exists so the EmuLatte port shows it while this app does not.

### 6. GOG downloads work on Arch at all

> ⚠️ **This was a total failure of GOG installs on every non-Fedora distribution, and nothing
> in the error pointed at the cause.**

`gogdl` is a frozen PyInstaller binary, and the `requests` inside it resolves its CA bundle from
the path baked in at *build* time. The suite's binaries are built on Fedora, so that path is
`/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem` — which does not exist on Arch, Debian,
openSUSE or Alpine. Every HTTPS call died before it was made:

```
OSError: Could not find a suitable TLS CA certificate bundle, invalid path:
         /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem
```

What the user saw was "the install failed" on **every GOG title**, with no mention of TLS anywhere —
and every obvious suspect (the account, the token, the network, the store, Installer itself) checking
out fine.

The host's real CA bundle is now located at startup and exported as `REQUESTS_CA_BUNDLE` and
`SSL_CERT_FILE` before any helper is spawned. Fedora is checked first, because on the host the
binaries were built for the baked-in path is already correct and there is nothing to override; a
value the user exported themselves is left alone.

Diagnosed and fixed on Omarchy 4 on 2026-08-25, and verified with a real download: B.I.O.T.A.
reached 100% (211.73 MiB) where it had previously failed instantly.

> ⚠️ This is **not Omarchy-specific** — it affects Arch, Debian, Ubuntu, openSUSE and Alpine users
> of every release so far. It is listed here because Omarchy is where it was found.

### 7. It behaves like a tiling-desktop app

- **Compact window chrome.** The title bar is gone and its buttons live in the side rail. Under a
  tiling WM you cannot drag a window and the compositor owns close/minimise/maximise, so that bar
  was 35px of nothing — which on a tiled window is a whole extra row of covers. Toggleable in the
  Omarchy card; on by default when Omarchy is detected.
- **Nothing in the rail can be out of reach.** The icon rail was `overflow: hidden`, so on a
  window shorter than its own contents the bottom buttons were clipped with no way to scroll to
  them — including the Control Panel button. On a 1152×720 laptop panel that made the setting
  which fixes an oversized interface unreachable *because* the interface was oversized.
- **Ctrl +/− /0 changes the interface scale** from anywhere, for the same reason: an escape hatch
  must not live behind the thing it rescues you from.
- **The interface scale fits the screen it is actually on.** A first run derives one instead of
  assuming 100%, and the screen it was chosen for is stamped alongside it — so a setting that
  arrived in a restored library from another machine is re-derived for the panel in front of you
  rather than inherited. Your own choice is stamped too, so it is never overridden afterwards.
- **It opens already in its final shape.** The settings that decide the app's *shape* — theme,
  compact chrome, interface scale, narrow/short layout — all live in the database, and reading
  them is an async round trip. Anything applied after that lands on a window you are already
  looking at, so the title bar used to render with its buttons and then visibly restructure
  itself about two seconds later. Those values are now mirrored into synchronous storage and
  applied before the first paint, with the database still correcting them if they disagree. A
  first run, with nothing cached yet, is covered by a synchronous Omarchy check in the preload.
- **The layout follows the tile.** Half of a 1440px screen is 720px and a third is 480px, so a
  narrow window is the normal case here rather than an exception. The filter row wraps, the game
  list narrows, and below 680px the split view drops its list and gives the width to the game.
  Driven by the window's own size, not the screen's — on a tiled desktop those are different
  numbers, which is why this is not a CSS media query.
- **Installer and sign-in windows float** instead of tiling. They are transient tools opened over
  the library, and tiling one halves what you were looking at.
- **Games open floating too.** Tiled, a game gets shoved into whatever slot the layout has free
  and resized to fit it — a moment before it goes fullscreen anyway, so the first thing you see
  of a game is it being squashed. Floating lets it open at the size it asked for, centred, and
  the only change you see is the one that was meant to happen. Toggleable in the Omarchy card.

  > ⚠️ Hyprland rules cannot be withdrawn once set for a session, so that toggle takes effect on
  > the next start — and the label says so rather than pretending it is live.
- **The app takes the desktop's corner radius**, not just its colours, whenever you are wearing
  your Omarchy palette. Omarchy defaults to square corners, and rounded cards on a square desktop
  read as foreign.

### 8. It reports the system tuning a gaming distro would have changed

A gaming-focused distribution sets a handful of kernel knobs a general-purpose one leaves alone.
Most of that gap **does not exist on Arch**: full Mesa and ffmpeg are already here, the kernel is
newer, and the fsync work that once justified a patched kernel is upstream. Measured on a real
Omarchy 4 box, two of the three settings worth checking were already correct out of the box —
only `split_lock_mitigate` differed, and that one is a trade rather than a fix.

The card reports the three, says what each costs when it is wrong, and hands over a single
command that writes a `sysctl.d` drop-in so the change survives a reboot.

> ⚠️ **This reports. It does not tune.** Kernel parameters belong to the distribution and to the
> person running the machine; an app that quietly edits them is an app that eventually breaks
> somebody's system in a way they cannot trace back. Same rule as the package installs: you see
> the command, you type your own password, in a real terminal.

### 9. It gets out of the way while you play

- **The screen will not lock mid-game.** A gamepad-only Couch session, a long cutscene or a turn
  spent reading a map produces no keyboard or mouse input at all, so the desktop's idea of idle
  and the player's are completely different — and the lock screen wins that argument. Clarity holds an idle inhibitor for exactly as long as a game is running.

  > ⚠️ An inhibitor, deliberately, rather than flipping your idle setting: an inhibitor dies with
  > the process holding it, whereas a toggle left flipped by a crash would leave your lock screen
  > disabled indefinitely.

- **The power profile switches to performance while a game runs** and is put back afterwards. The
  previous profile is captured before switching, so this cannot strand a laptop on performance.

### 10. Hyprland-friendly

- **The KDE-only "Which Screen Games Open On" card is removed on Hyprland**, not hidden. It is a
  KWin script and KWin is not running, so a card offering to "let KDE decide" has no business on
  an Omarchy desktop.

  > ⚠️ Hiding it was not enough, and this was a real bug rather than a theoretical one: the card
  > carries `.tools-section`, and the Control Panel resets `display` on every `.tools-section` in
  > three places — so an inline `display:none` was undone the moment the panel was opened. The
  > Mac-Native card had the identical bug in 1.8.0. Removal is the fix in both cases.

- **`wmctrl` is correctly treated as unnecessary here.** It is an X11 tool, so on a pure Wayland
  session it does nothing even when installed. The suite says so instead of reporting it missing.
- **Optional desktop tools cannot crash the app.** A minimal Wayland-only box has no `wmctrl`,
  `gio` or `xdg-open`, and a missing one used to be fatal — `spawn` reports ENOENT asynchronously,
  so the `try/catch` that looked like a guard never saw it. Fixed in 1.9.1 (`spawnOptional`), and
  **confirmed on a real Omarchy laptop that genuinely has no `wmctrl`**: Couch, the face that would
  have died, starts clean.
- **Monitors are read through `hyprctl -j`**, matching on connector name rather than index so
  unplugging a monitor does not shift the meaning of a stored choice.

---

## Known limits on older hardware

Omarchy runs happily on old machines, and that is part of its appeal — but **Windows games have a
hard floor that Omarchy has nothing to do with**: Proton renders Direct3D through **DXVK, which is
Vulkan-only**. On a GPU with no Vulkan support the game starts and closes immediately, and the log
ends without an error.

Found on a 2011 MacBook Pro (Intel HD 3000 + Radeon HD 6750M — neither supported by Mesa's Vulkan
drivers). The workaround that works there is **`PROTON_USE_WINED3D=1`**, which renders through
OpenGL instead; set it under the game's own environment variables. It launched a title that had
been failing instantly.

Clarity now recognises this signature and says so — and offers to fix it: the dialog has a
**Use OpenGL for this game** button that sets the variable on that game for you, rather than
naming a variable and leaving you to find the right box.

> ⚠️ Proton Experimental also throws a `Xalia … No displays available` stack trace on such a
> machine. It is a **red herring** — disabling Xalia removes the trace and the game still dies.
> The app names Vulkan first for exactly that reason.

---

## Not done yet

- ~~A Hyprland equivalent of the per-game screen picker.~~ ✅ **Shipped in Phase 2E**
  (`packages/core/hypr-display.js`). It implements the same six-method interface as
  `kwin-display.js` and `linux.js` selects the backend at call time, so the existing card
  simply started working — no UI change at all.
  ⚠️ The obvious route in this note, `hyprctl keyword windowrulev2 monitor`, is the one that
  does **not** work on Omarchy 4; `hyprctl eval` with the Lua helper is the live API, and
  keyword is kept only as the fallback for a plain Arch + Hyprland box.
- **A command palette.** ✅ Shipped in Phase 2E: `Ctrl+K` over games *and* actions, subsequence
  matching, Enter opens a game's page rather than launching it.

- **EmuLatte.** Both modules were written to be copied there unchanged; only the wiring differs.
  RetroArch's entry is already flagged for it.
- **Omarchy theme *hooks*.** `omarchy hook install theme-set` would remove the need to watch the
  filesystem, but it means writing a script into the user's system that outlives uninstalling us.
  Watching `~/.local/state/omarchy/current` costs nothing and needs no permission, so that is what
  is done instead.

---

## Testing notes

Everything above was built and verified on a real Omarchy 4.0.0 laptop (Hyprland 0.56.2), not
simulated. The theme mapping was validated against all 46 installed themes at once.

⚠️ **Releases are never cut from an Omarchy machine** — the AppImage links against the build host's
glibc, and building on rolling Arch silently raises the floor for everyone who downloads it. See
`docs/omarchy-handoff.md`.
