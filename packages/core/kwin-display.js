// ── Which monitor games open on (KDE / KWin) ─────────────────────────────────
// On a Wayland session nothing inside the game decides where its window lands — the
// compositor does. gamescope's --prefer-output belongs to its DRM backend, so under a
// normal KDE session it has no say either. That leaves KWin, which offers two ways in.
//
// The obvious one is a window rule in kwinrulesrc, and it does not work: on KWin 6.7 a
// rule written to that file is ignored no matter how it is spelled, UUID group name or
// not, and even a rule matching every window with a forced size changes nothing. KWin
// owns that file and only reads our edits back on its own terms. So this uses KWin's
// scripting interface instead, which is a supported API, takes effect immediately, and
// has the considerable virtue of not writing to the user's KDE configuration at all.
//
// One script for every game rather than one per game, because umu gives every non-Steam
// title the same window class — steam_app_0 — deriving it from GAMEID, and GAMEID is what
// umu looks its compatibility fixes up by, so it is not ours to fake for a window match.
//
// ⚠️ A loaded KWin script lives as long as the KWin session, not as long as this app, and
// is gone after a logout. `apply()` at startup is what makes the setting stick across
// reboots; the choice itself is ours, kept beside our own settings.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const PLUGIN = 'clarity-game-display';

// Window classes worth moving. umu/Proton covers everything launched through a compatibility
// layer, which is nearly every game here; the rest are the runners we launch directly.
const GAME_CLASSES = ['steam_app_', 'dosbox', 'scummvm', 'openbor', 'gzdoom', 'uzdoom',
    'ironwail', 'vkquake', 'quake', 'raze', 'buildgdx', 'ecwolf', 'cannonball'];

function which(bin) {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (!dir) continue;
        const p = path.join(dir, bin);
        try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
    }
    return '';
}

const qdbusBin = () => which('qdbus6') || which('qdbus') || which('qdbus-qt6');

// KDE only, and only when the tools to do it properly are present.
function isSupported() {
    const desktop = `${process.env.XDG_CURRENT_DESKTOP || ''} ${process.env.DESKTOP_SESSION || ''}`.toLowerCase();
    return desktop.includes('kde') && !!which('kscreen-doctor') && !!qdbusBin();
}

// The monitors KWin can place a window on, in the order KWin numbers them — which is the
// order kscreen reports. The name is what the script matches on: an index shifts when a
// monitor is unplugged, a connector name does not.
function listDisplays() {
    const kd = which('kscreen-doctor');
    if (!kd) return [];
    const r = spawnSync(kd, ['-j'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (r.status !== 0) return [];
    let data;
    try { data = JSON.parse(r.stdout); } catch { return []; }

    return (data.outputs || [])
        .filter(o => o.enabled)
        .map((o, i) => {
            const size = o.size || {};
            const pos = o.pos || {};
            const cur = (o.modes || []).find(m => String(m.id) === String(o.currentModeId));
            return {
                index: i,
                name: o.name || `Screen ${i + 1}`,
                // Resolution and refresh are how someone recognises which physical monitor
                // this is — the connector name alone tells them nothing.
                mode: size.width && size.height ? `${size.width}x${size.height}` : '',
                hz: cur && cur.refreshRate ? Math.round(cur.refreshRate) : null,
                type: o.type || '',
                x: pos.x ?? null, y: pos.y ?? null,
                // KWin numbers its screens in priority order; 1 is the primary.
                primary: o.priority === 1,
            };
        })
        .sort((a, b) => a.index - b.index);
}

// ── Where the choice lives ───────────────────────────────────────────────────
// Beside our own settings, not in KDE's: this is a Clarity preference that happens
// to be enacted through KWin. The app's settings folder travels with the AppImage rather
// than living in $HOME, so the host must say where it is — guessing would strand the
// setting behind when someone moves their library to another machine.
let _configDir = path.join(os.homedir(), 'GameManagerConfig');
function configure(dir) { if (dir) _configDir = dir; migrateLegacyChoice(); }

const configDir = () => _configDir;
const choiceFile = () => path.join(configDir(), 'game-display.json');
const scriptFile = () => path.join(configDir(), 'kwin-game-display.js');

// The first build of this feature wrote to ~/GameManagerConfig whatever the app's real
// settings folder was. Move that choice rather than silently reverting to Default.
function migrateLegacyChoice() {
    const legacyDir = path.join(os.homedir(), 'GameManagerConfig');
    if (path.resolve(legacyDir) === path.resolve(_configDir)) return;
    const legacy = path.join(legacyDir, 'game-display.json');
    try {
        if (!fs.existsSync(legacy)) return;
        if (!fs.existsSync(choiceFile())) {
            fs.mkdirSync(configDir(), { recursive: true });
            fs.copyFileSync(legacy, choiceFile());
        }
        fs.rmSync(legacy, { force: true });
        fs.rmSync(path.join(legacyDir, 'kwin-game-display.js'), { force: true });
        fs.rmdirSync(legacyDir);   // only succeeds if we were the only thing in it
    } catch {}
}

function readChoice() {
    try { return JSON.parse(fs.readFileSync(choiceFile(), 'utf8')); } catch { return null; }
}

// The stored choice is a connector name; the index it maps to is whatever KWin numbers it
// today. A monitor that has since been unplugged reports null rather than moving games to
// whichever screen inherited its number.
function currentDisplay() {
    const choice = readChoice();
    if (!choice || !choice.name) return null;
    const found = listDisplays().find(d => d.name === choice.name);
    return found ? found.index : null;
}

// ── The script ───────────────────────────────────────────────────────────────
// Written out with the target baked in, because a KWin script cannot read a file to find
// out where it should be putting things.
function scriptFor(outputName) {
    return `// Generated by Clarity. Moves game windows to a chosen monitor.
// Reloaded whenever the setting changes or the app starts; safe to delete.
var TARGET = ${JSON.stringify(outputName)};
var CLASSES = ${JSON.stringify(GAME_CLASSES)};

function targetOutput() {
    var outs = workspace.screens;
    for (var i = 0; i < outs.length; i++) if (outs[i].name === TARGET) return outs[i];
    return null;
}

function isGame(w) {
    if (!w || w.desktopWindow || w.dock || w.splash || w.utility || w.popupWindow) return false;
    var cls = String(w.resourceClass || "").toLowerCase();
    for (var i = 0; i < CLASSES.length; i++) if (cls.indexOf(CLASSES[i]) !== -1) return true;
    return false;
}

function place(w) {
    var out = targetOutput();
    if (!out || !isGame(w)) return;
    if (w.output && w.output.name === TARGET) return;   // already there; don't fight it

    // sendClientToScreen is the API for this and keeps a fullscreen window fullscreen —
    // it re-fits it to the new monitor instead of stranding it at the old one's size.
    if (typeof workspace.sendClientToScreen === "function") workspace.sendClientToScreen(w, out);

    // A window that is neither fullscreen nor maximised may keep its old coordinates, so
    // it is moved by hand as well, clamped to the monitor it is going to.
    if (w.fullScreen) return;   // sendClientToScreen already re-fitted it to the new monitor
    var g = out.geometry, f = w.frameGeometry;
    w.frameGeometry = {
        x: g.x + Math.max(0, Math.round((g.width - f.width) / 2)),
        y: g.y + Math.max(0, Math.round((g.height - f.height) / 2)),
        width: Math.min(f.width, g.width),
        height: Math.min(f.height, g.height),
    };
}

// Games routinely open a small window and go fullscreen a moment later, and going
// fullscreen is exactly when a game re-picks its monitor — so watch for it rather than
// placing the window once and hoping.
function watch(w) {
    if (!isGame(w)) return;
    place(w);
    if (w.fullScreenChanged) w.fullScreenChanged.connect(function () { place(w); });
    if (w.outputChanged) w.outputChanged.connect(function () { place(w); });
}

workspace.windowAdded.connect(watch);
var existing = workspace.windowList ? workspace.windowList() : [];
for (var i = 0; i < existing.length; i++) watch(existing[i]);
`;
}

function qdbus(args) {
    const bin = qdbusBin();
    if (!bin) return { ok: false, out: '' };
    const r = spawnSync(bin, ['org.kde.KWin', '/Scripting', ...args], { encoding: 'utf8' });
    return { ok: r.status === 0, out: (r.stdout || '').trim() };
}

function unload() {
    qdbus(['org.kde.kwin.Scripting.unloadScript', PLUGIN]);
}

function load(file) {
    // Unload first: loading the same plugin name twice would leave two copies connected to
    // windowAdded, each moving every window.
    unload();
    const loaded = qdbus(['org.kde.kwin.Scripting.loadScript', file, PLUGIN]);
    if (!loaded.ok) return false;
    return qdbus(['org.kde.kwin.Scripting.start']).ok;
}

// Put the stored choice into effect. Called at startup, because a loaded script does not
// survive a logout — without this the setting would quietly stop working after a reboot.
function apply() {
    if (!isSupported()) return { ok: false, error: 'This needs KDE with kscreen-doctor and qdbus.' };
    const choice = readChoice();
    if (!choice || !choice.name) { unload(); return { ok: true, display: null }; }

    const target = listDisplays().find(d => d.name === choice.name);
    if (!target) { unload(); return { ok: false, error: `${choice.name} is not connected.` }; }

    try {
        fs.mkdirSync(configDir(), { recursive: true });
        fs.writeFileSync(scriptFile(), scriptFor(target.name), 'utf8');
    } catch (e) { return { ok: false, error: e.message }; }

    return load(scriptFile()) ? { ok: true, display: target }
        : { ok: false, error: 'KWin would not load the script.' };
}

// index === null clears the setting and hands placement back to KDE.
function setGameDisplay(index) {
    if (!isSupported()) return { ok: false, error: 'This needs KDE with kscreen-doctor and qdbus.' };

    if (index === null || index === undefined || index < 0) {
        try { fs.rmSync(choiceFile(), { force: true }); } catch {}
        try { fs.rmSync(scriptFile(), { force: true }); } catch {}
        unload();
        return { ok: true, display: null };
    }

    const target = listDisplays().find(d => d.index === index);
    if (!target) return { ok: false, error: 'That screen is no longer connected.' };

    try {
        fs.mkdirSync(configDir(), { recursive: true });
        fs.writeFileSync(choiceFile(), JSON.stringify({ name: target.name }, null, 2), 'utf8');
    } catch (e) { return { ok: false, error: e.message }; }

    return apply();
}

module.exports = { configure, isSupported, listDisplays, currentDisplay, setGameDisplay, apply, PLUGIN };
