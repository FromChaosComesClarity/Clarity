'use strict';
/*
 * ── Ctrl+Q, quitting on purpose ──────────────────────────────────────────────
 *
 * Until now the only way out was the window manager's close action (meta+w on
 * Omarchy), which is not really a shutdown: it is a window closing that the app
 * happens to notice. There was no key to press inside Clarity at all, because every
 * face runs frameless with setMenu(null), so there is no menu for Electron to hang an
 * accelerator on and nothing was ever bound.
 *
 * ⚠️ before-input-event, per window, NOT globalShortcut. A global registration takes
 * Ctrl+Q away from every other application on the desktop for as long as Clarity is
 * open, and Ctrl+Q is not Clarity's to take. This way the key only means anything
 * while one of our own windows has focus.
 *
 * ⚠️ The reaping hangs off before-quit rather than off the shortcut, so that EVERY way
 * out cleans up: Ctrl+Q, meta+w, the Couch and CRT quit buttons, window-all-closed,
 * and any app.quit() added later. The suite already learned this lesson once with the
 * game session signal, which lives inside spawnGame precisely because the call sites
 * drift. Same reasoning here.
 */

const { app, dialog, BrowserWindow } = require('electron');
const shutdown = require('./shutdown.js');

/*
 * Guards. `asking` stops a second Ctrl+Q stacking another dialog on top of the first,
 * and `reaped` is what lets the second pass through before-quit actually quit.
 */
let asking = false;
let reaped = false;

/* "Doom", "Doom and Quake", "Doom, Quake and 2 more" */
function nameList(recs) {
    const names = recs.map(r => r.label).filter(Boolean);
    if (!names.length) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

function describe(pending) {
    const games = pending.filter(p => p.kind === 'game');
    const dls   = pending.filter(p => p.kind === 'download');
    const parts = [];
    if (games.length) {
        const n = nameList(games);
        parts.push(n ? `${n} ${games.length === 1 ? 'is' : 'are'} still running`
                     : `${games.length} game${games.length === 1 ? '' : 's'} still running`);
    }
    if (dls.length) {
        const n = nameList(dls);
        parts.push(n ? `${n} ${dls.length === 1 ? 'is' : 'are'} still downloading`
                     : `${dls.length} download${dls.length === 1 ? '' : 's'} still going`);
    }
    return parts.join(', ') + '.';
}

/*
 * Returns 'leave' | 'all' | 'cancel'.
 *
 * ⚠️ Leaving it running is the default button and Cancel is the escape route, because
 * closing a game is the only choice here that cannot be undone: an unsaved hour goes
 * with it. Downloads are named in the same breath because both GOG and Epic resume,
 * so stopping one costs time rather than progress.
 */
async function askAbout(pending) {
    const games = pending.filter(p => p.kind === 'game');
    const closeLabel = games.length
        ? (games.length === 1 ? 'Close it too and quit' : 'Close them too and quit')
        : 'Stop and quit';
    const parent = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    const opts = {
        type: 'question',
        title: 'Quit Clarity',
        message: describe(pending),
        detail: 'Clarity can quit and leave it alone, or close it on the way out.',
        buttons: ['Quit, leave it running', closeLabel, 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
    };
    const { response } = parent
        ? await dialog.showMessageBox(parent, opts)
        : await dialog.showMessageBox(opts);
    return response === 1 ? 'all' : response === 2 ? 'cancel' : 'leave';
}

/*
 * The deliberate quit. Asks about anything the user would not want killed silently,
 * then hands over to app.quit(), which runs the before-quit hook below and so reaps
 * the helpers on the same path as every other exit.
 */
async function requestQuit({ confirm = true, graceMs } = {}) {
    if (asking) return;
    try {
        const pending = confirm ? shutdown.live(['game', 'download']) : [];
        if (pending.length) {
            asking = true;
            let choice;
            try { choice = await askAbout(pending); } finally { asking = false; }
            if (choice === 'cancel') return;
            if (choice === 'all') {
                // Same grace period the helper reap uses, so graceMs means one thing
                // throughout rather than quietly applying to only half the shutdown.
                try { await shutdown.reap(['game', 'download'], graceMs ? { graceMs } : undefined); } catch {}
            }
        }
    } catch {
        // A dialog that will not open must not become a door that will not close.
    }
    app.quit();
}

/*
 * Reap Clarity's own helpers on the way out, whichever way out it is.
 *
 * before-quit is prevented exactly once so the async reap can finish, then quit is
 * re-issued and the second pass falls straight through. The timeout is a backstop: if
 * reaping somehow hangs, the app still goes away, because a shutdown that can get
 * stuck is the bug this is meant to fix rather than a new way to cause it.
 */
function installQuitHook({ graceMs, bindWindows = true } = {}) {
    /*
     * Every window a face ever opens, rather than a bindQuitShortcut() call next to each
     * new BrowserWindow. The Manager alone opens seven (library, manual, two store
     * logins, the PICO-8 browser, a popup, an export surface) and the eighth would be
     * the one somebody forgot, leaving Ctrl+Q mysteriously dead on exactly one window.
     */
    if (bindWindows) app.on('browser-window-created', (_e, win) => bindQuitShortcut(win, { graceMs }));

    app.on('before-quit', (e) => {
        if (reaped) return;
        reaped = true;
        e.preventDefault();
        const done = () => { try { app.quit(); } catch {} };
        const guard = setTimeout(done, (graceMs ?? 2500) + 1500);
        shutdown.reap('helper', graceMs ? { graceMs } : undefined)
            .catch(() => {})
            .finally(() => { clearTimeout(guard); done(); });
    });
}

/* Ctrl+Q while this window has focus. Safe to call on every window a face opens. */
function bindQuitShortcut(win, opts = {}) {
    if (!win || win.isDestroyed()) return;
    win.webContents.on('before-input-event', (e, input) => {
        if (input.type !== 'keyDown') return;
        if (!input.control || input.alt || input.meta || input.shift) return;
        if (String(input.key || '').toLowerCase() !== 'q') return;
        e.preventDefault();
        requestQuit(opts);
    });
}

module.exports = { installQuitHook, bindQuitShortcut, requestQuit };
