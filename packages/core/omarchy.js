// ── Omarchy Linux integration ────────────────────────────────────────────────
// Omarchy is Arch with Hyprland and an opinionated set of defaults. It is NOT a platform
// backend: `host.id` is still `linux` and every path in platform/linux.js applies unchanged.
// What is different is the *desktop* — a Wayland tiling compositor instead of KDE — and the
// fact that a fresh install ships almost none of the gaming stack, because Omarchy is aimed
// at developers first. Both of those are things this module can answer questions about.
//
// This file deliberately imports nothing from the rest of the suite: node builtins only. It
// is meant to be copied into EmuLatte verbatim, where only the wiring differs.
//
// ⚠️ Nothing here escalates privileges. Installing packages needs root, and the honest way
// to ask for root from a GUI app is to hand the command to a terminal the user can watch —
// see openInstallTerminal(). Omarchy's own guidance says the same: sudo where a terminal
// exists to type the password into.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const HOME = os.homedir();

function which(bin) {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (!dir) continue;
        const p = path.join(dir, bin);
        try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
    }
    return '';
}

// ── Detection ────────────────────────────────────────────────────────────────
// os-release is the only thing that identifies the distribution. Omarchy 4 sets
// ID=omarchy with ID_LIKE=arch, which is why linux.js's pacman hints already fire
// correctly — its is() helper splits ID_LIKE. Do not assume ID_LIKE stays set: a future
// release dropping it would silently turn every "arch" branch off, so anything that needs
// "is this pacman-based" should ask isArchLike() rather than reading ID alone.
let _osRelease;
function osRelease() {
    if (_osRelease) return _osRelease;
    _osRelease = { id: '', idLike: '', versionId: '', prettyName: '', name: '' };
    try {
        const text = fs.readFileSync('/etc/os-release', 'utf8');
        const get = key => {
            const m = text.match(new RegExp('^' + key + '=(.*)$', 'm'));
            return m ? m[1].trim().replace(/^"(.*)"$/, '$1') : '';
        };
        _osRelease = {
            id: get('ID').toLowerCase(),
            idLike: get('ID_LIKE').toLowerCase(),
            versionId: get('VERSION_ID'),
            prettyName: get('PRETTY_NAME'),
            name: get('NAME'),
        };
    } catch {}
    return _osRelease;
}

function isOmarchy() { return osRelease().id === 'omarchy'; }
function isArchLike() {
    const { id, idLike } = osRelease();
    return id === 'arch' || id === 'omarchy' || idLike.split(/\s+/).includes('arch');
}
function version() { return osRelease().versionId || ''; }

// Hyprland is what Omarchy runs, but it is not exclusive to it — someone on plain Arch may
// well be running Hyprland too, and every window-management feature here works for them.
// Keep the two questions separate so neither gates the other.
function isHyprland() {
    const d = `${process.env.XDG_CURRENT_DESKTOP || ''} ${process.env.DESKTOP_SESSION || ''}`.toLowerCase();
    return d.includes('hyprland') || !!process.env.HYPRLAND_INSTANCE_SIGNATURE;
}

function hyprctlBin() { return which('hyprctl'); }

// hyprctl -j returns JSON for the query subcommands. A non-zero exit or unparseable output
// means the compositor is not listening (no session, or a version without that query), and
// every caller here treats that as "feature unavailable" rather than an error worth raising.
function hyprctl(args) {
    const bin = hyprctlBin();
    if (!bin) return null;
    try {
        const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 4000, maxBuffer: 4 * 1024 * 1024 });
        if (r.status !== 0 || !r.stdout) return null;
        return r.stdout;
    } catch { return null; }
}

function hyprctlJson(args) {
    const out = hyprctl([...args, '-j']);
    if (!out) return null;
    try { return JSON.parse(out); } catch { return null; }
}

// The monitors Hyprland knows about, in its own order. `name` is the connector (eDP-1,
// LVDS-1, HDMI-A-1) and is what a window rule matches on — an index shifts when a monitor
// is unplugged, a connector name does not. Same reasoning as kwin-display.js.
function monitors() {
    const list = hyprctlJson(['monitors']);
    if (!Array.isArray(list)) return [];
    return list.map(m => ({
        name: String(m.name || ''),
        description: String(m.description || ''),
        width: Number(m.width) || 0,
        height: Number(m.height) || 0,
        refreshRate: Number(m.refreshRate) || 0,
        scale: Number(m.scale) || 1,
        focused: !!m.focused,
        id: Number(m.id),
    })).filter(m => m.name);
}

// ── Window behaviour under Hyprland ──────────────────────────────────────────
// A tiling compositor tiles everything, including windows that are obviously transient. The
// Installer window is the clear case: it is a tool the Manager opens over itself, and tiling it
// side-by-side halves the library you were just looking at. Sign-in windows are the same
// shape — they are dialogs, and a dialog that steals half the screen is a dialog done wrong.
//
// ⚠️ Every face ships as the same Electron app, so they all share one app id
// (`clarity`). Class alone cannot tell them apart; the rules below match on TITLE, which
// is the only thing that distinguishes Installer from the Manager from Couch.
//
// Applied with `hyprctl keyword`, which is session-scoped and writes NOTHING to the user's
// Hyprland config — the same restraint kwin-display.js exercises on KDE, and for the same
// reason: a game launcher has no business editing someone's window manager configuration.
// Re-applied at every start, since the rules die with the session.
// ⚠️ Hyprland 0.56 with Omarchy's Lua config runs a NON-LEGACY parser, and `hyprctl keyword`
// simply does not work there — it answers "keyword can't work with non-legacy parsers. Use
// eval." and changes nothing. Worse, it answers that on stdout with exit status 0, so a naive
// success check counts the refusal as a success and reports rules applied that were not. The
// runtime API is `hyprctl eval` with Omarchy's own Lua helper:
//
//     o.window({ class = "...", title = "..." }, { float = true, center = true })
//
// A plain Arch box running Hyprland with a .conf config still has the legacy parser, so the
// keyword form is kept as a fallback. Both are checked for a literal "ok".
// Every window class a game can arrive under, as one Lua/Hyprland regex. Kept in step with
// kwin-display.js's GAME_CLASSES — the same problem on a different compositor.
const GAME_CLASS_RE = '^(steam_app_.*|dosbox.*|scummvm|openbor|gzdoom|uzdoom|ironwail|vkquake|quake.*|raze|buildgdx|ecwolf|cannonball)$';

const WINDOW_RULES = [
    // Installer floats above the Manager rather than splitting the screen with it — it is a tool
    // opened over the library, and tiling it halves the thing you were just looking at.
    {
        lua: 'o.window({ class = "^(clarity)$", title = "^(Clarity Installer)$" }, { float = true, center = true, size = { 1100, 700 } })',
        keyword: ['float', 'class:^(clarity)$,title:^(Clarity Installer)$'],
    },
    // Store sign-in windows are dialogs, and the one place a user types a password.
    {
        lua: 'o.window({ class = "^(clarity)$", title = "^(.*(Login to|Sign in to).*)$" }, { float = true, center = true })',
        keyword: ['float', 'class:^(clarity)$,title:^(.*(Login to|Sign in to).*)$'],
    },
    // The manual viewer is a reader opened beside a game.
    {
        lua: 'o.window({ class = "^(clarity)$", title = "^(.*Manual.*)$" }, { float = true, center = true })',
        keyword: ['float', 'class:^(clarity)$,title:^(.*Manual.*)$'],
    },
    // Games launched through umu/Proton all arrive as steam_app_* (umu gives every non-Steam
    // title the same class — see kwin-display.js for why that is not ours to change). Holding
    // idle off while one is focused is belt-and-braces alongside the app's own inhibitor, and
    // it is what Steam's own Omarchy rule does.
    {
        lua: `o.window({ class = "${GAME_CLASS_RE}" }, { idle_inhibit = "focus" })`,
        keyword: ['idleinhibit focus', `class:${GAME_CLASS_RE}`],
    },
];

// ── How a game's window opens ────────────────────────────────────────────────
// Three answers, and the default is fullscreen.
//
// A game that opens TILED gets shoved into whatever slot the layout has free and resized to
// it, a moment before it goes fullscreen anyway — so the first thing you see of a game is it
// being squashed into half a screen.
//
// FLOATING was the old default and fixed that, but not the thing underneath it: a floating
// game opens at whatever size it decided on, which on a multi-monitor desk is frequently the
// wrong one. It then stays that size, so pressing the compositor's fullscreen key scales a
// small picture up rather than giving the game the screen.
//
// FULLSCREEN hands it the whole monitor at map time, which is what a game wants and what
// Omarchy's own rules already do for RetroArch and Moonlight. ⚠️ It also fullscreens a game's
// little pre-launch configuration dialog, since umu gives every Proton title the same window
// class and nothing distinguishes the two — which is exactly why floating remains one click
// away rather than being deleted.
//
// Same class list the KWin picker uses: everything through umu/Proton arrives as steam_app_*,
// and the rest are the runners the suite launches directly.
const GAME_WINDOW_MODES = {
    fullscreen: {
        lua: `o.window({ class = "${GAME_CLASS_RE}" }, { fullscreen = true })`,
        keyword: ['fullscreen', `class:${GAME_CLASS_RE}`],
    },
    float: {
        lua: `o.window({ class = "${GAME_CLASS_RE}" }, { float = true, center = true })`,
        keyword: ['float', `class:${GAME_CLASS_RE}`],
    },
    // 'tile' is the compositor's own behaviour, so it is the absence of a rule rather than
    // a rule of its own. ⚠️ Which also means switching TO it needs a fresh session: a
    // Hyprland rule cannot be withdrawn once set, only not re-applied.
    tile: null,
};

const GAME_WINDOW_MODE_DEFAULT = 'fullscreen';

/*
 * Drop every window rule added at runtime, by re-reading the user's own Hyprland config.
 *
 * ⚠️ This exists because a Hyprland rule cannot be withdrawn — the Lua API has `unbind` for
 * keys and nothing at all for window rules (checked against 0.56.2's `hl` table). So the only
 * way to stop a rule applying is to make the compositor forget every dynamic one, which
 * `hyprctl reload` does: measured, a rule added by eval no longer matched afterwards, and the
 * monitor layout came back untouched because that lives in the user's config.
 *
 * ⚠️ It is therefore NOT free: rules other tools set at runtime this session go too, and only
 * ours are put back. That is why nothing calls this on its own — it happens when the user asks
 * for the change to take effect now, and the button says what it does.
 */
function reloadConfig() {
    if (!isHyprland() || !hyprctlBin()) return { ok: false };
    const out = hyprctl(['reload']);
    return { ok: !!(out && /^ok\b/i.test(out.trim())) };
}

function applyWindowRules({ gameWindowMode = GAME_WINDOW_MODE_DEFAULT } = {}) {
    if (!isHyprland() || !hyprctlBin()) return { ok: false, applied: 0, total: 0 };
    // ⚠️ `hasOwnProperty`, not `||`: 'tile' is a real mode whose rule is deliberately null, and
    // an `||` reads that as "unknown mode" and quietly substitutes fullscreen — so the one
    // setting that means "leave my windows alone" did the opposite.
    const modeRule = Object.prototype.hasOwnProperty.call(GAME_WINDOW_MODES, gameWindowMode)
        ? GAME_WINDOW_MODES[gameWindowMode]
        : GAME_WINDOW_MODES[GAME_WINDOW_MODE_DEFAULT];
    const rules = modeRule ? [...WINDOW_RULES, modeRule] : WINDOW_RULES;
    let applied = 0;
    for (const r of rules) {
        let out = hyprctl(['eval', r.lua]);
        // No Lua helper (a plain Hyprland with the legacy parser) — try the classic form.
        if (!out || !/^ok\b/i.test(out.trim())) {
            const alt = hyprctl(['keyword', 'windowrulev2', `${r.keyword[0]}, ${r.keyword[1]}`]);
            out = alt;
        }
        if (out && /^ok\b/i.test(out.trim())) applied++;
    }
    return { ok: applied > 0, applied, total: rules.length };
}

// ── System tuning for games ──────────────────────────────────────────────────
// A gaming-focused distribution sets a handful of kernel knobs that a general-purpose one
// leaves at defaults. Most of what those distributions are famous for does not apply on Arch
// — full Mesa and ffmpeg are already here, the kernel is newer, and the fsync work that once
// justified a patched kernel is upstream — so this list is deliberately short. Measured on a
// real Omarchy 4 box, two of the three below were already correct out of the box.
//
// ⚠️ This REPORTS. It does not tune anything. Kernel parameters belong to the distribution
// and to the person running the machine; an app that edits them is an app that eventually
// breaks somebody's system in a way they cannot trace back. The fix is handed over as a
// command, through a terminal, exactly like package installs.
const TUNING = [
    {
        key: 'max_map_count', label: 'Memory map limit',
        read: () => procNumber('/proc/sys/vm/max_map_count'),
        want: 1048576, cmp: 'gte', sysctl: 'vm.max_map_count=1048576',
        why: 'Some games — Proton titles especially — map far more memory regions than the old default allowed, and hit a wall that looks like a random crash. Modern kernels already ship a high value.',
    },
    {
        key: 'split_lock', label: 'Split-lock mitigation',
        read: () => procNumber('/proc/sys/kernel/split_lock_mitigate'),
        want: 0, cmp: 'eq', sysctl: 'kernel.split_lock_mitigate=0',
        why: 'The kernel penalises a program that performs unaligned atomic operations across a cache line. A few games do it constantly and lose noticeable frames to the penalty. Turning it off trades a hardening measure for that performance.',
    },
    {
        key: 'file_limit', label: 'Open file limit',
        // /proc/self/limits reflects what this process inherited, which is the same session
        // default a game launched from here will get — a truer answer than fs.file-max.
        read: () => {
            try {
                const line = fs.readFileSync('/proc/self/limits', 'utf8')
                    .split('\n').find(l => /max open files/i.test(l)) || '';
                const n = line.match(/(\d+|unlimited)\s+(\d+|unlimited)/);
                if (!n) return null;
                return n[2] === 'unlimited' ? Infinity : parseInt(n[2], 10);
            } catch { return null; }
        },
        want: 524288, cmp: 'gte', sysctl: '',   // not a sysctl — set by systemd, see `fix`
        fix: 'sudo mkdir -p /etc/systemd/system.conf.d && printf \'[Manager]\\nDefaultLimitNOFILE=524288:524288\\n\' | sudo tee /etc/systemd/system.conf.d/99-gaming-nofile.conf',
        why: 'esync gives every game thread its own file descriptor, so a low ceiling shows up as a game refusing to start once it is busy enough.',
    },
];

function procNumber(p) {
    try { const v = parseInt(String(fs.readFileSync(p, 'utf8')).trim(), 10); return Number.isFinite(v) ? v : null; }
    catch { return null; }
}

function systemTuning() {
    return TUNING.map(t => {
        const value = t.read();
        const ok = value === null ? null
                 : t.cmp === 'gte' ? value >= t.want
                 : value === t.want;
        return {
            key: t.key, label: t.label, why: t.why,
            value: value === Infinity ? 'unlimited' : value,
            want: t.want, ok,
        };
    });
}

// One command for everything that is off, written as a sysctl drop-in so it survives a
// reboot. Anything without a sysctl (the file limit) carries its own command.
function tuningCommand() {
    const bad = TUNING.filter(t => {
        const v = t.read();
        if (v === null) return false;
        return t.cmp === 'gte' ? v < t.want : v !== t.want;
    });
    if (!bad.length) return '';
    const parts = [];
    const sysctls = bad.filter(t => t.sysctl).map(t => t.sysctl);
    if (sysctls.length) {
        parts.push(`printf '${sysctls.join('\\n')}\\n' | sudo tee /etc/sysctl.d/99-clarity-gaming.conf`);
        parts.push('sudo sysctl --system');
    }
    for (const t of bad) if (!t.sysctl && t.fix) parts.push(t.fix);
    return parts.join('; ');
}

// ── The desktop's geometry ───────────────────────────────────────────────────
// Matching the palette makes the app look like the desktop; matching the geometry makes it
// sit in it. Omarchy's default is square corners (rounding = 0), and an app full of rounded
// cards on that desktop reads as foreign in a way that is hard to name until you see them
// side by side.
//
// ⚠️ Read from the compositor, not from ~/.config/hypr/looknfeel.lua. The config is Lua in
// Omarchy 4 and parsing it would mean writing a Lua reader for one integer — and it would
// still be wrong the moment the value is changed at runtime. `hyprctl getoption` reports what
// Hyprland is ACTUALLY using.
function hyprGeometry() {
    if (!isHyprland()) return null;
    const num = key => {
        const out = hyprctl(['getoption', key]);
        if (!out) return null;
        const m = out.match(/int:\s*(-?\d+)/i);
        return m ? parseInt(m[1], 10) : null;
    };
    const rounding = num('decoration:rounding');
    if (rounding === null) return null;
    return {
        rounding,
        borderSize: num('general:border_size'),
        gapsIn: num('general:gaps_in'),
    };
}

// ── Keeping the screen awake while a game runs ───────────────────────────────
// Omarchy locks on idle. A gamepad-only Couch session, a long cutscene or a turn spent
// reading a map produces no keyboard or mouse input at all, so the desktop's idea of "idle"
// and the player's are completely different — and the lock screen wins.
//
// Electron's powerSaveBlocker speaks the Wayland idle-inhibit protocol, which hypridle honours,
// so the app can hold the inhibitor for exactly as long as a game is running. That is better
// than toggling Omarchy's idle setting: a toggle left flipped by a crash would disable the
// user's lock screen indefinitely, whereas an inhibitor dies with the process that holds it.
//
// ⚠️ Deliberately NOT `omarchy toggle idle`. Persistent state that outlives a crash is exactly
// what a game launcher should not be leaving behind on someone's desktop.
let _idleBlockerId = null;
function inhibitIdle(on, powerSaveBlocker) {
    if (!powerSaveBlocker) return false;
    try {
        if (on) {
            if (_idleBlockerId !== null && powerSaveBlocker.isStarted(_idleBlockerId)) return true;
            _idleBlockerId = powerSaveBlocker.start('prevent-display-sleep');
            return true;
        }
        if (_idleBlockerId !== null) {
            if (powerSaveBlocker.isStarted(_idleBlockerId)) powerSaveBlocker.stop(_idleBlockerId);
            _idleBlockerId = null;
        }
        return true;
    } catch { return false; }
}

// ── Power profile ────────────────────────────────────────────────────────────
// Omarchy manages power profiles, and on a laptop the difference between `balanced` and
// `performance` is real. Switch for the duration of a game and put it back afterwards.
//
// ⚠️ The previous profile is captured at switch time and restored on the way out, so this
// cannot strand a machine in `performance` and eat someone's battery. If the profile cannot
// be read, nothing is changed at all — guessing what to restore to would be worse than not
// helping.
let _savedProfile = '';
function powerProfile(name) {
    const bin = which('powerprofilesctl');
    if (!bin) return '';
    try {
        const r = spawnSync(bin, name ? ['set', name] : ['get'], { encoding: 'utf8', timeout: 4000 });
        return r.status === 0 ? String(r.stdout || '').trim() : '';
    } catch { return ''; }
}

function setGamingPower(on) {
    if (!isOmarchy()) return false;
    if (on) {
        if (_savedProfile) return true;                 // already switched for another game
        const cur = powerProfile('');
        if (!cur || cur === 'performance') return false; // nothing to do, or nothing to restore to
        _savedProfile = cur;
        return !!powerProfile('performance') || true;
    }
    if (!_savedProfile) return false;
    powerProfile(_savedProfile);
    _savedProfile = '';
    return true;
}

// ── The gaming stack ─────────────────────────────────────────────────────────
// What a fresh Omarchy lacks, measured against what the Nobara reference host has. Nobara
// is a gaming distribution and ships this whole list preinstalled, which is exactly why the
// gap only becomes visible on a machine like this one.
//
// ⚠️ Never name the reference distribution in a `label` or `why` — those strings are rendered
// in the app, and a user on Omarchy has no reason to be told about another distro. Describe
// what the tool does instead. (The comments here are developer-facing and may name it.)
//
// Every entry names the binary the suite actually probes for, so this list stays honest:
// `required: true` means something in Clarity degrades without it, and the `why`
// says what. The `extra` group is what Nobara ships and a gamer will want, but which the
// suite itself never calls — labelled so nobody is told they need something they don't.
//
// ⚠️ Package names are Arch's, and `repo` records where it comes from: everything here is
// in an official repo except dosbox-staging, which is AUR-only and therefore installed
// with a different command. Getting that wrong produces a "target not found" for the user.
const TOOLS = [
    { key: 'umu',      bin: 'umu-run',                 pkg: 'umu-launcher',       repo: 'multilib', required: true,
      label: 'umu-launcher',
      why: 'the recommended way to launch Windows games. Without it the suite falls back to invoking Proton directly, which works but loses umu\'s per-game compatibility fixes.' },
    // ⚠️ Plain `dosbox` from the official repos, NOT dosbox-staging from the AUR. The suite
    // accepts any of the three, the Nobara reference host runs plain `dosbox`, and this list
    // exists to reach parity with that host. Staging is arguably the better emulator, but it
    // is an AUR source build — minutes of compiling on old hardware, and a dependency on an
    // AUR helper — for a tier labelled "required". Anyone who wants Staging can install it
    // themselves and the alternates below pick it up.
    { key: 'dosbox',   bin: 'dosbox',                   pkg: 'dosbox',             repo: 'extra',    required: true,
      label: 'DOSBox', alt: ['dosbox-staging', 'dosbox-x'],
      why: 'DOS games from GOG launch through it. Without any DOSBox, those titles cannot start at all. An existing dosbox-staging or dosbox-x counts just the same.' },
    { key: 'wmctrl',   bin: 'wmctrl',                   pkg: 'wmctrl',             repo: 'extra',    required: false,
      label: 'wmctrl',
      why: 'used to raise the window after a game exits. It is an X11 tool, so on a pure Wayland session it does nothing even when installed — safe to skip on Hyprland.' },
    { key: 'pipx',     bin: 'pipx',                     pkg: 'python-pipx',        repo: 'extra',    required: false,
      label: 'pipx',
      why: 'lets the suite install umu-launcher into your home directory without root. Unnecessary if umu-launcher is installed from the repos.' },
    { key: 'wine',     bin: 'wine',                     pkg: 'wine',               repo: 'extra',    required: false,
      label: 'wine',
      why: 'a last-resort runner for the rare title that will not start under Proton.' },
    { key: 'flatpak',  bin: 'flatpak',                  pkg: 'flatpak',            repo: 'extra',    required: false,
      label: 'Flatpak',
      why: 'lets the suite find Flatpak-installed games and the Flatpak build of DOSBox.' },

    { key: 'gamemode', bin: 'gamemoderun',              pkg: 'gamemode',           repo: 'extra',    required: false, extra: true,
      label: 'GameMode',
      why: 'applies CPU governor and scheduling tweaks while a game runs. Gaming-focused distributions ship it as standard; the suite does not call it itself.' },
    { key: 'mangohud', bin: 'mangohud',                 pkg: 'mangohud',           repo: 'extra',    required: false, extra: true,
      label: 'MangoHud',
      why: 'an in-game performance overlay showing framerate, temperatures and frame times. The suite does not call it itself.' },
    { key: 'gamescope',bin: 'gamescope',                pkg: 'gamescope',          repo: 'extra',    required: false, extra: true,
      label: 'gamescope',
      why: 'a micro-compositor useful for scaling and framerate limiting, and for games that behave badly on a tiling WM.' },
    { key: 'winetricks',bin: 'winetricks',              pkg: 'winetricks',         repo: 'extra',    required: false, extra: true,
      label: 'winetricks',
      why: 'installs Windows redistributables into a prefix by hand when a game needs one the automatic setup missed.' },
    { key: 'protontricks', bin: 'protontricks',         pkg: 'protontricks',       repo: 'extra',    required: false, extra: true,
      label: 'protontricks',
      why: 'the same idea as winetricks, aimed at Steam/Proton prefixes.' },
];

// ── Omarchy's own gaming installers ──────────────────────────────────────────
// Omarchy ships `omarchy install gaming <thing>`, and for anything it covers that command
// is strictly better than installing the package ourselves: `steam` also pulls the 32-bit
// graphics drivers picked for *this* GPU, which is the step people miss and the reason a
// fresh Arch install runs Proton games at software-rendering speed or not at all.
//
// So the rule is: if Omarchy has an installer for it, hand the user Omarchy's installer.
// We detect what is missing and get out of the way. Nothing here is installed by us.
//
// ⚠️ These are whole applications, not helper binaries — a missing one is never an error,
// only an offer. Steam missing is worth surfacing prominently because the library is built
// from it; the rest are opportunities.
const FLATPAK_EXPORTS = [
    path.join(HOME, '.local', 'share', 'flatpak', 'exports', 'bin'),
    '/var/lib/flatpak/exports/bin',
];

function flatpakInstalled(appId) {
    if (!appId) return false;
    return FLATPAK_EXPORTS.some(d => { try { return fs.existsSync(path.join(d, appId)); } catch { return false; } });
}

function pacmanHas(pkg) {
    try {
        const r = spawnSync('pacman', ['-Qq', pkg], { encoding: 'utf8', timeout: 4000 });
        return r.status === 0;
    } catch { return false; }
}

const INSTALLERS = [
    { key: 'steam', label: 'Steam', bin: 'steam', flatpak: 'com.valvesoftware.Steam',
      command: 'omarchy install gaming steam', headline: true,
      why: 'the Steam library is the largest part of most collections here, and the suite reads it directly from disk. Omarchy\'s installer also pulls the 32-bit graphics drivers chosen for this GPU, which Proton needs.' },
    { key: 'gpu-lib32', label: '32-bit graphics drivers', pkg: 'lib32-vulkan-icd-loader',
      command: 'omarchy install gaming gpu-lib32',
      why: 'Proton and Wine are 32-bit-capable and need the lib32 Vulkan stack. Without it Windows games fail to start or fall back to software rendering. Installing Steam through Omarchy brings these in too.' },
    // ⚠️ Heroic and Lutris are deliberately absent. The suite signs in to GOG and Epic
    // itself and runs Windows games through Proton directly, so a second launcher is not a
    // missing piece — it is a competing one, and offering to install it would undercut the
    // thing this app exists to do. Omarchy can install both; that is the user's business,
    // not a gap for us to report.

    // Emulation belongs to EmuLatte, not here. Carried in the shared module so the EmuLatte
    // port has it, and filtered out of this app's UI by the `emulation` flag.
    { key: 'retroarch', label: 'RetroArch', bin: 'retroarch', flatpak: 'org.libretro.RetroArch',
      command: 'omarchy install gaming retroarch', emulation: true,
      why: 'Omarchy installs RetroArch with the full libretro core set in one step. Emulation is EmuLatte\'s pillar rather than this app\'s.' },
    { key: 'xbox-controllers', label: 'Xbox controller support', pkg: 'xpadneo-dkms',
      command: 'omarchy install gaming xbox-controllers',
      why: 'optional. Wireless Xbox pads need this to pair properly; Couch is gamepad-first, so it is worth having if you play from the couch.' },
];

function installerStatus() {
    return INSTALLERS.map(i => {
        const binPath = i.bin ? which(i.bin) : '';
        const present = !!binPath || (i.flatpak ? flatpakInstalled(i.flatpak) : false) || (i.pkg ? pacmanHas(i.pkg) : false);
        return {
            key: i.key, label: i.label, command: i.command, why: i.why,
            headline: !!i.headline, emulation: !!i.emulation,
            present, path: binPath || null,
            via: binPath ? 'path' : (i.flatpak && flatpakInstalled(i.flatpak)) ? 'flatpak'
               : (i.pkg && pacmanHas(i.pkg)) ? 'package' : null,
        };
    });
}

// `includeEmulation` is false for Clarity and true for EmuLatte — same module,
// each app reporting only what it is actually responsible for.
function missingInstallers({ includeEmulation = false } = {}) {
    return installerStatus().filter(i => !i.present && (includeEmulation || !i.emulation));
}

// Run one of Omarchy's installers in a terminal. Same reasoning as openInstallTerminal():
// these are `requires-sudo=true` scripts, and a terminal is where a password belongs.
function runInstaller(key) {
    const entry = INSTALLERS.find(i => i.key === key);
    if (!entry) return { ok: false, error: `Unknown installer: ${key}` };
    return openTerminalWith(entry.command);
}

// Resolve one tool against PATH, honouring the alternates — a user with plain `dosbox`
// installed has a working DOSBox and must not be told otherwise.
function resolveTool(t) {
    let found = which(t.bin);
    let via = found ? t.bin : '';
    if (!found && Array.isArray(t.alt)) {
        for (const a of t.alt) {
            const p = which(a);
            if (p) { found = p; via = a; break; }
        }
    }
    return {
        key: t.key, label: t.label, bin: t.bin, pkg: t.pkg, repo: t.repo,
        required: !!t.required, extra: !!t.extra, why: t.why,
        path: found || null, present: !!found, foundAs: via || null,
    };
}

function toolStatus() { return TOOLS.map(resolveTool); }
function missingTools({ includeExtras = true } = {}) {
    return toolStatus().filter(t => !t.present && (includeExtras || !t.extra));
}

// A one-line summary for the UI: how far this host is from the reference.
function gapSummary() {
    const all = toolStatus();
    const missing = all.filter(t => !t.present);
    return {
        total: all.length,
        present: all.length - missing.length,
        missingRequired: missing.filter(t => t.required).map(t => t.key),
        missingOptional: missing.filter(t => !t.required && !t.extra).map(t => t.key),
        missingExtras: missing.filter(t => t.extra).map(t => t.key),
    };
}

// ── Installing what is missing ───────────────────────────────────────────────
// AUR packages go through a different command than repo packages, so a mixed selection has
// to become two commands rather than one. `omarchy pkg add` is a no-op for anything already
// installed, which makes re-running it after a partial failure safe.
function installCommand(keys) {
    const want = toolStatus().filter(t => keys.includes(t.key) && !t.present);
    const repo = want.filter(t => t.repo !== 'aur').map(t => t.pkg);
    const aur  = want.filter(t => t.repo === 'aur').map(t => t.pkg);
    const parts = [];
    if (repo.length) parts.push(`omarchy pkg add ${repo.join(' ')}`);
    if (aur.length)  parts.push(`omarchy pkg aur add ${aur.join(' ')}`);
    // ⚠️ `;` and not `&&`. Chained with &&, a non-zero exit from the repo step — which
    // includes cases as harmless as "nothing to do" — silently skips the AUR step, and the
    // user is left being told a package is still missing after watching an install succeed.
    // These are independent installs; one failing is not a reason to skip the other.
    return parts.join('; ');
}

// The terminal to hand a privileged command to. xdg-terminal-exec is the freedesktop
// indirection Omarchy itself uses (TERMINAL is set to it), so it honours whatever terminal
// the user actually chose; the rest are fallbacks for a non-Omarchy Hyprland box.
function terminalLauncher() {
    const xte = which('xdg-terminal-exec');
    if (xte) return { cmd: xte, wrap: args => args };
    for (const t of ['foot', 'alacritty', 'ghostty', 'kitty', 'wezterm']) {
        const p = which(t);
        if (p) return { cmd: p, wrap: args => (t === 'wezterm' ? ['start', '--', ...args] : ['-e', ...args]) };
    }
    return null;
}

// Open a terminal running a command, then keep it open so the result is readable — a
// terminal that closes the instant pacman finishes takes the error with it.
//
// ⚠️ detached + unref is what stops the install dying when the app is closed mid-way, and
// the 'error' listener is not optional: spawn reports a missing terminal asynchronously, so
// a try/catch alone would let an unhandled 'error' event take the whole app down. That is
// the same trap spawnOptional() exists for in linux.js.
function openTerminalWith(command) {
    if (!command) return { ok: false, error: 'Nothing to run.' };
    const term = terminalLauncher();
    if (!term) return { ok: false, error: 'No terminal emulator found to run this in.', command };
    const script = `${command}; echo; echo "── done. press enter to close ──"; read _`;
    try {
        const child = spawn(term.cmd, term.wrap(['bash', '-lc', script]), { detached: true, stdio: 'ignore' });
        child.on('error', () => {});   // a missing terminal must not take the app down
        child.unref();
        return { ok: true, command };
    } catch (e) {
        return { ok: false, error: e.message, command };
    }
}

function openInstallTerminal(keys) {
    const command = installCommand(keys);
    if (!command) return { ok: false, error: 'Nothing to install — every selected tool is already present.' };
    return openTerminalWith(command);
}

// ── Gate ─────────────────────────────────────────────────────────────────────
// Everything above is meaningful on any Arch-like host running Hyprland; the Omarchy-only
// parts (omarchy pkg, the theme bridge) need the real thing. Callers that only want window
// management should ask isHyprland() instead.
function isSupported() { return isOmarchy(); }

function describe() {
    return {
        isOmarchy: isOmarchy(),
        isArchLike: isArchLike(),
        isHyprland: isHyprland(),
        version: version(),
        prettyName: osRelease().prettyName,
        hyprland: isHyprland() ? (hyprctl(['version'])?.split('\n')[0] || '').trim() : '',
        monitors: isHyprland() ? monitors().length : 0,
    };
}

module.exports = {
    osRelease, isOmarchy, isArchLike, version, isHyprland,
    hyprctl, hyprctlJson, monitors,
    TOOLS, toolStatus, missingTools, gapSummary,
    INSTALLERS, installerStatus, missingInstallers, runInstaller,
    WINDOW_RULES, GAME_WINDOW_MODES, GAME_WINDOW_MODE_DEFAULT, GAME_CLASS_RE, applyWindowRules, reloadConfig,
    TUNING, systemTuning, tuningCommand, inhibitIdle, setGamingPower, powerProfile, hyprGeometry,
    installCommand, openInstallTerminal, openTerminalWith, terminalLauncher,
    isSupported, describe, which,
};
