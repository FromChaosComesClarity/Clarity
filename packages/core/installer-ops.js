'use strict';
/*
 * Owning games that are not installed yet.
 *
 * Steam handles its own installs — a steam:// URL and the client does the rest.
 * GOG and Epic have no client here, which is the whole reason the Installer
 * engine exists: it authenticates, downloads through gogdl or legendary, builds
 * a Wine prefix, and writes the result into its own library.db.
 *
 * This module is the small surface a face needs on top of that engine: what is
 * owned, what is installed, start an install, remove one. The engine does the
 * work; nothing here reimplements any of it.
 *
 * ⚠️ Two databases, and confusing them is the trap. `library.db` is the
 * Installer's own — everything the account owns on GOG and Epic, with the truth
 * about what is downloaded. `games.db` is Clarity's library, where a row can
 * front several stores at once. A face shows games.db and installs through
 * library.db, and the link between them is games.InstallerGameId = '<store>_<app_id>'.
 *
 * ⚠️ And signing in is not here on purpose. Both stores use an OAuth redirect
 * that has to be completed in a browser window, which is a poor fit for a TV at
 * 720x480 and worse for a keyboard across the room. A face that finds itself
 * signed out should say so and point at the desktop, once, rather than trying
 * to host a login form.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const host = require('./platform/index.js');
const engine = require('./installer-engine.js');

const DEFAULT_DIR = path.join(os.homedir(), 'Games', 'Clarity');

/*
 * deps:
 *   baseDir       the portable install directory, used to find library.db
 *   ensureEngine  () => bool — prepare the Installer engine. ⚠️ Passed in
 *                 rather than done here: installer-engine.js is a singleton
 *                 configured by init(), and a process that already runs it
 *                 (every face does, through packages/core/launch.js) must not
 *                 configure it a second time.
 */
function create({ baseDir = '', ensureEngine = () => false } = {}) {

    const dbPath = () => host.findInstallerDb(baseDir);

    function openLibrary() {
        const p = dbPath();
        if (!p) return null;
        try { return new Database(p, { readonly: true, timeout: 4000 }); } catch (e) { return null; }
    }

    // Is there an Installer library at all, and is either store signed in?
    async function status() {
        if (!dbPath()) return { available: false, gog: false, epic: false, reason: 'no-library' };
        if (!ensureEngine()) return { available: false, gog: false, epic: false, reason: 'no-engine' };
        let gog = false, epic = false;
        try { gog = !!(await engine.gogStatus())?.loggedIn; } catch (e) {}
        try { epic = !!(await engine.epicStatus())?.loggedIn; } catch (e) {}
        return { available: true, gog, epic };
    }

    /*
     * What the account owns.
     *
     * `installed` filters: true for what is on disk, false for what is not,
     * undefined for everything. DLC is excluded — it is not a thing you install
     * from a list of games, and it made the list twice as long and half as
     * useful.
     */
    function owned({ installed } = {}) {
        const lib = openLibrary();
        if (!lib) return [];
        try {
            const where = installed === true ? 'AND installed=1'
                        : installed === false ? 'AND IFNULL(installed,0)=0'
                        : '';
            const rows = lib.prepare(`
                SELECT id, title, store, app_id, installed, platform, install_path
                FROM games
                WHERE (is_dlc IS NULL OR is_dlc=0) ${where}
                ORDER BY title COLLATE NOCASE
            `).all();
            return rows.map(r => ({
                id: String(r.id),
                title: String(r.title || ''),
                store: String(r.store || '').toLowerCase(),
                appId: String(r.app_id || ''),
                installed: !!r.installed,
                platform: String(r.platform || ''),
                installPath: String(r.install_path || ''),
            }));
        } catch (e) {
            return [];
        } finally {
            try { lib.close(); } catch (e) {}
        }
    }

    function counts() {
        const all = owned();
        return {
            total: all.length,
            installed: all.filter(g => g.installed).length,
            available: all.filter(g => !g.installed).length,
        };
    }

    // Pull newly-bought titles from the store APIs into library.db. Slow, and
    // the only way a purchase made elsewhere ever appears here.
    async function refreshOwned() {
        if (!ensureEngine()) return { ok: false, error: 'The Installer library is not available.' };
        try {
            const r = await engine.syncOwnedLibrary();
            return { ok: true, result: r };
        } catch (e) {
            return { ok: false, error: e.message || 'Could not refresh the library.' };
        }
    }

    function installDir() {
        const lib = openLibrary();
        if (!lib) return DEFAULT_DIR;
        try {
            return lib.prepare("SELECT value FROM settings WHERE key='default_install_dir'").get()?.value || DEFAULT_DIR;
        } catch (e) {
            return DEFAULT_DIR;
        } finally {
            try { lib.close(); } catch (e) {}
        }
    }

    // Free space where games are installed, so a face can refuse an install it
    // has no room for instead of failing three gigabytes in.
    async function freeSpace() {
        if (!ensureEngine()) return null;
        try { return await engine.getDiskSpace(installDir()); } catch (e) { return null; }
    }

    /*
     * Install one owned game.
     *
     * ⚠️ Resolves against library.db rather than trusting what it is handed:
     * headlessInstall needs the store, the app id and a platform, and a face
     * that passed its own idea of those would be a second source of truth for
     * something this module can simply look up.
     *
     * Progress arrives on the engine's own onProgress channel, configured by
     * whoever called init(); this returns only the final answer.
     */
    async function install(gameId, opts = {}) {
        if (!ensureEngine()) return { ok: false, error: 'The Installer library is not available.' };
        const game = owned().find(g => g.id === String(gameId));
        if (!game) return { ok: false, error: 'That game is not in the Installer library.' };
        if (game.installed) return { ok: true, already: true };

        const platform = opts.platform || game.platform || 'windows';
        try {
            await engine.headlessInstall(game.store, game.appId, platform, installDir(), opts);
        } catch (e) {
            return { ok: false, error: e.message || 'Install failed.' };
        }

        // ⚠️ Asked again rather than assumed: headlessInstall reports failure
        // through the progress channel and returns normally, so "it did not
        // throw" is not the same as "it installed".
        const after = owned().find(g => g.id === String(gameId));
        return after?.installed ? { ok: true, title: game.title }
                                : { ok: false, error: 'The install did not complete.' };
    }

    async function uninstall(gameId) {
        if (!ensureEngine()) return { ok: false, error: 'The Installer library is not available.' };
        const game = owned().find(g => g.id === String(gameId));
        if (!game) return { ok: false, error: 'That game is not in the Installer library.' };
        try {
            await engine.headlessUninstall(game.store, game.appId);
        } catch (e) {
            return { ok: false, error: e.message || 'Uninstall failed.' };
        }
        const after = owned().find(g => g.id === String(gameId));
        return after?.installed ? { ok: false, error: 'The game is still installed.' }
                                : { ok: true, title: game.title };
    }

    function cancel() {
        try { return { ok: !!engine.cancelActiveInstall() }; } catch (e) { return { ok: false }; }
    }

    /*
     * ── Compatibility ────────────────────────────────────────────────────────
     *
     * ⚠️ Some machines cannot run DXVK at all. This one is a Haswell iGPU whose
     * Vulkan support Mesa itself calls incomplete, so a Windows game that wants
     * Direct3D through DXVK starts, fails to make a device, and exits in under
     * a second — indistinguishable, from the outside, from a launch that did
     * nothing. Forcing WineD3D translates Direct3D to OpenGL instead, which
     * that hardware does support, and the same game then runs.
     *
     * The engine already reads per-game environment from library.db's
     * custom_env (KEY=VALUE, one per line). This only has to set one variable
     * in it without disturbing anything a person put there by hand.
     */
    const WINED3D = 'PROTON_USE_WINED3D=1';

    function compatMode(gameId) {
        const lib = openLibrary();
        if (!lib) return 'auto';
        try {
            const row = lib.prepare('SELECT custom_env FROM games WHERE id=?').get(String(gameId));
            return String(row?.custom_env || '').includes('PROTON_USE_WINED3D=1') ? 'opengl' : 'auto';
        } catch (e) {
            return 'auto';
        } finally {
            try { lib.close(); } catch (e) {}
        }
    }

    function setCompatMode(gameId, mode) {
        const p = dbPath();
        if (!p) return { ok: false, error: 'The Installer library is not available.' };
        let write = null;
        try {
            write = new Database(p, { timeout: 4000 });
            const row = write.prepare('SELECT custom_env FROM games WHERE id=?').get(String(gameId));
            if (!row) return { ok: false, error: 'That game is not in the Installer library.' };
            // Everything except our own line is the user's, and stays.
            const kept = String(row.custom_env || '')
                .split('\n')
                .map(l => l.trim())
                .filter(Boolean)
                .filter(l => !/^PROTON_USE_WINED3D=/i.test(l));
            if (mode === 'opengl') kept.push(WINED3D);
            write.prepare('UPDATE games SET custom_env=? WHERE id=?').run(kept.join('\n'), String(gameId));
            return { ok: true, mode };
        } catch (e) {
            return { ok: false, error: 'Could not save that setting.' };
        } finally {
            try { write && write.close(); } catch (e) {}
        }
    }

    // games.db stores the link as '<store>_<app_id>'; this is the only place
    // that spelling is built, so a change to it has one home.
    const installerGameIdFor = (store, appId) => `${String(store).toLowerCase()}_${appId}`;

    return { status, owned, counts, refreshOwned, install, uninstall, cancel, freeSpace, installDir,
             compatMode, setCompatMode, installerGameIdFor };
}

module.exports = { create, DEFAULT_DIR };
