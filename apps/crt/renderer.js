'use strict';
/*
 * Clarity, CRT face — navigation.
 *
 * A stack of menus and a cursor, which is the whole interaction model: Up and
 * Down move, A descends or acts, B goes back. That is deliberately the entire
 * vocabulary, because it is the vocabulary a D-pad has and the one a TV menu
 * has always had. Nothing here needs a pointer, a text field or a second hand.
 *
 * Screens are built as plain data (a title and an array of rows) and rendered
 * by one function, so adding a branch is adding a screen builder rather than
 * adding a view.
 */

const $menu  = document.getElementById('menu');
const $crumb = document.getElementById('crumb');
const $tally = document.getElementById('tally');
const $empty = document.getElementById('empty');
const $status = document.getElementById('status');
const $hintOkLabel = document.getElementById('hintOkLabel');

// ── Theme ────────────────────────────────────────────────────────────────────
// Every colour in the stylesheet is a variable, so following the user's theme is
// writing six of them. The live feed means `omarchy theme set` restyles this
// face while it is open rather than at next launch.

function applyTheme(description) {
    const t = description && description.available && description.theme;
    if (!t) return;
    const root = document.documentElement.style;
    if (t.bg)          root.setProperty('--bg', t.bg);
    if (t.bg_menu)     root.setProperty('--panel', t.bg_menu);
    if (t.accent)      root.setProperty('--accent', t.accent);
    if (t.text_main)   root.setProperty('--text', t.text_main);
    if (t.text_dim)    root.setProperty('--text-dim', t.text_dim);
    if (t.border_solid) root.setProperty('--edge', t.border_solid);
}

// ── State ────────────────────────────────────────────────────────────────────

let games = [];
let prefs = { onlyInstalled: false, sort: 'recent' };
const stack = [];                       // [{ title, rows, index }]

const screen = () => stack[stack.length - 1];

// A row the cursor can land on. Information rows are drawn but never selected,
// so a screen that opens on one starts the cursor below it instead.
const selectable = (row) => !!row && row.kind !== 'info' && typeof row.run === 'function';
const firstSelectable = (rows) => Math.max(0, rows.findIndex(selectable));

function push(builder, arg) {
    const built = builder(arg);
    stack.push({
        title: built.title, rows: built.rows, index: firstSelectable(built.rows),
        okLabel: built.okLabel, emptyText: built.emptyText,
    });
    render();
}

function pop() {
    if (stack.length <= 1) return;      // the root is the floor; B there does nothing
    stack.pop();
    render();
}

// Rebuild the screen under the cursor in place, keeping the cursor where it is.
// Used by toggles, which change the row they live on.
function refresh(builder, arg) {
    const here = screen();
    const at = here.index;
    const built = builder(arg);
    here.title = built.title;
    here.rows = built.rows;
    here.okLabel = built.okLabel;
    here.emptyText = built.emptyText;
    here.index = Math.max(0, Math.min(at, built.rows.length - 1));
    if (!selectable(here.rows[here.index])) here.index = firstSelectable(here.rows);
    render();
}

// ── Render ───────────────────────────────────────────────────────────────────

function render() {
    const here = screen();
    if (!here) return;

    $crumb.textContent = stack.map(s => s.title).join('  ›  ');
    // Counted over the rows the cursor can actually reach, so the tally matches
    // what pressing Down does.
    const choices = here.rows.filter(selectable).length;
    const at = here.rows.slice(0, here.index + 1).filter(selectable).length;
    $tally.textContent = choices > 1 ? `${at} / ${choices}` : '';
    $hintOkLabel.textContent = here.okLabel || 'SELECT';

    $menu.replaceChildren();
    $empty.hidden = here.rows.length > 0;
    if (!here.rows.length) {
        $empty.textContent = here.emptyText || 'NOTHING HERE';
        return;
    }

    here.rows.forEach((row, i) => {
        const li = document.createElement('li');
        li.className = 'row';
        li.dataset.kind = row.kind || 'action';
        li.dataset.on = i === here.index ? '1' : '0';

        if (row.thumb) {
            const img = document.createElement('img');
            img.className = 'thumb';
            img.src = 'file://' + encodeURI(row.thumb).replace(/#/g, '%23');
            // A missing cover is common enough (a custom install, a fan game)
            // that it has to look deliberate rather than broken.
            img.onerror = () => img.remove();
            li.append(img);
        }

        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = row.label;
        li.append(label);

        if (row.meta) {
            const meta = document.createElement('span');
            meta.className = 'meta';
            meta.textContent = row.meta;
            li.append(meta);
        }

        if (row.pill) {
            const pill = document.createElement('span');
            pill.className = 'pill';
            pill.textContent = row.pill;
            li.append(pill);
        }

        if (row.kind === 'nav') {
            const chev = document.createElement('span');
            chev.className = 'chev';
            chev.textContent = '›';
            li.append(chev);
        }

        $menu.append(li);
    });

    const on = $menu.children[here.index];
    if (on) on.scrollIntoView({ block: 'nearest' });
}

// ── Screens ──────────────────────────────────────────────────────────────────

function rootScreen() {
    const rows = [];
    const last = games.find(g => g.lastPlayed > 0 && g.installed);

    // Continue leads, when there is something to continue. A launcher's most
    // likely answer is the thing you were just doing.
    if (last) {
        rows.push({
            kind: 'action', label: 'Continue', meta: last.name,
            run: () => play(last),
        });
    }

    rows.push({ kind: 'nav', label: 'Library', meta: String(games.length), run: () => push(libraryScreen) });
    rows.push({ kind: 'action', label: 'Couch Mode', run: () => window.crt.openFace('couch') });
    rows.push({ kind: 'action', label: 'Desktop Mode', run: () => window.crt.openFace('manager') });
    rows.push({ kind: 'nav', label: 'Settings', run: () => push(settingsScreen) });
    rows.push({ kind: 'action', label: 'Exit', run: () => window.crt.quit() });

    return { title: 'CLARITY', rows };
}

function libraryScreen() {
    let list = prefs.onlyInstalled ? games.filter(g => g.installed) : games.slice();

    if (prefs.sort === 'name') {
        list.sort((a, b) => a.name.localeCompare(b.name));
    } // 'recent' is the order the query already returned

    const rows = list.map(g => ({
        kind: 'game',
        game: g,
        label: g.name,
        thumb: g.cover,
        meta: g.year || '',
        pill: g.installed ? '' : 'GET',
        run: () => openGame(g),
    }));

    return {
        title: prefs.onlyInstalled ? 'LIBRARY · INSTALLED' : 'LIBRARY',
        rows,
        okLabel: 'OPEN',
        emptyText: prefs.onlyInstalled ? 'NOTHING INSTALLED YET' : 'THE LIBRARY IS EMPTY',
    };
}

/*
 * One game.
 *
 * ⚠️ The launchers have to be fetched before this screen can be built, because
 * whether there are one or four of them is the difference between a "Play" row
 * and a store picker. Fetching on the way in is what lets the screen builder
 * stay synchronous like every other one.
 */
const launcherCache = new Map();

async function openGame(game) {
    if (!launcherCache.has(game.id)) {
        $status.textContent = 'READING…';
        try { launcherCache.set(game.id, await window.crt.launchers(game.id) || []); }
        catch (e) { launcherCache.set(game.id, []); }
        $status.textContent = '';
    }
    push(gameScreen, game);
}

function gameScreen(game) {
    const launchers = launcherCache.get(game.id) || [];
    const rows = [];

    if (!launchers.length) {
        // A real state, not an error: plenty of rows are catalogue entries with
        // no command attached yet. Saying so is better than a Play button that
        // does nothing.
        rows.push({ kind: 'info', label: 'No launch command set' });
    } else if (launchers.length === 1) {
        rows.push({ kind: 'action', label: 'Play', run: () => play(game, launchers[0]) });
    } else {
        // A genuinely multi-store row — the same game owned on Steam and GOG,
        // say. Which copy to start is the user's call, so it is asked rather
        // than guessed, and each says whether it is actually installed.
        for (const l of launchers) {
            rows.push({
                kind: 'action',
                label: `Play on ${l.label.replace(/ via Installer$/, '')}`,
                pill: l.installed ? 'INSTALLED' : '',
                run: () => play(game, l),
            });
        }
    }

    // What is known about the game, stated rather than offered. These rows are
    // drawn flat and the cursor steps over them.
    const facts = [game.genre, game.year].filter(Boolean).join(' · ');
    if (facts) rows.push({ kind: 'info', label: facts });
    if (game.lastPlayed) rows.push({ kind: 'info', label: `Last played ${ago(game.lastPlayed)}` });
    if (!game.installed) rows.push({ kind: 'info', label: 'Not installed' });

    return { title: game.name.toUpperCase(), rows, okLabel: 'PLAY' };
}

function ago(ms) {
    const days = Math.floor((Date.now() - Number(ms)) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
    const years = Math.floor(months / 12);
    return years === 1 ? '1 year ago' : `${years} years ago`;
}

function settingsScreen() {
    const rows = [
        {
            kind: 'toggle',
            label: 'Show only installed',
            pill: prefs.onlyInstalled ? 'ON' : 'OFF',
            run: async () => {
                prefs.onlyInstalled = !prefs.onlyInstalled;
                await window.crt.setSetting('crt_only_installed', prefs.onlyInstalled ? '1' : '0');
                refresh(settingsScreen);
            },
        },
        {
            kind: 'toggle',
            label: 'Sort library by',
            pill: prefs.sort === 'name' ? 'NAME' : 'RECENT',
            run: async () => {
                prefs.sort = prefs.sort === 'name' ? 'recent' : 'name';
                await window.crt.setSetting('crt_sort', prefs.sort);
                refresh(settingsScreen);
            },
        },
    ];

    return { title: 'SETTINGS', rows, okLabel: 'CHANGE' };
}

/*
 * Starting a game, without going anywhere.
 *
 * The face stays exactly where it is: the game takes the screen, and when it
 * exits this menu is still here, on the same row. What "play" means — which
 * engine, which store, whether a shell command or the Installer — belongs to
 * packages/core/launch.js; this only picks the launcher and reports the answer.
 */
async function play(game, launcher) {
    if (!game) return;
    $status.textContent = 'STARTING…';
    try {
        const res = await window.crt.launch(game.id, launcher && launcher.cmd);
        if (res && res.ok === false) { fail(res.error); return; }
        game.lastPlayed = Date.now();
        // Cleared on a delay rather than immediately: the game takes a few
        // seconds to put a window up, and a menu that says nothing in the
        // meantime looks like it ignored the button.
        setTimeout(() => { if ($status.textContent === 'STARTING…') $status.textContent = ''; }, 6000);
    } catch (e) {
        fail('The game could not be started.');
    }
}

// ⚠️ A failure has to be visible *here*. On a TV there is no console to check
// and no notification area to glance at, and the usual cause — a Windows game
// with no Proton — kills the process instantly and silently.
function fail(message) {
    $status.textContent = String(message || 'COULD NOT START').toUpperCase();
    setTimeout(() => { $status.textContent = ''; }, 8000);
}

// The launch that failed after we handed off, which arrives later than the
// call's own answer and is usually the more useful of the two.
window.crt.onLaunchFailed((info) => fail(info && info.message));

// ── Input ────────────────────────────────────────────────────────────────────
// Arrow keys, Enter and Escape — a keyboard, which is what this is driven with.

function move(delta) {
    const here = screen();
    if (!here || !here.rows.some(selectable)) return;
    // Step over information rows. Bounded by the row count, so a screen that is
    // all information simply does not move.
    let i = here.index;
    for (let n = 0; n < here.rows.length; n++) {
        i = (i + delta + here.rows.length) % here.rows.length;
        if (selectable(here.rows[i])) break;
    }
    here.index = i;
    render();
}

function page(delta) {
    const here = screen();
    if (!here || !here.rows.some(selectable)) return;
    const row = $menu.children[0];
    const step = Math.max(1, Math.floor($menu.clientHeight / ((row ? row.offsetHeight : 52) + 4)));
    let i = Math.min(here.rows.length - 1, Math.max(0, here.index + delta * step));
    while (i >= 0 && i < here.rows.length && !selectable(here.rows[i])) i += delta > 0 ? 1 : -1;
    if (i < 0 || i >= here.rows.length) i = delta > 0 ? here.rows.map(selectable).lastIndexOf(true)
                                                      : firstSelectable(here.rows);
    here.index = i;
    render();
}

function activate() {
    const here = screen();
    const row = here && here.rows[here.index];
    if (row && typeof row.run === 'function') row.run();
}

window.addEventListener('keydown', (e) => {
    switch (e.key) {
        case 'ArrowUp':    move(-1); break;
        case 'ArrowDown':  move(1); break;
        case 'PageUp':     page(-1); break;
        case 'PageDown':   page(1); break;
        case 'Enter':      activate(); break;
        case 'Escape':
        case 'Backspace':
        case 'ArrowLeft':  pop(); break;
        case 'ArrowRight': {
            // Right descends where descending is what the row means, and does
            // nothing where it is not, rather than acting like a second Enter.
            const here = screen();
            const row = here && here.rows[here.index];
            if (row && row.kind === 'nav') row.run();
            break;
        }
        default: return;
    }
    e.preventDefault();
});

// ── Boot ─────────────────────────────────────────────────────────────────────

(async function start() {
    try { applyTheme(await window.crt.theme()); } catch (e) {}
    window.crt.onThemeChanged(applyTheme);

    try {
        const [onlyInstalled, sort] = await Promise.all([
            window.crt.getSetting('crt_only_installed'),
            window.crt.getSetting('crt_sort'),
        ]);
        prefs.onlyInstalled = onlyInstalled === '1';
        prefs.sort = sort === 'name' ? 'name' : 'recent';
    } catch (e) { /* defaults are fine */ }

    try { games = await window.crt.library(); } catch (e) { games = []; }

    stack.length = 0;
    const built = rootScreen();
    stack.push({
        title: built.title, rows: built.rows, index: firstSelectable(built.rows),
        okLabel: built.okLabel, emptyText: built.emptyText,
    });
    render();
})();

