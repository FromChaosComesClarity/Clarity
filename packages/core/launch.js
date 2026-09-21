'use strict';
/*
 * Starting a game.
 *
 * This is the suite's one answer to "what does Play mean", extracted from
 * apps/couch/main.js where it had grown up, because the CRT face needs the
 * same answer and a second copy would be right on the day it was written and
 * wrong by the next release.
 *
 * "Play" is not one thing. A row in the library can front several stores at
 * once (Store = "Steam, GOG"), and each store starts differently:
 *
 *   Steam            a steam:// URL handed to the Steam client
 *   GOG / Epic       the in-process Installer engine — never a shell command,
 *                    because these need a prefix, a runner and an environment
 *                    that only the engine knows how to assemble
 *   itch.io          a custom scheme the desktop opener has to take, since
 *                    shell.openExternal refuses it
 *   PICO-8           a cart path passed to a binary found on disk
 *   everything else  a shell command as written
 *
 * A face decides *which* launcher to offer and how to say so on screen. It
 * does not decide what starting one means. That is here.
 *
 * ⚠️ Created per-face with its own db and baseDir rather than being a
 * singleton: the faces are separate processes with separate library paths, and
 * a module-level cache keyed to one of them was a bug waiting to happen.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const host = require('./platform/index.js');
const installerEngine = require('./installer-engine.js');

/*
 * deps:
 *   db            the face's open games.db (used for the PICO-8 path setting)
 *   baseDir       the portable install directory (library, Installer db, carts)
 *   binDir        where the bundled runner binaries live
 *   onLaunchIssue ({title, code, message}) — a launch that failed after we
 *                 handed off. A Windows game with no Proton dies instantly and
 *                 invisibly; a face that does not show this just sits there.
 *   onProgress    ({...}) — engine launch progress, for a face that shows it
 */
function create(deps = {}) {
    const { db = null, baseDir = '', binDir = '', onLaunchIssue = () => {}, onProgress = () => {} } = deps;

    // ── Naming and routing a launcher ────────────────────────────────────────

    function guessLauncherLabel(cmd) {
        if (!cmd) return 'Custom';
        if (/steam:\/\/rungameid/i.test(cmd))        return 'Steam';
        if (/installer:\/\/launch\/gog/i.test(cmd))  return 'GOG via Installer';
        if (/installer:\/\/launch\/epic/i.test(cmd)) return 'Epic via Installer';
        if (cmd.startsWith('itch://'))               return 'itch.io';
        if (cmd.startsWith('pico8-cart:'))           return 'PICO-8';
        if (/^flatpak run/i.test(cmd))               return 'Flatpak';
        if (cmd.startsWith('installer://'))          return 'Installer';
        return 'Custom';
    }

    function launcherStore(cmd) {
        if (/steam:\/\/rungameid/i.test(cmd))          return 'steam';
        if (/installer:\/\/launch\/gog\//i.test(cmd))  return 'gog';
        if (/installer:\/\/launch\/epic\//i.test(cmd)) return 'epic';
        return null;
    }

    /*
     * The canonical per-store launcher list for a row: [{ label, cmd }].
     *
     * LaunchCommands is the source of truth when populated, but plenty of
     * genuinely multi-store rows never had it written (legacy cross-store
     * merges, or a Manager save that dropped the Installer launcher), so
     * anything the row's own store fields prove exists is filled back in.
     *
     * ⚠️ Needs Store + SteamAppID + InstallerGameId on the row. A SELECT
     * without them silently returns fewer launchers than the game has.
     */
    function expandLaunchers(game) {
        const out = [], seen = new Set();
        const add = (label, cmd) => {
            if (!cmd || seen.has(cmd)) return;
            seen.add(cmd);
            out.push({ label: label || guessLauncherLabel(cmd), cmd });
        };
        try { for (const l of JSON.parse(game.LaunchCommands || '[]')) if (l && l.cmd) add(l.label, l.cmd); } catch {}
        add(null, game.LaunchCommand);

        const stores = (game.Store || '').toLowerCase();
        const has = s => out.some(l => launcherStore(l.cmd) === s);

        // ⚠️ SteamAppID alone proves nothing: it doubles as the metadata key on
        // GOG and itch rows. It only implies a Steam launcher alongside a Steam
        // tag on the row.
        const appId = String(game.SteamAppID || '').replace(/\.0+$/, '').trim();
        if (stores.includes('steam') && appId && appId !== 'None' && !has('steam')) {
            add('Steam', host.steamLaunchCommand(appId));
        }
        const gg = String(game.InstallerGameId || '').match(/^(gog|epic)_(.+)$/i);
        if (gg) {
            const store = gg[1].toLowerCase();
            if (stores.includes(store) && !has(store)) {
                add(store === 'gog' ? 'GOG via Installer' : 'Epic via Installer', `installer://launch/${store}/${gg[2]}`);
            }
        }
        return out;
    }

    // ── Is this particular launcher's copy installed? ────────────────────────

    function isSteamGameInstalled(appId) {
        if (!appId || appId === 'None' || appId === '') return false;
        const id = String(appId).replace(/\.0+$/, '');
        return host.steamLibraryPaths().some(dir => fs.existsSync(path.join(dir, `appmanifest_${id}.acf`)));
    }

    // Cached against the Installer database's mtime: this is read once per row
    // on a library screen, and opening a SQLite file 500 times to answer the
    // same question is the difference between an instant menu and a slow one.
    let _installedCache = { key: '', set: new Set() };
    function installerInstalledSet() {
        const p = host.findInstallerDb(baseDir);
        if (!p) { _installedCache = { key: '', set: new Set() }; return _installedCache.set; }
        let key = p;
        try { key += ':' + fs.statSync(p).mtimeMs; } catch {}
        if (key === _installedCache.key) return _installedCache.set;
        const set = new Set();
        try {
            const gdb = new Database(p, { readonly: true, timeout: 5000 });
            for (const r of gdb.prepare('SELECT id FROM games WHERE installed=1').all()) set.add(String(r.id));
            gdb.close();
        } catch {}
        _installedCache = { key, set };
        return set;
    }

    // true / false / null, where null means "this kind of launcher does not
    // report install state" — a custom command might be anything.
    function launcherInstalled(cmd, steamAppId) {
        const c = cmd || '';
        const sm = c.match(/steam:\/\/rungameid\/(\d+)/i);
        if (sm) return isSteamGameInstalled(sm[1] || steamAppId);
        const gm = c.match(/installer:\/\/launch\/(gog|epic)\/([^"\s]+)/i);
        if (gm) return installerInstalledSet().has(`${gm[1].toLowerCase()}_${gm[2]}`);
        return null;
    }

    // Install state across every store the row fronts: installed anywhere wins.
    // Keying off only the primary LaunchCommand hid an installed Steam copy
    // whenever the primary launcher was GOG or Epic.
    function resolveInstallState(game) {
        const cmds = expandLaunchers(game).map(l => l.cmd);
        if (!cmds.some(c => /steam:\/\/rungameid/i.test(c))) return null;
        let allTracked = true;
        for (const cmd of cmds) {
            const s = launcherInstalled(cmd, game.SteamAppID);
            if (s === true) return 1;
            if (s === null) allTracked = false;
        }
        return allTracked ? 0 : null;
    }

    // What a face shows: every way to start this game, and whether each works
    // right now.
    function launcherStates(game) {
        return expandLaunchers(game).map(l => ({
            label: l.label || guessLauncherLabel(l.cmd),
            cmd: l.cmd,
            store: launcherStore(l.cmd || ''),
            installed: launcherInstalled(l.cmd, game.SteamAppID) === true,
        }));
    }

    // ── The Installer engine, for GOG and Epic ───────────────────────────────

    let _engineDb = null;
    function ensureEngine() {
        if (_engineDb) return true;
        const gdbPath = host.findInstallerDb(baseDir);
        if (!gdbPath) return false;
        const configDir = path.dirname(gdbPath);
        try { _engineDb = new Database(gdbPath, { timeout: 5000 }); }
        catch (e) { _engineDb = null; return false; }
        installerEngine.init({
            configDir,
            prefixesDir: path.join(configDir, 'prefixes'),
            logDir:      path.join(configDir, 'game_logs'),
            binDir,
            appImageDir: baseDir,
            homeDir:     os.homedir(),
            db:          _engineDb,
            onProgress:  () => {},
            onLaunchIssue: (info) => onLaunchIssue({
                title: info?.title || '',
                code: info?.reason?.code || 'UNKNOWN',
                message: info?.reason?.message || 'The game could not be started.',
            }),
            onLaunchProgress: (info) => onProgress(info),
        });
        return true;
    }

    // app_id → Installer's own game id, for the launch/<store>/<app_id> form.
    let _map = null;
    function installerMap() {
        if (_map) return _map;
        _map = new Map();
        const dbPath = host.findInstallerDb(baseDir);
        if (!dbPath) return _map;
        try {
            const gdb = new Database(dbPath, { readonly: true });
            const rows = gdb.prepare(
                'SELECT id, app_id FROM games WHERE installed=1 AND (is_dlc IS NULL OR is_dlc=0)'
            ).all();
            gdb.close();
            for (const r of rows) if (r.app_id) _map.set(String(r.app_id), r.id);
        } catch {}
        return _map;
    }
    function invalidateInstallerMap() { _map = null; }

    function engineLaunch(gameId) {
        installerEngine.launchGame(gameId).catch(err => {
            let title = '';
            try { title = _engineDb?.prepare('SELECT title FROM games WHERE id=?').get(gameId)?.title || ''; } catch {}
            onLaunchIssue({
                title,
                code: err?.code || 'LAUNCH_ERROR',
                message: err?.message || 'The game could not be started.',
            });
        });
    }

    function pico8Bin() {
        try {
            const row = db && db.prepare("SELECT value FROM settings WHERE key='pico8_path'").get();
            if (row?.value && fs.existsSync(row.value)) return row.value;
        } catch {}
        const dir = path.join(baseDir, 'GameManagerConfig', 'pico8');
        for (const n of ['pico8', 'pico8_dyn', 'pico8_64']) {
            const p = path.join(dir, n);
            if (fs.existsSync(p)) return p;
        }
        return null;
    }

    // ── Start it ─────────────────────────────────────────────────────────────
    // Returns { ok } or { ok: false, error } — a face that cannot start a game
    // has to be able to say why, since on a TV there is no console to look at.

    function run(cmd) {
        if (!cmd) return { ok: false, error: 'This game has no launch command.' };

        // GOG/Epic via the Installer engine. ⚠️ Must never fall through to a
        // shell command: the engine is what knows the prefix and the runner.
        const viaStore = cmd.match(/installer:\/\/launch\/(epic|gog)\/([^"\s]+)/i);
        if (viaStore) {
            const gId = installerMap().get(viaStore[2]);
            if (!gId) return { ok: false, error: 'This game is not installed through the Installer.' };
            if (!ensureEngine()) return { ok: false, error: 'The Installer library is not available.' };
            engineLaunch(gId);
            return { ok: true };
        }
        const direct = cmd.match(/^installer:\/\/(?:launch\/)?(.+)$/);
        if (direct) {
            if (!ensureEngine()) return { ok: false, error: 'The Installer library is not available.' };
            engineLaunch(direct[1]);
            return { ok: true };
        }

        // itch.io: a custom scheme, which shell.openExternal refuses.
        if (cmd.startsWith('itch://')) {
            host.desktop.openUrlScheme(cmd);
            return { ok: true };
        }

        if (cmd.startsWith('pico8-cart:')) {
            const bin = pico8Bin();
            if (!bin) return { ok: false, error: 'PICO-8 is not set up on this machine.' };
            spawn(bin, ['-run', cmd.slice('pico8-cart:'.length)], { detached: true, stdio: 'ignore' }).unref();
            return { ok: true };
        }

        spawn(cmd, [], { shell: true, detached: true, stdio: 'ignore' }).unref();
        return { ok: true };
    }

    return {
        guessLauncherLabel, launcherStore, expandLaunchers,
        isSteamGameInstalled, launcherInstalled, resolveInstallState, launcherStates,
        run, ensureEngine, invalidateInstallerMap,
    };
}

module.exports = { create };
