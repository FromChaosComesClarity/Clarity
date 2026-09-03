'use strict';
/*
 * @clarity/core — the macOS platform backend.
 *
 * Sibling to linux.js, same shape, picked up by platform/index.js the moment this file
 * exists. Phase B: paths, store identifiers, system inventory and desktop integration are
 * real. `runtime.*` (the Windows-game compatibility layer) is real too as of Phase E —
 * CrossOver, driven directly through its own `wine --bottle` CLI. See the runtime section
 * below for what was verified by hand before any of it was written, and
 * docs/mac-port-phase-a.md / docs/mac-port-handoff.md for the rest of the port's history.
 */

const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const { execSync, spawnSync, spawn } = require('child_process');

// ── Injected context ─────────────────────────────────────────────────────────
// Mirrors linux.js's init() idiom — see its comment.
let HOME       = os.homedir();
let configDir  = '';
let getDb      = () => null;
let expandTilde = p => (p && p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);

function init(ctx = {}) {
    HOME        = ctx.homeDir  || HOME;
    configDir   = ctx.configDir || configDir;
    if (typeof ctx.getDb === 'function')       getDb = ctx.getDb;
    if (typeof ctx.expandTilde === 'function') expandTilde = ctx.expandTilde;
}

// ── Paths ────────────────────────────────────────────────────────────────────
const binDirName = 'darwin-arm64';

// Not portable on macOS: an .app in /Applications cannot hold user data (and an unsigned
// dev build cannot reliably write beside itself either — see Trap 1 in the handoff). Every
// build, packaged or dev, keeps its data in the same per-user Library location.
function portableBaseDir() {
    return path.join(HOME, 'Library', 'Application Support', 'Clarity');
}

// There is no APPIMAGE equivalent. `process.execPath` is the real binary either way — inside
// the .app bundle when packaged, the Electron binary itself in dev.
function selfExecutable() { return process.execPath; }

// Electron sets `process.defaultApp` when running unpackaged (`electron .`); a packaged
// .app has no such flag and takes the face arguments directly, exactly like the AppImage.
function selfSpawnArgs(faceArgs, repoRoot) {
    return process.defaultApp ? [repoRoot, ...faceArgs] : [...faceArgs];
}

// library.db, in the order it should be looked for: the packaged app's own userData first,
// then the dev-tree config. Same two-entry split as Linux.
function installerDbCandidates(baseDir) {
    return [
        path.join(HOME, 'Library', 'Application Support', 'clarity-installer', 'library.db'),
        path.join(baseDir, 'InstallerConfig', 'library.db'),
    ];
}
function findInstallerDb(baseDir) {
    return installerDbCandidates(baseDir).find(p => fs.existsSync(p)) || null;
}

function installerDbCreatePath(baseDir, isPackaged) {
    return isPackaged
        ? path.join(HOME, 'Library', 'Application Support', 'clarity-installer', 'library.db')
        : path.join(baseDir, 'InstallerConfig', 'library.db');
}

// ── System inventory ─────────────────────────────────────────────────────────
// A Finder-launched .app has NO Homebrew in PATH (Trap 2) — `which` alone would report every
// Homebrew-installed tool as missing. Fall back to both Homebrew prefixes explicitly.
function which(bin) {
    try {
        const p = execSync(`which ${bin}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        if (p) return p;
    } catch {}
    for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) {
        const p = path.join(dir, bin);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// BSD du has no -B1 (that's GNU-only) — -sk reports 1K blocks everywhere, so multiply by
// 1024 ourselves instead of asking du for bytes it can't give.
function dirSizeBytesCommand(target) {
    return {
        cmd: `du -sk "${target}" 2>/dev/null`,
        parse: out => { const n = parseInt((String(out).split('\t')[0] || '').trim(), 10); return Number.isFinite(n) ? n * 1024 : null; },
    };
}
function dirSizeHumanCommand(target) {
    return { cmd: `du -sh "${target}" 2>/dev/null`, parse: out => String(out).split('\t')[0].trim() };
}

// Not ~/Library/Application Support — legendary is a cross-platform Python CLI that never
// adopted macOS's config conventions on its own; `legendary status` on this host reports its
// real config directory as ~/.config/legendary, same as Linux. runLegendary() never passes
// --config-folder, so this has to match what legendary actually uses, not what a well-behaved
// macOS app would use. (library.db is a different case: that's Electron's own userData for
// our own app.setName('installer') process, which does resolve correctly per-host on its own.)
function legendaryConfigDir() { return path.join(HOME, '.config', 'legendary'); }

// ── Desktop integration ──────────────────────────────────────────────────────
// canInstallMenuEntries is false — the .app bundle IS the menu entry, there is no separate
// launcher-file mechanism to install one into. The "install to menu" UI path is gated on
// this flag already. What's below still backs the per-game "add shortcut" path (desktop only
// on this host) and the Couch autostart toggle, both of which are called unconditionally.

function appsDir() { return null; } // no menu concept on this host; canInstallMenuEntries gates the caller

function desktopDir() { return path.join(HOME, 'Desktop'); }

// A double-clickable shell script, since a real .app bundle is more than a launcher can
// reasonably build on the fly. `.command` files are Finder-executable by convention.
function launcherFileName(id) { return `${id}.command`; }

// entry: { id, name, comment, exec, args[], icon, categories[], keywords[], wmClass, extraLines[] }
function launcherContent(entry) {
    const args = (entry.args || []).map(a => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
    const target = /\.app$/i.test(entry.exec)
        ? `open -n "${entry.exec}"${args ? ` --args ${args}` : ''}`
        : `"${entry.exec}"${args ? ` ${args}` : ''}`;
    return `#!/bin/bash\n# ${entry.name || entry.id}${entry.comment ? ' — ' + entry.comment : ''}\n${target}\n`;
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

// No menu database to poke — Finder picks up Desktop changes on its own.
function refreshMenu() {}

// No quarantine-style "trust this launcher" step for a locally-created file (a build made
// on this machine never gets the quarantine bit — see Phase B.5 in the handoff).
function markTrusted() {}

// Login Items via a LaunchAgent plist — the macOS equivalent of XDG autostart.
function autostartPath(id) { return path.join(HOME, 'Library', 'LaunchAgents', `com.clarity.${id}.plist`); }
function getAutostart(id)  { try { return fs.existsSync(autostartPath(id)); } catch { return false; } }
function setAutostart(id, enabled, entry) {
    const file = autostartPath(id);
    if (!enabled) { try { fs.unlinkSync(file); } catch {} return { ok: true, enabled: false }; }
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const args = [entry?.exec, ...(entry?.args || [])].filter(Boolean)
            .map(a => `    <string>${String(a).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`).join('\n');
        const plist = `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
            `<plist version="1.0"><dict>\n` +
            `  <key>Label</key><string>com.clarity.${id}</string>\n` +
            `  <key>ProgramArguments</key><array>\n${args}\n  </array>\n` +
            `  <key>RunAtLoad</key><true/>\n` +
            `</dict></plist>\n`;
        fs.writeFileSync(file, plist);
        try { spawn('launchctl', ['load', '-w', file], { stdio: 'ignore' }).unref(); } catch {}
        return { ok: true, enabled: true };
    } catch (e) { return { ok: false, error: e.message }; }
}

// Custom URL schemes (itch://, pico8-cart:) — `open` is macOS's xdg-open.
function openUrlScheme(url) { try { spawn('open', [url], { detached: true, stdio: 'ignore' }).unref(); } catch {} }

// Electron's own focus() is not fighting a window manager here the way it is under X11, so
// it needs no wmctrl-style workaround.
function focusWindow(win) { try { win.show(); win.focus(); } catch {} }

const desktop = {
    canInstallMenuEntries: false,
    appsDir, desktopDir, launcherFileName, writeLauncher, removeLauncher,
    refreshMenu, markTrusted,
    autostartPath, getAutostart, setAutostart,
    openUrlScheme, focusWindow,
    // No window-rule engine on this host; the UI already handles a null here.
    displayPicker: null,
    // Omarchy is a Linux distribution, so these are null here for the same reason. Every
    // caller must guard — a missing null check on displayPicker was an instant crash on this
    // host once already, and these have exactly the same shape.
    omarchy: null,
    omarchyTheme: null,
};

// ── Steam ────────────────────────────────────────────────────────────────────
function steamLibraryPaths() {
    const root = path.join(HOME, 'Library', 'Application Support', 'Steam');
    const sa = path.join(root, 'steamapps');
    const dirs = new Set();
    if (fs.existsSync(sa)) {
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

function steamLaunchCommand(appId) { return `open steam://rungameid/${appId}`; }

// ── Other stores this host knows about ───────────────────────────────────────
// No Flatpak on macOS. scan-flatpak already no-ops on `supported: false`; find-flatpak-icon
// is called unconditionally, so findIcon still has to exist and answer null.
const extraStore = { supported: false, label: '', scan: () => [], findIcon: () => null };

// ── Store platform identifiers ───────────────────────────────────────────────
const nativeOsKey       = 'osx';      // games.platform / GOG installer `os`
const gogdlPlatform     = 'osx';      // gogdl --platform {windows,osx,linux}
const legendaryPlatform = 'Mac';      // legendary --platform {Windows,Win32,Mac} — its own default on darwin

// ── Native game launch + install detection ───────────────────────────────────
// A native macOS build is usually a .app bundle; `open -n` launches it without waiting and
// without going through LaunchServices' "already running" de-dup, which matters for games
// that might legitimately be reopened. Anything else (a bare Unix executable, e.g. a
// source-port build) is spawned directly, same as Linux.
function launchNative({ exe, args = [] }) {
    if (/\.app$/i.test(exe)) {
        return { cmd: 'open', args: args.length ? ['-n', exe, '--args', ...args] : ['-n', exe], env: {} };
    }
    try { fs.chmodSync(exe, '755'); } catch {}
    return { cmd: exe, args: [...args], env: {} };
}

function findNativeGameExe(gameDir) {
    try {
        const entries = fs.readdirSync(gameDir);
        // GOG's macOS installers drop the game as a .app bundle at the install root.
        const app = entries.find(e => e.toLowerCase().endsWith('.app'));
        if (app) return app;
        // Fallback: a bare executable matching the folder name (source-port style installs).
        const folderName = path.basename(gameDir).toLowerCase();
        for (const e of entries) {
            if (e.toLowerCase() === folderName || e.toLowerCase() === folderName.replace(/ /g, '_')) {
                const full = path.join(gameDir, e);
                try { if (fs.statSync(full).mode & 0o111) return e; } catch {}
            }
        }
    } catch {}
    return null;
}

// Is `gameDir` a native macOS install of `appId`? Verified against a real
// `gogdl --platform osx download` (Phase D): unlike Linux, gogdl writes no manifest file at
// all here — the game IS the .app bundle, dropped directly under the shared install root with
// no extra per-game wrapper folder. findGogInstallResult's caller peels one level off that
// root before calling us, so `gameDir` here typically already IS the bundle; a plain folder
// containing one (a source-port style install) is handled too. It carries its own
// goggame-<appId>.info inside Contents/Resources (same playTasks shape as the Windows .info
// file) — the filename already encodes the appId, so there's no ambiguity to guess at.
//
// install_path must be safe to `rm -rf` alone on uninstall (see headlessUninstall), so it has
// to be the bundle itself, never the shared root above it — which makes `executable` a
// self-reference ('.') rather than a name, so resolvedExe's path.join(install_path, executable)
// still lands on the bundle. launchNative's `open -n` then resolves the real binary through
// the bundle's own Info.plist (CFBundleExecutable), exactly as GOG's own installer would.
function findNativeInstallResult(gameDir, appId) {
    const isApp = /\.app$/i.test(gameDir);
    const bundle = isApp ? gameDir : (() => { const a = findNativeGameExe(gameDir); return a ? path.join(gameDir, a) : null; })();
    if (!bundle) return null;
    const infoFile = path.join(bundle, 'Contents', 'Resources', `goggame-${appId}.info`);
    if (!fs.existsSync(infoFile)) return null;
    return { install_path: bundle, executable: '.' };
}

// ── DOSBox for GOG's DOS games ───────────────────────────────────────────────
// Same binaries, no Flatpak fallback (Homebrew is the one packaging story on this host).
const DOSBOX_BINARIES = ['dosbox-staging', 'dosbox', 'dosbox-x'];

let _dosboxCache;
function findDosbox() {
    if (_dosboxCache !== undefined) return _dosboxCache;
    _dosboxCache = null;
    for (const b of DOSBOX_BINARIES) {
        const p = which(b);
        if (p) { _dosboxCache = { cmd: p, args: [], label: path.basename(p) }; return _dosboxCache; }
    }
    return _dosboxCache;
}

function dosboxInstallHint() { return { native: 'brew install dosbox', flatpak: '' }; }

// Same path normalisation as Linux — host-agnostic string handling, not OS-specific logic.
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
// Windows-game runtime: CrossOver, driven directly through its own `wine --bottle`
// CLI entry point — not cxstart, not the GUI. Same choice Linux makes with
// umu-run/proton: talk to the real tool, not a wrapper app (this is exactly why
// Sikarugir was dropped — GUI-only, no CLI to drive headlessly; see the mac-port
// memory). Everything below was verified against a real CrossOver 26.3 install on
// this machine before being written — the specific things confirmed by hand:
//
//   - `wine --bottle NAME [--no-gui] EXE args…` is the sanctioned entry point.
//     It sets up CX_ROOT, the GPTK/D3DMetal library paths, WINEDLLPATH etc. on its
//     own; calling the engine binary underneath directly (wineloader) skips all of
//     that and prints cxcompatdb errors, so this file never does that.
//   - `CX_BOTTLE_PATH` (an env var) relocates where a *named* bottle is looked
//     up/created, which is what lets installer-engine.js's existing per-game
//     directory scheme (configDir/prefixes/<safe-name>, unchanged from Linux) work
//     unmodified: the directory becomes the bottle's parent, its own name becomes
//     the bottle name.
//   - Bottles do NOT self-initialize the way umu/Proton prefixes do. `wine --bottle`
//     against a name with no bottle yet is a fatal error, and `cxbottle --create`
//     refuses to create one at a path that already exists — even as an empty
//     directory, which is exactly what installer-engine.js's own
//     `fs.mkdirSync(prefix, {recursive:true})` leaves behind before any of this
//     runs. ensureBottle() below treats "no system.reg" as "not a real bottle yet"
//     and is safe to wipe-and-recreate from, which is what makes this idempotent
//     across all of buildLaunch / buildRedistLaunch / regeditCommand and safe to
//     call from a directory the engine already pre-created.
//   - z: still maps to / exactly like Linux/vanilla Wine (confirmed against a real
//     bottle's dosdevices/) — toWindowsPath needs no CrossOver-specific change.
//
// Creating a bottle takes ~15-20s and only happens once per game — the same kind
// of one-time cost Linux pays building a fresh Proton prefix. Because
// `wine --bottle` refuses to run against a not-yet-real bottle, that creation has
// to happen before a launch can be spawned at all, which is why buildLaunch,
// buildRedistLaunch and regeditCommand are async here (installer-engine.js awaits
// all three; harmless no-op for Linux, whose versions are plain sync).
// ═════════════════════════════════════════════════════════════════════════════

// CrossOver installs to either location depending on how it was dragged in; both
// are checked because /Applications is the conventional spot, but the one real
// install found during Phase E research was under ~/Applications.
function findCrossOverApp() {
    for (const base of ['/Applications', path.join(HOME, 'Applications')]) {
        const p = path.join(base, 'CrossOver.app');
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// CodeWeavers calls this "the hosted application" — confirmed by finding a real
// install; an earlier guess at `Contents/SharedSupport/CrossOver/bin/` was wrong
// (see the mac-port memory, corrected 2026-08-24).
function crossOverToolsDir(appPath) {
    return path.join(appPath, 'Contents', 'SharedSupport', 'CrossOver', 'CrossOver-Hosted Application');
}

function crossOverVersion(appPath) {
    try {
        return execSync(`defaults read "${path.join(appPath, 'Contents', 'Info')}" CFBundleShortVersionString`,
            { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch { return ''; }
}

let _cxCache;
function findCrossOver() {
    if (_cxCache !== undefined) return _cxCache;
    const app = findCrossOverApp();
    if (!app) { _cxCache = null; return _cxCache; }
    const toolsDir = crossOverToolsDir(app);
    const wine = path.join(toolsDir, 'wine');
    _cxCache = fs.existsSync(wine) ? { app, toolsDir, wine } : null;
    return _cxCache;
}

function findWineCached() { return findCrossOver()?.wine || null; }

// ── Bottles ──────────────────────────────────────────────────────────────────
function isRuntimeDir(dir) {
    // What "a Proton build" means on Linux; here it answers "is this a real,
    // initialized bottle" — system.reg only exists once cxbottle --create (or a
    // first real wine invocation against it) has actually run.
    try { return fs.existsSync(path.join(dir, 'system.reg')); } catch { return false; }
}

// Everything a bottle legitimately contains at rest. Used to tell "a half-built or
// broken bottle of ours" (safe to throw away and rebuild) apart from "a directory
// with somebody's actual files in it" (never touch) — see clearForCreate below.
const BOTTLE_ARTIFACTS = new Set([
    'cxbottle.conf', 'system.reg', 'user.reg', 'userdef.reg',
    'dosdevices', 'drive_c', '.update-timestamp', '.DS_Store',
]);

// cxbottle refuses to --create over a path that already exists — even an empty
// directory, which is exactly what installer-engine.js's own unconditional
// `fs.mkdirSync(prefix, {recursive:true})` leaves behind before host.runtime is ever
// consulted. So something has to clear the way. What must NOT happen is clearing it
// blindly: prefixPathForGame honours a user-set `game.prefix_path`, and the settings
// UI actively invites pointing that at a folder of their choosing, so a blind
// recursive delete here is a data-loss bug waiting for the first person who does.
// Only an empty directory, or one holding nothing but the bottle files above, is
// ours to remove; anything else is somebody's data and stops the launch instead.
function clearForCreate(prefix) {
    let entries;
    try { entries = fs.readdirSync(prefix); }
    catch { return; }                                  // doesn't exist — nothing to clear
    const foreign = entries.filter(e => !BOTTLE_ARTIFACTS.has(e));
    if (foreign.length) {
        const err = new Error(
            `Refusing to build a CrossOver bottle at ${prefix} — it already contains files ` +
            `that are not part of a bottle (${foreign.slice(0, 3).join(', ')}` +
            `${foreign.length > 3 ? `, +${foreign.length - 3} more` : ''}). ` +
            `Point this game at an empty prefix folder, or move those files aside first.`);
        err.code = 'PREFIX_NOT_EMPTY';
        throw err;
    }
    fs.rmSync(prefix, { recursive: true, force: true });
}

function ensureBottle(prefix, runtimePath) {
    const bottleDir  = path.dirname(prefix);
    const bottleName = path.basename(prefix);
    if (isRuntimeDir(prefix)) return Promise.resolve({ bottleDir, bottleName });

    const toolsDir = runtimePath ? path.dirname(runtimePath) : findCrossOver()?.toolsDir;
    if (!toolsDir) return Promise.reject(unavailableError());

    try { clearForCreate(prefix); }
    catch (e) { return Promise.reject(e); }
    fs.mkdirSync(bottleDir, { recursive: true });

    const cxbottle = path.join(toolsDir, 'cxbottle');
    return new Promise((resolve, reject) => {
        // stderr is kept rather than discarded: when this fails it is the only thing
        // that says why, and "cxbottle exit 1" on its own is not a diagnosis.
        const proc = spawn(cxbottle, ['--bottle', bottleName, '--create', '--template', 'win10'], {
            env: { ...process.env, CX_BOTTLE_PATH: bottleDir },
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        let err = '';
        proc.stderr.on('data', d => { if (err.length < 4000) err += d; });
        proc.on('close', code => {
            if (code === 0 && isRuntimeDir(prefix)) { resolve({ bottleDir, bottleName }); return; }
            const tail = err.trim().split('\n').filter(Boolean).slice(-3).join('; ');
            reject(new Error(
                `Could not create a CrossOver bottle for this game (cxbottle exit ${code})` +
                `${tail ? `: ${tail}` : '.'}`));
        });
        proc.on('error', reject);
    });
}

function unavailableError() {
    const err = new Error(
        'CrossOver was not found. Windows games on macOS need CrossOver (from codeweavers.com) — ' +
        'Clarity drives it directly once it is installed, but cannot install it for you.');
    err.code = 'NO_RUNTIME';
    return err;
}

// CrossOver is commercial software with its own installer and license, not a build
// fetched off GitHub releases the way GE-Proton is — nothing here is a stub
// standing in for future work, this is the real answer for this host.
const management = {
    supported: false,
    label: 'CrossOver',
    installDirs:      () => [],
    managedDirs:       () => [],
    resolveInstallDir: () => { throw unavailableError(); },
    isManagedDir:      () => false,
    listReleases:  async () => ({ ok: false, error: 'CrossOver is commercial software — install it yourself from codeweavers.com.', releases: [] }),
    latestRelease: async () => ({ ok: false, error: 'CrossOver is commercial software — install it yourself from codeweavers.com.' }),
    install:       async () => ({ ok: false, error: 'CrossOver is commercial software — install it yourself from codeweavers.com.' }),
    cancel: () => false,
    remove: () => ({ ok: false, error: 'Not applicable — Clarity does not manage your CrossOver install.' }),
};

function runnerTools() {
    const cx = findCrossOver();
    return [{
        key: 'crossover', label: 'CrossOver',
        path: cx ? cx.wine : null,
        installable: false, optional: false,
        hint: cx ? '' : 'not found — install CrossOver from codeweavers.com, then relaunch Clarity',
    }];
}
async function installRunner() {
    return { ok: false, error: 'CrossOver is commercial software Clarity cannot install for you — get it from codeweavers.com.' };
}

// Only one "build" is ever possible on this host — there is no per-user store of
// alternate CrossOver versions the way Linux keeps several Proton builds side by
// side — so this is a single-entry (or empty) list, shaped to match what the
// existing Proton-picker UI already expects from runtime.scan().
function scanRuntimes() {
    const cx = findCrossOver();
    if (!cx) return [];
    const version = crossOverVersion(cx.app);
    return [{ name: 'CrossOver', path: cx.wine, type: 'crossover', version,
               label: version ? `CrossOver ${version}` : 'CrossOver', managed: false }];
}

function resolveRuntime() { return findCrossOver()?.wine || ''; }

// Note both of these ARE reached for native macOS games too: installer-engine.js calls
// inUse()/compatEnv() well before its native-build gate (game.platform ===
// host.nativeOsKey), not after. That's harmless — compatEnv adds nothing, and the
// shipped-wrapper-DLL scan those answers feed finds no Windows DLLs beside a .app
// bundle — but it does mean neither may assume it is only ever asked about a Windows
// title. Same shape as Linux's: "is a translation layer going to be involved at all".
function inUse(runtimePath) { return !!(runtimePath || findWineCached()); }
function canRun(runtimePath) { return !!(runtimePath || findWineCached()); }

// Nothing CrossOver-specific to add here: esync/fsync are Linux kernel futex
// extensions with no macOS equivalent, and DXVK/NVAPI don't apply to a Metal-backed
// D3D translation. Still has to return a real (mutable) object — the shared
// shipped-wrapper-DLL and per-game-fix logic in installer-engine.js writes
// WINEDLLOVERRIDES into whatever this returns, on every platform.
function compatEnv() { return {}; }

function assertAvailable(runtimePath) { if (!runtimePath && !findWineCached()) throw unavailableError(); }

// Some callers resolve runtimePath through host.runtime.resolve() (always the found
// CrossOver, or ''); others — apps/installer/main.js's "run an .exe in this prefix"
// flow, in particular — read game.proton_path / the default_proton_path setting
// directly instead, both Linux-only concepts that are simply always empty on this
// host. Falling back to findWineCached() here (same as Linux's buildRedistLaunch
// already does) means an empty runtimePath means "wasn't resolved by this caller",
// not "CrossOver is missing" — only a real absence throws.
function usableRuntimePath(runtimePath) { return runtimePath || findWineCached(); }

async function buildLaunch({ launchExe, allArgs, runtimePath, prefix }) {
    const wine = usableRuntimePath(runtimePath);
    if (!wine) throw unavailableError();
    const { bottleDir, bottleName } = await ensureBottle(prefix, wine);
    return {
        cmd: wine,
        args: ['--bottle', bottleName, '--no-gui', launchExe, ...allArgs],
        env: { CX_BOTTLE_PATH: bottleDir },
        method: 'crossover',
    };
}

// Unlike buildLaunch this returns the COMPLETE env (redists run standalone, not
// under a game's own base) — same contract as Linux's version.
async function buildRedistLaunch({ exePath, exeArgs, prefix, runtimePath }) {
    const wine = usableRuntimePath(runtimePath);
    if (!wine) throw unavailableError();
    const { bottleDir, bottleName } = await ensureBottle(prefix, wine);
    return {
        cmd: wine,
        args: ['--bottle', bottleName, '--no-gui', exePath, ...exeArgs],
        env: { ...process.env, CX_BOTTLE_PATH: bottleDir },
        method: 'crossover',
    };
}

async function regeditCommand({ prefix, runtimePath, regFile }) {
    const wine = usableRuntimePath(runtimePath);
    if (!wine) throw unavailableError();
    const { bottleDir, bottleName } = await ensureBottle(prefix, wine);
    return {
        cmd: wine,
        args: ['--bottle', bottleName, '--no-gui', 'regedit', '/S', regFile],
        env: { ...process.env, CX_BOTTLE_PATH: bottleDir },
    };
}

// z: maps to / exactly like Linux/vanilla Wine — confirmed against a real bottle's
// dosdevices/ (CrossOver additionally maps y: to $HOME, unused here).
function toWindowsPath(p) { return ('Z:' + p).replace(/\//g, '\\'); }

function diagnose(log) {
    const t = String(log || '');
    if (/Unable to find the '.*' bottle/i.test(t))
        return { code: 'MISSING_RUNTIME', message: 'The CrossOver bottle for this game is missing or could not be created.' };
    if (!findWineCached())
        return { code: 'NO_RUNTIME', message: 'CrossOver was not found.' };
    if (/is not a valid Win32|Bad EXE format/i.test(t))
        return { code: 'BAD_EXE', message: 'The game executable could not be run by CrossOver.' };
    return { code: 'UNKNOWN', message: 'The game closed immediately after starting.' };
}

const runtime = {
    id: 'crossover',
    management,
    tools: runnerTools,
    canInstallRunner: false,
    installRunner,
    prefixesDirName: 'prefixes',
    setupPhase: 'runtime',
    scan: scanRuntimes,
    resolve: resolveRuntime,
    isRuntimeDir,
    inUse, canRun, assertAvailable,
    compatEnv, buildLaunch, buildRedistLaunch, regeditCommand,
    toWindowsPath, diagnose, unavailableError,
    // Not wired up — CrossOver 26 advertises its own BattlEye/EAC support built
    // into the engine itself, unverified here against a real anti-cheat title, and
    // Installer's own separate runtime copy (Linux's findAntiCheatRuntime) has no
    // reason to exist on a host where the compatibility layer claims to handle it.
    findAntiCheatRuntime: () => null,
    // No structured progress signal from CrossOver's output the way umu prints
    // one — bottle creation is the only real delay, and it's already absorbed
    // (as a real await, not a UI-blocking wait) inside buildLaunch above.
    startupSteps: () => [],
    setupBytes: () => 0,
    redistUnavailableMessage: 'CrossOver was not found. Install it from codeweavers.com to run this dependency installer.',
    findUmu: () => null,          // no umu-run equivalent on macOS
    findWine: findWineCached,
};

module.exports = {
    id: 'darwin',
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
