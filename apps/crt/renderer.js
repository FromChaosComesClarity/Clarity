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

function push(builder) {
    const built = builder();
    stack.push({ title: built.title, rows: built.rows, index: 0, okLabel: built.okLabel });
    render();
}

function pop() {
    if (stack.length <= 1) return;      // the root is the floor; B there does nothing
    stack.pop();
    render();
}

// Rebuild the screen under the cursor in place, keeping the cursor where it is.
// Used by toggles, which change the row they live on.
function refresh(builder) {
    const here = screen();
    const at = here.index;
    const built = builder();
    here.title = built.title;
    here.rows = built.rows;
    here.okLabel = built.okLabel;
    here.index = Math.min(at, built.rows.length - 1);
    render();
}

// ── Render ───────────────────────────────────────────────────────────────────

function render() {
    const here = screen();
    if (!here) return;

    $crumb.textContent = stack.map(s => s.title).join('  ›  ');
    $tally.textContent = here.rows.length > 1 ? `${here.index + 1} / ${here.rows.length}` : '';
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
            run: () => launch(last),
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
        label: g.name,
        thumb: g.cover,
        meta: g.year || '',
        pill: g.installed ? '' : 'GET',
        run: () => launch(g),
    }));

    return {
        title: prefs.onlyInstalled ? 'LIBRARY · INSTALLED' : 'LIBRARY',
        rows,
        okLabel: 'PLAY',
        emptyText: prefs.onlyInstalled ? 'NOTHING INSTALLED YET' : 'THE LIBRARY IS EMPTY',
    };
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

// ⚠️ Not a launcher. An installed game is handed to the suite as --play, an
// uninstalled one as --game, which opens its page where the Install button is.
// What "play" means past that point (the multi-store picker, which engine,
// which Doom, the install-state check, the last-played write) is the Manager's
// decision tree and this face does not get a second opinion about it.
function launch(game) {
    if (!game) return;
    $status.textContent = game.installed ? 'STARTING…' : 'OPENING…';
    if (game.installed) window.crt.play(game.id);
    else window.crt.openFace([`--game=${game.id}`]);
}

// ── Input ────────────────────────────────────────────────────────────────────
// Arrow keys, Enter and Escape, which is exactly what the OmaCRT gamepad daemon
// emits, so the pad needs nothing special here and a keyboard still works.

function move(delta) {
    const here = screen();
    if (!here || !here.rows.length) return;
    here.index = (here.index + delta + here.rows.length) % here.rows.length;
    render();
}

function page(delta) {
    const here = screen();
    if (!here || !here.rows.length) return;
    const visible = Math.max(1, Math.floor($menu.clientHeight / 70));
    here.index = Math.min(here.rows.length - 1, Math.max(0, here.index + delta * visible));
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
    stack.push({ title: built.title, rows: built.rows, index: 0, okLabel: built.okLabel });
    render();
})();

