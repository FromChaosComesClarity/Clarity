'use strict';
/*
 * Where this installation lives, written down for the desktop to read.
 *
 * Companion pieces, the Omarchy bar widget, its launcher overlay, the Clock, need
 * three things only the app knows for certain: which binary to run, and where the two
 * databases actually are. Every one of those is a *lookup*, never a guess: a second
 * consumer computing its own library.db path is precisely how the library got orphaned
 * once before (the two-library.db split fixed in 1.8.0). A hardcoded path in a plugin
 * is the same mistake wearing a different hat, and it only works on the machine it was
 * written on.
 *
 * So the app publishes them instead. Every Manager start rewrites
 * ~/.config/clarity/desktop.json, and anything on the desktop that wants to talk
 * to Clarity reads it there.
 *
 * ⚠️ For consumers: a missing file means "not installed, or never run". It is never a
 * licence to fall back to a guessed path. Report nothing rather than the wrong thing.
 *
 * ⚠️ Writes merge. The renderer contributes the command-palette actions once the UI is
 * up, long after main.js has written the paths, and neither half may erase the other's.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const HOME = os.homedir();

function descriptorDir() {
    const xdg = process.env.XDG_CONFIG_HOME;
    return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(HOME, '.config'), 'clarity');
}

function descriptorPath() {
    return path.join(descriptorDir(), 'desktop.json');
}

/*
 * The command a desktop integration should run to get this suite back.
 *
 * Prefers a Clarity AppImage sitting in the data directory over our own
 * process: `selfExecutable()` during development is the electron binary, which is
 * correct for us and useless to anyone else. The same preference is what
 * install-to-menu writes into its .desktop files, so the bar and the app menu open
 * the identical binary.
 */
function suiteExecutable(baseDir, selfExecutable) {
    try {
        const hit = fs.readdirSync(baseDir).find(f => /^Clarity.*\.AppImage$/i.test(f));
        if (hit) return path.join(baseDir, hit);
    } catch {}
    return selfExecutable || null;
}

function readDescriptor() {
    try { return JSON.parse(fs.readFileSync(descriptorPath(), 'utf8')) || {}; }
    catch { return {}; }
}

/*
 * Merge `patch` into the descriptor and write it out. Returns the path on success and
 * null on failure, a desktop integration that cannot be told where we are is a
 * missing icon in someone's bar, never a reason to interrupt the app.
 */
function writeDescriptor(patch) {
    try {
        const next = Object.assign(readDescriptor(), patch, {
            app: 'Clarity',
            updatedAt: Math.floor(Date.now() / 1000),
        });
        fs.mkdirSync(descriptorDir(), { recursive: true });
        fs.writeFileSync(descriptorPath(), JSON.stringify(next, null, 2) + '\n', 'utf8');
        return descriptorPath();
    } catch { return null; }
}

/*
 * Called once per Manager start with everything main.js already has resolved.
 * `installerDb` may be null, Installer's database does not exist until the first
 * store sign-in, and saying so is more useful than omitting the key.
 */
function publish({ version, baseDir, libraryDb, installerDb, selfExecutable }) {
    return writeDescriptor({
        version: version || null,
        exec: suiteExecutable(baseDir, selfExecutable),
        // The argv each face answers to, so a consumer never has to know our CLI by heart.
        faces: { manager: [], couch: ['--couch'], installer: ['installer'] },
        baseDir: baseDir || null,
        libraryDb: libraryDb || null,
        installerDb: installerDb || null,
    });
}

/*
 * The command palette's action list, published so the Omarchy launcher overlay offers
 * exactly the actions this build has, rather than a copy that silently drifts the
 * first time one is renamed. Ids are stable; names are what a person reads.
 */
function publishActions(actions) {
    const clean = (Array.isArray(actions) ? actions : [])
        .filter(a => a && typeof a.id === 'string' && typeof a.name === 'string')
        .map(a => ({ id: a.id, name: a.name }));
    if (!clean.length) return null;
    return writeDescriptor({ actions: clean });
}

module.exports = { descriptorPath, readDescriptor, writeDescriptor, publish, publishActions, suiteExecutable };
