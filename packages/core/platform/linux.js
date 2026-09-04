'use strict';
/*
 * @clarity/core, the Linux platform backend.
 *
 * Everything in here was lifted out of installer-engine.js unchanged. The comments came with
 * it on purpose: nearly every one of them records a bug that took real debugging to find,
 * and they read as arbitrary without that history.
 *
 * Phase A moves only what installer-engine.js needs. Paths, desktop integration and store
 * inventory follow in A3–A5, alongside their call sites.
 */

const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const { execSync, spawnSync, spawn } = require('child_process');
const https = require('https');

// ── Injected context ─────────────────────────────────────────────────────────
// Mirrors installer-engine's own init() idiom. `getDb` is a getter rather than a handle
// because the engine re-attaches its database after init (see setDb).
let HOME       = os.homedir();
let configDir  = '';
let getDb      = () => null;
let expandTilde = p => (p && p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);

function init(ctx = {}) {
    HOME        = ctx.homeDir  || HOME;
    configDir   = ctx.configDir || configDir;
    if (typeof ctx.getDb === 'function')       getDb = ctx.getDb;
    if (typeof ctx.expandTilde === 'function') expandTilde = ctx.expandTilde;
    ensureCaBundle();
}

// ── TLS trust for the bundled Python helpers ─────────────────────────────────
// ⚠️ This is why every GOG install failed on Arch, and it pointed at nothing.
//
// gogdl is a frozen PyInstaller binary, and the `requests` inside it resolves its CA bundle
// from a path baked in at BUILD time. Ours are built on Fedora, so that path is
// /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem, which does not exist on Arch, Debian,
// openSUSE or Alpine. On any of those, the very first HTTPS call dies before it is made:
//
//     OSError: Could not find a suitable TLS CA certificate bundle, invalid path:
//              /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem
//
// The user sees "the install failed" on every GOG title, with nothing naming TLS, and the
// obvious suspects, auth, the token, the network, the store, are all fine. Diagnosed on
// Omarchy 4 on 2026-08-25 against a real title; setting the variable below fixed it outright.
//
// Fedora is listed first because on the host the binaries were built for, the baked-in path
// is correct and there is nothing to override. Anything already exported by the user wins,
// so someone with a custom trust store is left alone.
//
// ⚠️ It must run before ANY helper is spawned, which is why it lives in init(), the engine
// calls that during startup, and every child inherits process.env from there.
const CA_BUNDLES = [
    '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem',   // Fedora / RHEL / Nobara, the build host
    '/etc/ca-certificates/extracted/tls-ca-bundle.pem',    // Arch / Omarchy
    '/etc/ssl/certs/ca-certificates.crt',                  // Debian / Ubuntu (Arch symlinks here too)
    '/etc/ssl/ca-bundle.pem',                              // openSUSE
    '/etc/pki/tls/certs/ca-bundle.crt',                    // older RHEL layouts
    '/etc/ssl/cert.pem',                                   // Alpine, and a common fallback
];

function ensureCaBundle() {
    // A value the user set themselves is not ours to second-guess, but an empty or dangling
    // one is worse than none, so it only counts if it actually resolves to a file.
    for (const v of ['REQUESTS_CA_BUNDLE', 'SSL_CERT_FILE']) {
        const cur = process.env[v];
        if (cur) { try { if (fs.statSync(cur).isFile()) return cur; } catch {} }
    }
    for (const p of CA_BUNDLES) {
        let ok = false;
        try { ok = fs.statSync(p).isFile(); } catch {}      // statSync follows symlinks, which is
        if (!ok) continue;                                  // what Arch's /etc/ssl/certs entry is
        // The first entry is the path the binaries already expect; if it is present there is
        // nothing to fix and no reason to start overriding a working default.
        if (p === CA_BUNDLES[0]) return p;
        process.env.REQUESTS_CA_BUNDLE = p;
        process.env.SSL_CERT_FILE = p;                       // curl/openssl-based helpers read this
        return p;
    }
    return '';   // nothing found: leave the environment alone and let the helper report it
}

// ── Paths ────────────────────────────────────────────────────────────────────
// The subdirectory of assets/bin/ holding this host's helper binaries.
const binDirName = 'linux';

// Where the suite keeps user data. The AppImage is portable by design: the library sits
// beside the file the user placed, so moving the AppImage moves the data with it. Falls
// back to the packaged executable's directory, then to whatever the caller uses in dev.
//
// There is no equivalent on macOS, an .app in /Applications cannot keep user data inside
// itself, so a darwin backend returns an absolute Library path and ignores devDir.
function portableBaseDir({ isPackaged = false, execPath = '', devDir = '' } = {}) {
    if (process.env.APPIMAGE) return path.dirname(process.env.APPIMAGE);
    if (isPackaged && execPath) return path.dirname(execPath);
    return devDir;
}

// The binary to re-spawn when one face opens another, and the argv that selects the face.
// Packaged, the AppImage takes the face arguments directly; in dev, Electron needs the repo
// root ahead of them.
function selfExecutable() { return process.env.APPIMAGE || process.execPath; }
function selfSpawnArgs(faceArgs, repoRoot) {
    return process.env.APPIMAGE ? [...faceArgs] : [repoRoot, ...faceArgs];
}

// library.db, in the order it should be looked for. This list was duplicated at fourteen
// call sites across two faces before it lived here.
function installerDbCandidates(baseDir) {
    return [
        path.join(HOME, '.config', 'clarity-installer', 'library.db'),
        path.join(baseDir, 'InstallerConfig', 'library.db'),
    ];
}
function findInstallerDb(baseDir) {
    return installerDbCandidates(baseDir).find(p => fs.existsSync(p)) || null;
}

// Where a library.db should be CREATED when none exists yet (headless first-run sign-in).
function installerDbCreatePath(baseDir, isPackaged) {
    return isPackaged
        ? path.join(HOME, '.config', 'clarity-installer', 'library.db')
        : path.join(baseDir, 'InstallerConfig', 'library.db');
}

// ── System inventory ─────────────────────────────────────────────────────────
function which(bin) {
    try { return execSync(`which ${bin}`, { stdio: ['ignore','pipe','ignore'] }).toString().trim(); }
    catch { return null; }
}

// Directory size. Both the flag and the unit differ between coreutils and BSD userland
// (`du -sB1` is GNU-only; BSD has no -B and reports 512-byte or 1K blocks), so the command
// and the parser have to travel together.
function dirSizeBytesCommand(target) {
    return {
        cmd: `du -sB1 "${target}" 2>/dev/null`,
        parse: out => { const n = parseInt((String(out).split('\t')[0] || '').trim(), 10); return Number.isFinite(n) ? n : null; },
    };
}
function dirSizeHumanCommand(target) {
    return { cmd: `du -sh "${target}" 2>/dev/null`, parse: out => String(out).split('\t')[0].trim() };
}

// legendary keeps its credentials and per-game metadata here. Not the same place on every
// host: macOS puts it under ~/Library/Application Support.
function legendaryConfigDir() { return path.join(HOME, '.config', 'legendary'); }

// ── Desktop integration ──────────────────────────────────────────────────────
// Menu entries, desktop shortcuts, autostart, opening a URL scheme, focusing a window.
// The INTENT is the same everywhere; almost none of the mechanics are. Callers describe a
// launcher in structured fields and the backend decides what a launcher actually is, on
// Linux a .desktop file under XDG directories, elsewhere something else entirely.

// Fire-and-forget spawn of an OPTIONAL desktop-integration tool.
//
// ⚠️ `spawn` reports a missing binary through an ASYNCHRONOUS 'error' event, not a throw, so
// a surrounding try/catch does not catch it, and an unhandled 'error' on a ChildProcess is
// fatal to the process. Every tool below is genuinely optional: a minimal, non-freedesktop or
// Wayland-only session may ship none of them. That made `try { spawn(...) } catch {}` a crash
// waiting for a host without the tool, which is exactly what a tiling-WM Arch install is.
// Each one needs a real listener instead. Swallowing the error is right here, all callers are
// best-effort niceties whose failure the user should never be shown.
function spawnOptional(bin, args, opts = {}) {
    try {
        const p = spawn(bin, args, { stdio: 'ignore', ...opts });
        p.on('error', () => {});
        p.unref();
        return true;
    } catch { return false; }
}

function appsDir()    { return path.join(HOME, '.local', 'share', 'applications'); }

// The XDG Desktop folder, honouring a localised name via user-dirs.dirs.
function desktopDir() {
    try {
        const cfg = path.join(HOME, '.config', 'user-dirs.dirs');
        if (fs.existsSync(cfg)) {
            const m = fs.readFileSync(cfg, 'utf8').match(/XDG_DESKTOP_DIR="([^"]+)"/);
            if (m) return m[1].replace(/^\$HOME/, HOME);
        }
    } catch {}
    return path.join(HOME, 'Desktop');
}

function launcherFileName(id) { return `${id}.desktop`; }

// entry: { id, name, comment, exec, args[], icon, categories[], keywords[], wmClass, extraLines[] }
function launcherContent(entry) {
    const args = (entry.args || []).length ? ' ' + entry.args.join(' ') : '';
    const lines = [
        '[Desktop Entry]', 'Version=1.0', 'Type=Application',
        `Name=${String(entry.name || '').replace(/[\r\n]/g, ' ')}`,
    ];
    if (entry.comment)  lines.push(`Comment=${String(entry.comment).replace(/[\r\n]/g, ' ')}`);
    lines.push(`Exec="${entry.exec}"${args}`);
    if (entry.icon)     lines.push(`Icon=${entry.icon}`);
    lines.push('Terminal=false');
    lines.push(`Categories=${(entry.categories || ['Game']).join(';')};`);
    if (entry.keywords?.length) lines.push(`Keywords=${entry.keywords.join(';')};`);
    if (entry.wmClass)  lines.push(`StartupWMClass=${entry.wmClass}`);
    for (const l of entry.extraLines || []) lines.push(l);
    return lines.join('\n') + '\n';
}

function writeLauncher(dir, entry) {
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, launcherFileName(entry.id));
    fs.writeFileSync(p, launcherContent(entry));
    try { fs.chmodSync(p, '755'); } catch {}
    return p;
}

function removeLauncher(dir, id) {
    try { fs.unlinkSync(path.join(dir, launcherFileName(id))); return true; } catch { return false; }
}

// Tell the desktop a launcher appeared/changed.
function refreshMenu(dir) { spawnOptional('update-desktop-database', [dir]); }

// GNOME/Nautilus require a launcher be marked trusted to run without a warning.
function markTrusted(file) { spawnOptional('gio', ['set', file, 'metadata::trusted', 'true']); }

function autostartPath(id) { return path.join(HOME, '.config', 'autostart', launcherFileName(id)); }
function getAutostart(id)  { try { return fs.existsSync(autostartPath(id)); } catch { return false; } }
function setAutostart(id, enabled, entry) {
    const file = autostartPath(id);
    if (!enabled) { try { fs.unlinkSync(file); } catch {} return { ok: true, enabled: false }; }
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, launcherContent({ ...entry, id, extraLines: ['X-GNOME-Autostart-enabled=true'] }));
        return { ok: true, enabled: true };
    } catch (e) { return { ok: false, error: e.message }; }
}

// Custom schemes (itch://, pico8-cart:), shell.openExternal refuses these, so hand them to
// the desktop's own opener.
function openUrlScheme(url) { spawnOptional('xdg-open', [url], { detached: true }); }

// X11 only: wmctrl sends _NET_ACTIVE_WINDOW with CurrentTime, which most window managers
// honour where Electron's own focus() is ignored. A no-op on Wayland and anywhere wmctrl is
// not installed, enforced below, not merely hoped for, which is what it used to be.
function focusWindow(win) {
    // The claim above is only true if we actually check. With no X server there is no X11
    // window id to send and nothing to send it to, so skip entirely rather than spawn an X11
    // tool into the void; under XWayland DISPLAY is set and this still works as it always has.
    if (!process.env.DISPLAY) return;
    try {
        const hwnd = win.getNativeWindowHandle().readUInt32LE(0);
        spawnOptional('wmctrl', ['-i', '-a', '0x' + hwnd.toString(16)]);
    } catch {}
}

const desktop = {
    canInstallMenuEntries: true,
    appsDir, desktopDir, launcherFileName, writeLauncher, removeLauncher,
    refreshMenu, markTrusted,
    autostartPath, getAutostart, setAutostart,
    openUrlScheme, focusWindow,
    // The per-game display picker has two backends, a KWin script on KDE, Hyprland
    // window rules on Hyprland, behind one interface, so the Control Panel card does
    // not know or care which is in use. The backend is chosen per call rather than at
    // require time: this module is loaded once at startup, and which compositor is
    // running is not a fact about the build.
    // ⚠️ Both self-gate through isSupported(), so on a desktop with neither (plain
    // GNOME, a bare X11 session) every method answers "not supported" instead of
    // throwing, which is what the existing UI path already handles.
    displayPicker: (() => {
        const kwin = require('../kwin-display.js');
        const hypr = require('../hypr-display.js');
        const pick = () => (hypr.isSupported() ? hypr : (kwin.isSupported() ? kwin : null));
        return {
            configure: (dir) => { kwin.configure(dir); hypr.configure(dir); },
            isSupported: () => !!pick(),
            listDisplays: () => pick()?.listDisplays() ?? [],
            currentDisplay: () => pick()?.currentDisplay() ?? null,
            setGameDisplay: (i) => pick()?.setGameDisplay(i) ?? { ok: false, error: 'No supported compositor for this.' },
            apply: () => pick()?.apply() ?? { ok: false, applied: 0 },
        };
    })(),
    // Omarchy: still host.id === 'linux', so this is a desktop-level integration sitting
    // beside the KWin one rather than a platform backend. Both modules gate themselves,
    // on Nobara, isOmarchy() is false and every surface they feed simply does not appear.
    omarchy: require('../omarchy.js'),
    omarchyTheme: require('../omarchy-theme.js'),
};

// ── Steam ────────────────────────────────────────────────────────────────────
// Every place Steam might keep a library on this host, including extra drives declared in
// libraryfolders.vdf. The Manager and Couch each carried a byte-identical copy of this.
function steamLibraryPaths() {
    const roots = [
        path.join(HOME, '.local', 'share', 'Steam'),
        path.join(HOME, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'steam'),
        path.join(HOME, '.steam', 'steam'),
    ];
    const dirs = new Set();
    for (const root of roots) {
        const sa = path.join(root, 'steamapps');
        if (!fs.existsSync(sa)) continue;
        dirs.add(sa);
        try {
            const vdf = path.join(sa, 'libraryfolders.vdf');
            if (fs.existsSync(vdf)) {
                const content = fs.readFileSync(vdf, 'utf8');
                for (const m of content.matchAll(/"path"\s+"([^"]+)"/g)) {
                    const extra = path.join(m[1], 'steamapps');
                    if (fs.existsSync(extra)) dirs.add(extra);
                }
            }
        } catch (e) {}
    }
    return [...dirs];
}

// How a Steam game is started here. Stored in the library as a launch command, so changing
// it changes existing rows too, see the LIKE '%steam://rungameid%' queries in the Manager.
function steamLaunchCommand(appId) { return `steam steam://rungameid/${appId} -silent`; }

// ── Other stores this host knows about ───────────────────────────────────────
// Flatpak: games installed outside GOG/Epic/Steam that still announce themselves through a
// desktop entry. Discovery only, reconciling the results against the library is the same
// work on every host, so it stays in shared-ipc.
const FLATPAK_GAME_CATS = new Set(['Game','ActionGame','ArcadeGame','BoardGame','CardGame',
    'KidsGame','LogicGame','RolePlaying','Shooter','Simulation','SportsGame','StrategyGame']);

function scanExtraStore() {
    const dirs = [
        '/var/lib/flatpak/exports/share/applications',
        path.join(HOME, '.local/share/flatpak/exports/share/applications'),
    ];
    const out = [];
    const seen = new Set();
    for (const dir of dirs) {
        let files;
        try { files = fs.readdirSync(dir).filter(f => f.endsWith('.desktop')); }
        catch { continue; }
        for (const file of files) {
            let content;
            try { content = fs.readFileSync(path.join(dir, file), 'utf8'); }
            catch { continue; }
            let name = '', cats = '', icon = '';
            for (const line of content.split('\n')) {
                if (line.startsWith('Name=')       && !name) name = line.slice(5).trim();
                if (line.startsWith('Categories=') && !cats) cats = line.slice(11).trim();
                if (line.startsWith('Icon=')       && !icon) icon = line.slice(5).trim();
            }
            if (!cats.split(';').map(c => c.trim()).some(c => FLATPAK_GAME_CATS.has(c))) continue;
            const appId = file.slice(0, -8);
            const launchCmd = `flatpak run ${appId}`;
            if (seen.has(launchCmd)) continue;
            seen.add(launchCmd);
            out.push({ name: name || appId, launchCmd, icon: icon || appId });
        }
    }
    return out;
}

function findExtraStoreIcon(iconName) {
    const bases = [
        path.join(HOME, '.local/share/flatpak/exports/share/icons/hicolor'),
        '/var/lib/flatpak/exports/share/icons/hicolor',
    ];
    const sizes = ['512x512', '256x256', '192x192', '128x128'];
    for (const base of bases) {
        for (const size of sizes) {
            const p = path.join(base, size, 'apps', iconName + '.png');
            if (fs.existsSync(p)) return p;
        }
        const svg = path.join(base, 'scalable', 'apps', iconName + '.svg');
        if (fs.existsSync(svg)) return svg;
    }
    return null;
}

const extraStore = { supported: true, label: 'Flatpak', scan: scanExtraStore, findIcon: findExtraStoreIcon };

// ── Store platform identifiers ───────────────────────────────────────────────
// What this host calls itself in the places a platform name is data rather than code:
// the `games.platform` column, GOG's `os` field, and the two downloaders' CLI flags.
const nativeOsKey       = 'linux';     // games.platform / GOG installer `os`
const gogdlPlatform     = 'linux';     // gogdl --platform {windows,osx,linux}
const legendaryPlatform = 'Windows';   // legendary --platform {Windows,Win32,Mac}

// ── Native game launch + install detection ───────────────────────────────────
// Returns the spawn spec for a game built for this host. The chmod is a side effect on
// purpose: gogdl does not preserve the executable bit, so without it a perfectly good
// native install simply refuses to start.
function launchNative({ exe, args = [] }) {
    try { fs.chmodSync(exe, '755'); } catch {}
    return { cmd: exe, args: [...args], env: {} };
}

function findNativeGameExe(gameDir) {
    const folderName = path.basename(gameDir).toLowerCase();
    try {
        const entries = fs.readdirSync(gameDir);
        // 1. .sh launcher at root
        const sh = entries.find(e => e.toLowerCase().endsWith('.sh') && !e.toLowerCase().startsWith('uninstall'));
        if (sh) return sh;
        // 2. Executable binary matching the folder name
        for (const e of entries) {
            if (e.toLowerCase() === folderName || e.toLowerCase() === folderName.replace(/ /g, '_')) {
                const full = path.join(gameDir, e);
                try { if (fs.statSync(full).mode & 0o111) return e; } catch {}
            }
        }
        // 3. Any executable binary (no extension) at root
        for (const e of entries) {
            if (e.includes('.')) continue;
            const full = path.join(gameDir, e);
            try { if (fs.statSync(full).isFile() && (fs.statSync(full).mode & 0o111)) return e; } catch {}
        }
    } catch {}
    return null;
}

// Is `gameDir` a native install of `appId`? gogdl writes .gogdl-linux-manifest after a
// successful Linux install and creates no .info file, so the manifest is the marker.
//
// Guard: verify this directory belongs to the right game so that a previously-installed
// Linux game in the same parent folder is never mistaken for the newly-installed one.
// null = not this game's native install; the caller moves on to the next directory.
function findNativeInstallResult(gameDir, appId, preExistingDirs = null) {
    const linuxManifest = path.join(gameDir, '.gogdl-linux-manifest');
    if (!fs.existsSync(linuxManifest)) return null;
    // Primary check: gogdl writes a plain-text "gameinfo" file whose lines include the
    // numeric appId, fast and reliable.
    try {
        const lines = fs.readFileSync(path.join(gameDir, 'gameinfo'), 'utf8')
            .split('\n').map(l => l.trim());
        if (!lines.includes(String(appId))) return null;
    } catch {
        // gameinfo absent, fall back to the pre-install snapshot: skip any directory
        // that already existed before this install.
        if (preExistingDirs?.has(path.basename(gameDir))) return null;
    }
    return { install_path: gameDir, executable: findNativeGameExe(gameDir) };
}

// ── DOSBox for GOG's DOS games ───────────────────────────────────────────────
// GOG ships a Windows DOSBox 0.74 from 2010 and runs it through Proton: an emulator inside
// a translation layer, when the host can run the emulator directly. A native build is
// faster, gets working sound and fullscreen without Proton's help, and is still maintained.
//
// dosbox-staging is preferred: it is the actively maintained fork and the one distributions
// package today. Plain dosbox and dosbox-x are accepted too.
const DOSBOX_BINARIES = ['dosbox-staging', 'dosbox', 'dosbox-x'];

// Flatpak is the one way to get DOSBox that works on every distribution, so it is worth
// finding too, otherwise someone who installed it that way is told they have none.
const DOSBOX_FLATPAKS = ['io.github.dosbox-staging', 'com.dosbox_x.DOSBox-X'];

// { cmd, args, label } or null. args is non-empty only for the flatpak form.
let _dosboxCache;
function findDosbox() {
    if (_dosboxCache !== undefined) return _dosboxCache;
    _dosboxCache = null;
    for (const b of DOSBOX_BINARIES) {
        const p = which(b);
        if (p) { _dosboxCache = { cmd: p, args: [], label: path.basename(p) }; return _dosboxCache; }
    }
    const flatpak = which('flatpak');
    if (flatpak) {
        for (const id of DOSBOX_FLATPAKS) {
            try {
                const r = spawnSync(flatpak, ['info', id], { encoding: 'utf8', timeout: 4000 });
                if (r.status === 0) { _dosboxCache = { cmd: flatpak, args: ['run', id], label: id }; return _dosboxCache; }
            } catch {}
        }
    }
    return _dosboxCache;
}

// How to get one, in the words of the user's own distribution. Flatpak is always offered
// alongside, because it is the single instruction that works everywhere.
function dosboxInstallHint() {
    let id = '', like = '';
    try {
        const osr = fs.readFileSync('/etc/os-release', 'utf8');
        id   = (osr.match(/^ID=(.*)$/m)      || [, ''])[1].replace(/"/g, '').trim().toLowerCase();
        like = (osr.match(/^ID_LIKE=(.*)$/m) || [, ''])[1].replace(/"/g, '').trim().toLowerCase();
    } catch {}
    const is = (...names) => names.some(n => id === n || like.split(/\s+/).includes(n));
    const native =
        is('fedora', 'rhel', 'centos')  ? 'sudo dnf install dosbox-staging'
      : is('debian', 'ubuntu')          ? 'sudo apt install dosbox-staging'
      : is('arch')                      ? 'sudo pacman -S dosbox-staging'
      : is('opensuse', 'suse')          ? 'sudo zypper install dosbox-staging'
      : is('alpine')                    ? 'sudo apk add dosbox-staging'
      : '';
    return { native, flatpak: 'flatpak install flathub io.github.dosbox-staging' };
}

// Translate GOG's Windows DOSBox invocation for a native binary. Run from the same working
// directory, so the relative -conf paths and the config's own `mount C ".."` still resolve.
//   • backslashes → forward slashes, so ..\game.conf finds the file on Linux
//   • -noconsole is dropped: it exists only to hide a Windows console window, and a native
//     build rejects the unknown option outright
function translateDosboxArgs(gogArgs) {
    const out = [];
    for (let i = 0; i < gogArgs.length; i++) {
        const a = gogArgs[i];
        if (a === '-noconsole') continue;
        if (a === '-conf' && gogArgs[i + 1] !== undefined) {
            out.push('-conf', gogArgs[++i].replace(/\\/g, '/'));
            continue;
        }
        out.push(a);
    }
    return out;
}

const dosbox = { find: findDosbox, installHint: dosboxInstallHint, translateArgs: translateDosboxArgs };

// ═════════════════════════════════════════════════════════════════════════════
// Windows-game runtime: Proton via umu-run, with bare wine as the last resort.
// ═════════════════════════════════════════════════════════════════════════════

let _umu = null, _wine = null;

function findUmu() {
    if (_umu !== null) return _umu;
    _umu = which('umu-run') || '';
    return _umu || null;
}
function findWineCached() {
    if (_wine !== null) return _wine;
    _wine = which('wine') || '';
    return _wine || null;
}

// ── Proton runtime discovery ─────────────────────────────────────────────────
// Every face resolves Proton through here, and we ALWAYS hand umu-run an explicit
// PROTONPATH rather than letting it find its own. Two reasons, both of which showed up as a
// game that "launched" and then did absolutely nothing:
//   1. umu's own discovery (umu_proton.py `_get_from_compat`) keeps only folders whose name
//      `startswith("GE-Proton")` or `("UMU-Proton")`. A perfectly good build installed under
//      any other name, e.g. "Proton-GE Latest", which is what ProtonUp-Qt writes, is
//      invisible to it, so PROTONPATH stays empty and umu exits 1 immediately with
//      `FileNotFoundError: Environment variable not set or is empty: PROTONPATH`.
//   2. With nothing installed at all, umu tries to *download* GE-Proton, hundreds of MB with
//      no progress anywhere in our UI, and a hard failure when the machine is offline.
// Resolving it ourselves also means we can tell the user what's wrong (NO_PROTON below).
const PROTON_SEARCH_DIRS = () => [
    // Steam's own Proton builds
    path.join(HOME, '.steam', 'root', 'steamapps', 'common'),
    path.join(HOME, '.steam', 'steam', 'steamapps', 'common'),
    path.join(HOME, '.local', 'share', 'Steam', 'steamapps', 'common'),
    // GE-Proton and other custom compatibility tools
    path.join(HOME, '.steam', 'root', 'compatibilitytools.d'),
    path.join(HOME, '.steam', 'steam', 'compatibilitytools.d'),
    path.join(HOME, '.local', 'share', 'Steam', 'compatibilitytools.d'),
    // umu's own store, used when no Steam install exists
    path.join(HOME, '.local', 'share', 'umu', 'compatibilitytools'),
    // Flatpak Steam
    path.join(HOME, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam', 'steamapps', 'common'),
    path.join(HOME, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam', 'compatibilitytools.d'),
];

// Is this directory an actual Proton build we can hand to umu? The `proton` launcher script is
// the test that matters: `toolmanifest.vdf` alone also matches Steam's runtime containers
// (SteamLinuxRuntime_*), which are not Proton and would poison the "best available" pick.
function isProtonDir(dir) {
    try { return fs.existsSync(path.join(dir, 'proton')); }
    catch { return false; }
}

// All Proton builds on the machine, best first: GE-Proton, then Steam's, then anything else;
// newest within each group. Named folders are matched loosely on purpose, the *contents*
// decide what counts, not the folder name (that is exactly what umu gets wrong).
function scanRuntimes() {
    const found = [];
    const seen  = new Set();
    for (const dir of PROTON_SEARCH_DIRS()) {
        if (!fs.existsSync(dir)) continue;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { continue; }
        for (const entry of entries) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            const fullPath = path.join(dir, entry.name);
            // Resolve symlinks so ~/.steam/root, ~/.steam/steam and ~/.local/share/Steam
            // (all the same place) don't yield duplicates.
            const realPath = (() => { try { return fs.realpathSync(fullPath); } catch { return fullPath; } })();
            if (seen.has(realPath) || !isProtonDir(realPath)) continue;
            seen.add(realPath);
            const name = entry.name;
            let type = 'other';
            if (/GE-Proton|Proton-GE|UMU-Proton/i.test(name)) type = 'ge';
            else if (/^Proton/i.test(name))                   type = 'steam';
            // A folder called "Proton-GE Latest" says nothing about which build it holds;
            // GE ships the real version in `version` ("<epoch> GE-Proton11-3"), so prefer that
            // for ordering and for anything we show the user.
            let version = '';
            try { version = (fs.readFileSync(path.join(realPath, 'version'), 'utf8').trim().split(/\s+/).pop() || ''); } catch {}
            found.push({ name, path: realPath, type, version, label: version || name, managed: isManagedDir(realPath) });
        }
    }
    const order = { ge: 0, steam: 1, other: 2 };
    return found.sort((a, b) => {
        const to = (order[a.type] ?? 2) - (order[b.type] ?? 2);
        if (to !== 0) return to;
        return b.label.localeCompare(a.label, undefined, { numeric: true, sensitivity: 'base' });
    });
}

// The Proton a given game should run with: its own override, then the configured default,
// then the best one found on disk. Configured paths are existence-checked, a `proton_path`
// left over from a build the user has since deleted is another way to end up launching
// nothing at all.
function resolveRuntime(game) {
    const usable = p => { const e = expandTilde(p || ''); return e && isProtonDir(e) ? e : ''; };
    const own = usable(game?.proton_path);
    if (own) return own;
    let configured = '';
    try { configured = getDb()?.prepare("SELECT value FROM settings WHERE key='default_proton_path'").get()?.value || ''; } catch {}
    const def = usable(configured);
    if (def) return def;
    return scanRuntimes()[0]?.path || '';
}

// Does this machine have a usable Vulkan driver? The loader library alone proves nothing,
// distributions ship it as a dependency of things that never use it, so the test is whether
// any ICD (installable client driver) is registered. That is exactly what DXVK needs to find.
//
// Locations are the Vulkan loader's own search path, so this works on any distribution rather
// than the handful we happen to have seen. VK_DRIVER_FILES / VK_ICD_FILENAMES override it all,
// and are honoured first for the same reason the CA-bundle code honours a user's own setting.
//
// Cached: it cannot change while the app is running, and it is consulted from a failure path.
let _vulkanCache = null;
function hasVulkan() {
    if (_vulkanCache !== null) return _vulkanCache;
    const hit = (() => {
        for (const v of ['VK_DRIVER_FILES', 'VK_ICD_FILENAMES']) {
            const val = process.env[v];
            if (val) return val.split(':').some(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });
        }
        const dirs = [
            '/usr/share/vulkan/icd.d', '/usr/local/share/vulkan/icd.d', '/etc/vulkan/icd.d',
            path.join(process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share'), 'vulkan', 'icd.d'),
        ];
        for (const d of dirs) {
            try { if (fs.readdirSync(d).some(f => f.endsWith('.json'))) return true; } catch {}
        }
        return false;
    })();
    _vulkanCache = hit;
    return hit;
}

// Turn a dead game's output into something a person can act on. Anything we don't recognise
// stays UNKNOWN, the face shows the log tail rather than inventing a cause.
function diagnose(log, protonPath) {
    const t = String(log || '');
    if (/PROTONPATH/i.test(t) && /not set or is empty|FileNotFoundError/i.test(t))
        return { code: 'NO_PROTON', message: 'No Proton build was available to run this Windows game.' };
    if (/umu-run|umu_run\.py/i.test(t) && /Traceback/i.test(t))
        return { code: 'UMU_FAILED', message: 'umu-run could not start the game.' };
    if (/command not found|No such file or directory/i.test(t) && !protonPath)
        return { code: 'MISSING_RUNTIME', message: 'The compatibility runtime is missing.' };
    if (/wine: cannot find|is not a valid Win32|Bad EXE format/i.test(t))
        return { code: 'BAD_EXE', message: 'The game executable could not be run by Proton/Wine.' };

    // The same missing-Vulkan cause, but from a game that got far enough to install its own
    // crash handler. DOOM + DOOM II dies with an access violation inside dxgi.dll at a null
    // pointer, DXVK could not create a device, handed back nothing, and the game dereferenced
    // it. Recognising the module name is what turns "the game crashed, see CRASHLOG.TXT" into
    // an answer, since that file is written by the game and the app never reads it.
    if (/dxgi\.dll|d3d11\.dll|dxvk/i.test(t) && /Access Violation|0xc0000005|Exception/i.test(t))
        return hasVulkan()
            ? { code: 'D3D_CRASH', message:
                'The game crashed inside the Direct3D layer. This machine does have a Vulkan driver, so ' +
                'it is not the usual missing-Vulkan cause, more often a driver problem or a game that ' +
                'needs a specific Proton build. PROTON_USE_WINED3D=1 forces the OpenGL path and is worth ' +
                'trying under the game\'s own environment variables.' }
            : { code: 'NO_VULKAN', message:
                'The game crashed inside the Direct3D layer. On a GPU with no Vulkan support that is ' +
                'expected, Proton renders Direct3D through DXVK, which requires it. Setting ' +
                'PROTON_USE_WINED3D=1 for this game switches to OpenGL and often works on older hardware.' };

    // The game had a display and lost it, which is a different failure from never having had
    // one. On a Wayland session that is XWayland going away underneath the game. It is emitted
    // by the X client itself, so it is evidence about the display connection and nothing else,
    // in particular it is NOT a GPU capability problem, and PROTON_USE_WINED3D will not touch it.
    // This used to be swallowed by the catch-all below and reported as missing Vulkan.
    if (/X connection to :\d+ broken/i.test(t))
        return { code: 'DISPLAY_LOST', message:
            'The game lost its connection to the X server and stopped. On a Wayland desktop that means ' +
            'XWayland ended underneath it. This is not a graphics-capability problem, forcing OpenGL ' +
            'will not help. Try launching it again; if it repeats, run the game with the log open and ' +
            'check whether XWayland is restarting.' };

    // ⚠️ No Vulkan on this GPU. Proton translates Direct3D through DXVK, which is Vulkan-only,
    // so on hardware that predates Vulkan the game dies instantly with nothing useful in the
    // log, Proton gets as far as "fsync: up and running" and stops. Diagnosed on a 2011 Mac
    // (Intel HD 3000 / Radeon HD 6750M): neither GPU is supported by Mesa's Vulkan drivers,
    // and the identical launch succeeded with PROTON_USE_WINED3D=1, which uses OpenGL instead.
    //
    // Matched on Proton having started and then produced no graphics output at all, which is
    // what makes this case recognisable: a real crash leaves an error, this leaves silence.
    //
    // ⚠️ Two corrections, both of which made this fire far too widely:
    //
    //  1. `Proton: Error` was a trigger, but "Proton: Error: unable to use parent for game
    //     drive, path /home" is printed for ANY game living under /home/<user>/…, which is
    //     nearly every install. It appears verbatim in a launch that SUCCEEDED. It is noise,
    //     not evidence, so it no longer counts.
    //  2. `fsync: up and running` appears in every Proton launch there is, so what remains is
    //     still only "Proton started and said nothing else". That is too weak to assert a
    //     hardware limitation from, and asserting it told an RTX 4060 Ti its GPU was too old.
    //     The claim is now checked against the host's own Vulkan drivers first; when Vulkan is
    //     present we fall through to the log tail rather than inventing a cause, which is this
    //     function's stated rule everywhere else.
    if (!hasVulkan() && /fsync: up and running/i.test(t) && !/vulkan|dxvk|d3d11|opengl|wined3d/i.test(t))
        return { code: 'NO_VULKAN', message:
            'The game started and closed immediately with no graphics output. The usual cause is a ' +
            'GPU with no Vulkan support, Proton renders Direct3D through DXVK, which requires it. ' +
            'Setting PROTON_USE_WINED3D=1 for this game switches to OpenGL and often works on older ' +
            'hardware. Add it under the game\'s own environment variables.' };

    // Proton Experimental ships Xalia, an accessibility helper that aborts the launch when SDL
    // cannot open a display. It is a symptom rather than a cause, but naming it saves the next
    // person searching a stack trace that has nothing to do with their game.
    if (/Xalia/i.test(t) && /No displays available/i.test(t))
        return { code: 'XALIA_NO_DISPLAY', message:
            'Proton\'s accessibility helper (Xalia) could not open a display and stopped the launch. ' +
            'PROTON_USE_XALIA=0 disables it. If the game still fails afterwards, the real cause is ' +
            'elsewhere, most often a GPU without Vulkan support.' };

    return { code: 'UNKNOWN', message: 'The game closed immediately after starting.' };
}

// ── First-launch progress ────────────────────────────────────────────────────
// The first Windows game on a machine doesn't start for minutes: umu downloads the steamrt
// runtime (several hundred MB) and Proton then builds the game's Wine prefix. Every new game
// pays the prefix cost again.
//
// Phases are matched against umu's real output. Percentages are step markers, not byte counts:
// umu prints no percentage, so the honest live signal during the big download is the growing
// `.parts` file, reported as MB in the message.
const STARTUP_STEPS = [
    { re: /Setting up Unified Launcher/i,                    phase: 'setup',    percent: 5,   message: 'Preparing the compatibility layer…' },
    { re: /Downloading steamrt|Downloading SteamLinuxRuntime/i, phase: 'runtime', percent: 15, message: 'Downloading the compatibility runtime, one-time setup, this takes a few minutes.' },
    { re: /SHA256 is OK/i,                                   phase: 'verify',   percent: 45,  message: 'Checking the download…' },
    { re: /Verifying integrity of/i,                         phase: 'verify',   percent: 50,  message: 'Verifying the runtime…' },
    { re: /mtree is OK|Using steamrt/i,                      phase: 'ready',    percent: 60,  message: 'Compatibility runtime ready.' },
    // protonfixes runs on every launch and lands BEFORE the prefix build in umu's output, so it
    // sits below `prefix` here, percentages are clamped monotonic and must not walk backwards.
    { re: /Running protonfixes|Running checks/i,             phase: 'fixes',    percent: 70,  message: 'Applying compatibility fixes…' },
    // "Upgrading prefix" is printed only when the prefix is new or the Proton build changed,
    // deliberately NOT matching generic wine startup chatter, which would show the panel on
    // every ordinary launch.
    { re: /Upgrading prefix from|Creating prefix/i,          phase: 'prefix',   percent: 80,  message: "Setting up this game's Windows environment…" },
    { re: /Downloading upscaler file|Downloading .* dll/i,   phase: 'extras',   percent: 88,  message: 'Downloading graphics components…' },
    { re: /Executable is a unix path|^Proton: \//im,         phase: 'starting', percent: 95,  message: 'Starting the game…' },
    { re: /ntsync: up and running|wineserver: created/i,     phase: 'running',  percent: 100, message: 'Running.' },
];

// Bytes fetched so far by umu's resumable download (`<archive>.<buildid>.parts`, written under
// a temp dir in XDG_CACHE_HOME/umu). Best-effort: no file → no counter, just the phase text.
function setupBytes() {
    const cacheRoot = path.join(process.env.XDG_CACHE_HOME || path.join(HOME, '.cache'), 'umu');
    let total = 0;
    const walk = (dir, depth) => {
        if (depth > 2) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const en of entries) {
            const p = path.join(dir, en.name);
            if (en.isDirectory()) walk(p, depth + 1);
            else if (en.name.endsWith('.parts')) { try { total += fs.statSync(p).size; } catch {} }
        }
    };
    walk(cacheRoot, 0);
    return total;
}

// Thrown before we spawn anything, so the faces can offer to install Proton instead of
// letting umu fail invisibly.
function unavailableError() {
    const err = new Error(
        'No Proton build found. Windows games need Proton (GE-Proton is recommended), ' +
        'install one from the Control Panel, or point Clarity at an existing build.');
    err.code = 'NO_PROTON';
    return err;
}

// Locate BattlEye or EAC runtime: Installer's own copy first, then common Steam locations
function findAntiCheatRuntime(name) {
    const steamName = name === 'battleye_runtime' ? 'Battleye AntiCheat' : 'EasyAntiCheat';
    return [
        path.join(configDir, 'runtimes', name),
        path.join(HOME, '.steam', 'root', 'steamapps', 'common', steamName),
        path.join(HOME, '.local', 'share', 'Steam', 'steamapps', 'common', steamName),
        path.join(HOME, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam', 'steamapps', 'common', steamName),
    ].find(p => fs.existsSync(p)) || null;
}

// Is a compatibility layer going to be involved at all? Decides both the compat env vars
// and whether a game's own shipped wrapper DLLs need an override to be seen.
function inUse(runtimePath) { return !!(runtimePath || findUmu()); }

// Whether *anything* can run a Windows executable here.
function canRun(runtimePath) { return !!(runtimePath || findWineCached()); }

// Compat env vars, mirrors Heroic's launcher.ts logic exactly
function compatEnv(game, runtimePath) {
    const env = {};
    if (inUse(runtimePath)) {
        if (!game.use_esync)     env.PROTON_NO_ESYNC = '1';
        if (!game.use_fsync)     env.PROTON_NO_FSYNC = '1';
        if (game.use_dxvk_nvapi) { env.PROTON_ENABLE_NVAPI = '1'; env.DXVK_NVAPI_ALLOW_OTHER_DRIVERS = '1'; }
    } else {
        if (game.use_esync !== 0) env.WINEESYNC = '1';
        if (game.use_fsync !== 0) env.WINEFSYNC = '1';
        if (game.use_dxvk_nvapi) { env.DXVK_ENABLE_NVAPI = '1'; env.DXVK_NVAPI_ALLOW_OTHER_DRIVERS = '1'; }
    }
    if (game.use_battleye) { const p = findAntiCheatRuntime('battleye_runtime'); if (p) env.PROTON_BATTLEYE_RUNTIME = p; }
    if (game.use_eac)      { const p = findAntiCheatRuntime('eac_runtime');       if (p) env.PROTON_EAC_RUNTIME      = p; }
    return env;
}

// A host path as the runtime sees it. Z: maps to the filesystem root under Wine, and .bat
// files must be launched via that Windows path, Proton/wine can't run .bat from a raw
// Linux path. The same form is what registry values have to carry.
function toWindowsPath(p) { return ('Z:' + p).replace(/\//g, '\\'); }

// Refuse a launch that is guaranteed to die in silence. Bare wine stays reachable only where
// it is genuinely the sole option, with umu-run installed, Proton is the supported path and
// quietly dropping to wine (no DXVK, no Proton patches) just trades a visible failure for a
// mysterious one.
function assertAvailable(runtimePath) {
    if (!runtimePath && (findUmu() || !findWineCached())) throw unavailableError();
}

// The spawn spec for one Windows game. `env` is the EXTRA environment only, the caller
// merges it over its own base (system → per-game custom vars → compat flags).
function buildLaunch({ game, gameId, launchExe, isBat, userArgs, allArgs, runtimePath, prefix }) {
    const umu = findUmu();
    const gameid = game.app_id || `installer-${gameId}`;

    // Epic titles are launched with the user's own arguments only, legendary owns the rest.
    if (game.store === 'epic' && umu && runtimePath) {
        return { cmd: umu, args: [launchExe, ...userArgs],
                 env: { WINEPREFIX: prefix, PROTONPATH: runtimePath, GAMEID: gameid },
                 method: 'umu-run' };
    }

    if (umu && runtimePath) {
        return { cmd: umu, args: [launchExe, ...allArgs],
                 env: { WINEPREFIX: prefix, PROTONPATH: runtimePath, GAMEID: gameid },
                 method: isBat ? 'umu-run-bat' : 'umu-run' };
    }

    if (runtimePath) {
        const steamRoot = which('steam') ? path.dirname(which('steam')) : path.join(HOME, '.steam', 'root');
        const protonBin = path.join(runtimePath, 'proton');
        if (!fs.existsSync(protonBin)) throw new Error(`proton script not found in ${runtimePath}`);
        return { cmd: protonBin, args: ['run', launchExe, ...allArgs],
                 env: { WINEPREFIX: prefix, STEAM_COMPAT_DATA_PATH: prefix, STEAM_COMPAT_CLIENT_INSTALL_PATH: steamRoot },
                 method: isBat ? 'proton-bat' : 'proton-direct' };
    }

    const wine = findWineCached();
    if (!wine) throw new Error('No launch method: umu-run not found, no Proton path set, wine not installed.');
    return { cmd: wine, args: [launchExe, ...allArgs], env: { WINEPREFIX: prefix }, method: 'wine' };
}

// The spawn spec for one redistributable installer. Unlike buildLaunch this returns the
// COMPLETE env, because redists are run standalone rather than under a game's own base.
function buildRedistLaunch({ exePath, exeArgs, prefix, runtimePath }) {
    const umu = findUmu();
    const steamRoot = path.join(HOME, '.steam', 'root');
    const env = { ...process.env, WINEPREFIX: prefix, STEAM_COMPAT_DATA_PATH: prefix,
                  STEAM_COMPAT_CLIENT_INSTALL_PATH: steamRoot, GAMEID: 'umu-0', PROTON_VERB: 'run' };
    if (runtimePath) env.PROTONPATH = runtimePath;

    if (umu && runtimePath) return { cmd: umu, args: [exePath, ...exeArgs], env, method: 'umu-run' };
    if (runtimePath)        return { cmd: path.join(runtimePath, 'proton'), args: ['run', exePath, ...exeArgs], env, method: 'proton-direct' };
    delete env.PROTONPATH;
    return { cmd: findWineCached(), args: [exePath, ...exeArgs], env, method: 'wine' };
}

const REDIST_UNAVAILABLE_MESSAGE =
    'No Proton version configured and Wine not found. Set a default Proton in Settings.';

// Merge a .reg file into a prefix. Proton's own wine is preferred; it runs outside umu's
// container, which is what lets regedit read a file from the host's /tmp at all.
function regeditCommand({ prefix, runtimePath, regFile }) {
    let wineBin = 'wine';
    if (runtimePath) {
        const candidates = [
            path.join(runtimePath, 'files', 'bin', 'wine64'),
            path.join(runtimePath, 'files', 'bin', 'wine'),
        ];
        for (const c of candidates) {
            if (fs.existsSync(c)) { wineBin = c; break; }
        }
    }
    return {
        cmd: wineBin,
        args: ['regedit', '/S', regFile],
        env: { ...process.env, WINEPREFIX: prefix, WINEDEBUG: '-all' },
    };
}

// ── Installing and removing runtimes ─────────────────────────────────────────
// GE-Proton, fetched from its GitHub releases. Both faces used to carry their own copy of
// this; they had drifted (one handled .tar.xz and knew about umu's store, the other did
// not), which is exactly the kind of divergence a host boundary is supposed to end.
const GE_REPO = 'GloriousEggroll/proton-ge-custom';

// Where a downloaded build goes. First existing wins; umu's own store is last because it
// only matters on a machine with no Steam at all. All of them are scanned by scanRuntimes,
// so any of them works for launching.
function installDirs() {
    return [
        path.join(HOME, '.steam', 'root', 'compatibilitytools.d'),
        path.join(HOME, '.local', 'share', 'Steam', 'compatibilitytools.d'),
        path.join(HOME, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam', 'compatibilitytools.d'),
        path.join(HOME, '.local', 'share', 'umu', 'compatibilitytools'),
    ];
}

function resolveInstallDir() {
    const dirs = installDirs();
    const base = dirs.find(d => fs.existsSync(d)) || dirs[1];
    fs.mkdirSync(base, { recursive: true });
    return base;
}

// Everywhere a build may legitimately be removed from. Deliberately a superset of
// installDirs(): the two faces used to keep their own lists and they disagreed, one allowed
// ~/.steam/steam/compatibilitytools.d but not umu's store, the other the reverse. Taking the
// union means nothing that used to be removable stopped being removable, and the one location
// we install into that was previously un-removable no longer strands a build there.
function managedDirs() {
    return [...installDirs(), path.join(HOME, '.steam', 'steam', 'compatibilitytools.d')];
}

// Delete safety. Symlinks are resolved on both sides, ~/.steam/root and ~/.local/share/Steam
// are usually the same place, and a path that arrived by one name must still match a base
// named the other.
function isManagedDir(dirPath) {
    const resolved = (() => { try { return fs.realpathSync(expandTilde(dirPath)); } catch { return expandTilde(dirPath); } })();
    const bases = managedDirs().map(b => { try { return fs.realpathSync(b); } catch { return b; } });
    return bases.some(base => resolved.startsWith(base + path.sep));
}

function removeRuntime(dirPath) {
    if (!isManagedDir(dirPath)) return { ok: false, error: 'Refusing to delete, path is not inside compatibilitytools.d.' };
    const resolved = (() => { try { return fs.realpathSync(expandTilde(dirPath)); } catch { return expandTilde(dirPath); } })();
    try { fs.rmSync(resolved, { recursive: true, force: true }); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
}

function ghJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Clarity' } }, res => {
            if (res.statusCode !== 200) { res.resume(); reject(new Error(`GitHub returned ${res.statusCode}`)); return; }
            let data = ''; res.on('data', d => data += d);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON from GitHub')); } });
        }).on('error', reject);
    });
}

// The archive to actually fetch out of a release. aarch64 builds are excluded: this is the
// x86-64 host backend, and handing umu an ARM Proton is a silent failure later.
function pickAsset(release) {
    return (release.assets || []).find(a => /\.tar\.(gz|xz)$/.test(a.name) && !/aarch64/i.test(a.name)) || null;
}

async function listReleases(limit = 15) {
    try {
        const raw = await ghJson(`https://api.github.com/repos/${GE_REPO}/releases?per_page=${limit}`);
        return { ok: true, releases: raw.map(r => {
            const asset = pickAsset(r);
            if (!asset) return null;
            return { tag: r.tag_name, name: r.name || r.tag_name, date: (r.published_at || '').split('T')[0],
                     size: asset.size, url: asset.browser_download_url, assetName: asset.name };
        }).filter(Boolean) };
    } catch (e) { return { ok: false, error: e.message, releases: [] }; }
}

async function latestRelease() {
    try {
        const r = await ghJson(`https://api.github.com/repos/${GE_REPO}/releases/latest`);
        const asset = pickAsset(r);
        if (!asset) return { ok: false, error: 'No release archive found.' };
        return { ok: true, release: { tag: r.tag_name, name: r.name || r.tag_name, size: asset.size,
                                      url: asset.browser_download_url, assetName: asset.name } };
    } catch (e) { return { ok: false, error: `Could not reach GitHub: ${e.message}` }; }
}

let _dlReq = null;
function cancelInstall() {
    if (_dlReq) { try { _dlReq.destroy(); } catch {} _dlReq = null; return true; }
    return false;
}

// Download + unpack one release. onProgress({ phase, percent, message }).
//
// The archive lands in the install directory, not os.tmpdir(): /tmp is tmpfs on most
// modern distributions, and these builds unpack to well over a gigabyte, staging that in
// RAM is a bad trade when the destination filesystem is right there. It also means the
// extraction never crosses a filesystem boundary.
async function installRelease({ release, onProgress } = {}) {
    const send = typeof onProgress === 'function' ? onProgress : () => {};
    if (!release || !release.url) return { ok: false, error: 'No release to install.' };

    let installBase;
    try { installBase = resolveInstallDir(); }
    catch (e) { return { ok: false, error: `Cannot create the install directory: ${e.message}` }; }

    const name = release.assetName
        || (() => { try { return path.basename(new URL(release.url).pathname); } catch { return ''; } })()
        || `${release.tag || 'proton'}.tar.gz`;
    const tmpFile = path.join(installBase, '.' + name + '.part');

    send({ phase: 'downloading', percent: 0, message: `Downloading ${release.tag || 'the runtime'}…` });
    const dl = await new Promise(resolve => {
        function get(url, redirects = 0) {
            if (redirects > 5) { resolve({ ok: false, error: 'Too many redirects.' }); return; }
            _dlReq = https.get(url, { headers: { 'User-Agent': 'Clarity' } }, res => {
                if (res.statusCode === 301 || res.statusCode === 302) { res.resume(); get(res.headers.location, redirects + 1); return; }
                if (res.statusCode !== 200) { res.resume(); resolve({ ok: false, error: `Download failed (HTTP ${res.statusCode}).` }); return; }
                const total = parseInt(res.headers['content-length'] || '0', 10);
                let got = 0;
                const out = fs.createWriteStream(tmpFile);
                res.on('data', c => {
                    got += c.length;
                    send({ phase: 'downloading', percent: total ? Math.round(got / total * 100) : 0,
                           message: `${(got / 1e6).toFixed(0)} MB${total ? ` / ${(total / 1e6).toFixed(0)} MB` : ''}` });
                });
                res.pipe(out);
                out.on('finish', () => resolve({ ok: true }));
                out.on('error', e => resolve({ ok: false, error: e.message }));
            });
            _dlReq.on('error', e => resolve({ ok: false, error: e.message }));
        }
        get(release.url);
    });
    _dlReq = null;
    if (!dl.ok) { try { fs.unlinkSync(tmpFile); } catch {} return { ok: false, error: dl.error || 'Download failed or cancelled.' }; }

    send({ phase: 'extracting', percent: 100, message: `Extracting ${release.tag || 'the runtime'}…` });
    const flag = name.endsWith('.xz') ? '-xJf' : '-xzf';
    const extracted = await new Promise(resolve => {
        const p = spawn('tar', [flag, tmpFile, '-C', installBase], { stdio: 'ignore' });
        p.on('close', code => resolve(code === 0));
        p.on('error', () => resolve(false));
    });
    try { fs.unlinkSync(tmpFile); } catch {}
    if (!extracted) return { ok: false, error: 'Could not extract the archive (is `tar` installed?).' };

    send({ phase: 'done', percent: 100, message: `${release.tag || 'The runtime'} installed to ${installBase}` });
    return { ok: true, installBase };
}

const management = {
    supported: true,
    label: 'GE-Proton',
    installDirs, managedDirs, resolveInstallDir, isManagedDir,
    listReleases, latestRelease, install: installRelease,
    cancel: cancelInstall, remove: removeRuntime,
};

// The host tools a user might have to install themselves, for the External Tools panel.
// `key` is what the existing UI keys its dots off; a host with a different runner stack
// returns a different list and the panel follows it.
function runnerTools() {
    return [
        { key: 'umu',  label: 'umu-run', path: findUmu() || null, installable: true, optional: false,
          hint: 'not found, install via package manager for best compatibility. Direct Proton invocation is used as a fallback.' },
        { key: 'wine', label: 'wine',    path: findWineCached() || null, installable: false, optional: true,
          hint: 'not found (optional, only needed as last resort)' },
    ];
}

// Install the recommended runner. umu-launcher is a Python package, so pipx is preferred and
// pip --user is the fallback; neither existing is a dead end we can only explain.
function installRunner({ onProgress } = {}) {
    const send = typeof onProgress === 'function' ? onProgress : () => {};
    const pipx = which('pipx');
    const pip  = which('pip3') || which('pip');
    if (!pipx && !pip) {
        return Promise.resolve({ ok: false, error:
            'Neither pipx nor pip found. Install pipx first:\n  Fedora: sudo dnf install pipx\n' +
            '  Debian/Ubuntu: sudo apt install pipx\n  Arch: sudo pacman -S python-pipx' });
    }
    const cmd  = pipx || pip;
    const args = pipx ? ['install', 'umu-launcher'] : ['install', '--user', 'umu-launcher'];
    return new Promise(resolve => {
        const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        proc.stdout.on('data', d => send(String(d)));
        proc.stderr.on('data', d => send(String(d)));
        proc.on('close', code => resolve({ ok: code === 0, exitCode: code, method: pipx ? 'pipx' : 'pip --user' }));
        proc.on('error', err => resolve({ ok: false, error: err.message }));
    });
}

const runtime = {
    id: 'proton',
    management,
    tools: runnerTools,
    canInstallRunner: true,
    installRunner,
    prefixesDirName: 'prefixes',
    setupPhase: 'runtime',          // the STARTUP_STEPS phase whose byte counter is live
    scan: scanRuntimes,
    resolve: resolveRuntime,
    isRuntimeDir: isProtonDir,
    inUse, canRun, assertAvailable,
    compatEnv, buildLaunch, buildRedistLaunch, regeditCommand,
    toWindowsPath, diagnose, unavailableError,
    findAntiCheatRuntime,
    startupSteps: () => STARTUP_STEPS,
    setupBytes,
    redistUnavailableMessage: REDIST_UNAVAILABLE_MESSAGE,
    findUmu, findWine: findWineCached,
};

module.exports = {
    id: 'linux',
    init,
    binDirName, portableBaseDir, selfExecutable, selfSpawnArgs,
    installerDbCandidates, findInstallerDb, installerDbCreatePath,
    which, dirSizeBytesCommand, dirSizeHumanCommand, legendaryConfigDir,
    steamLibraryPaths, steamLaunchCommand, extraStore, desktop,
    nativeOsKey, gogdlPlatform, legendaryPlatform,
    launchNative, findNativeGameExe, findNativeInstallResult,
    dosbox,
    runtime,
};
