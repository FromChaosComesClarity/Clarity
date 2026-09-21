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
const $art   = document.getElementById('art');
const $prose = document.getElementById('prose');

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
let prefs = { onlyInstalled: false, sort: 'recent', store: '' };
let query = '';                         // what has been typed on the search screen
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
        prose: built.prose, art: built.art, scroll: 0,
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
    here.prose = built.prose;
    here.art = built.art;
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

    paintArt(here.art);

    // Prose screens have no rows, and rows screens have no prose. Switching
    // between them is switching which of the two is in the body.
    $prose.hidden = !here.prose;
    $menu.hidden = !!here.prose;
    document.body.dataset.prose = here.prose ? '1' : '0';
    if (here.prose) {
        $prose.textContent = here.prose;
        $prose.scrollTop = here.scroll || 0;
        $empty.hidden = true;
        return;
    }

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


/*
 * The backdrop on a game's screen.
 *
 * ⚠️ Heavily darkened, and that is the whole design. A screenshot behind a menu
 * is the one place this face spends light, and on a CRT light is phosphor wear;
 * it is also the fastest way to make white text unreadable. So the picture sits
 * at low luminance under a gradient that keeps the rows legible, and it is a
 * screenshot rather than a cover because a 2:3 box shot cannot fill a 4:3 frame
 * without either bars or a crop that throws away the art.
 *
 * Hero art first (it is drawn to be a backdrop), then a screenshot, then the
 * cover as a last resort. Most rows have none of the three, and that is fine —
 * the menu is designed to work with no art at all.
 */
function paintArt(details) {
    const src = details && (details.hero || details.shot || details.cover);
    if (!src) { $art.style.backgroundImage = ''; document.body.dataset.art = '0'; return; }
    $art.style.backgroundImage = `url("file://${encodeURI(src).replace(/#/g, '%23')}")`;
    document.body.dataset.art = '1';
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

    rows.push({ kind: 'nav', label: 'Search', run: () => { query = ''; push(searchScreen); } });
    rows.push({ kind: 'nav', label: 'Library', meta: String(filtered().length), run: () => push(libraryScreen) });
    rows.push({ kind: 'nav', label: 'Filters', meta: filterSummary(), run: () => push(filtersScreen) });
    rows.push({ kind: 'action', label: 'Couch Mode', run: () => window.crt.openFace('couch') });
    rows.push({ kind: 'action', label: 'Desktop Mode', run: () => window.crt.openFace('manager') });
    rows.push({ kind: 'nav', label: 'Settings', run: () => push(settingsScreen) });
    rows.push({ kind: 'action', label: 'Exit', run: () => window.crt.quit() });

    return { title: 'CLARITY', rows };
}

/*
 * The filters, in one place.
 *
 * ⚠️ A row can front several stores at once — Store is free text like
 * "Steam, GOG" — so a store filter has to match a substring rather than compare
 * equal, or every multi-store game disappears from both of its stores.
 */
function filtered() {
    let list = games;
    if (prefs.onlyInstalled) list = list.filter(g => g.installed);
    if (prefs.store) {
        const want = prefs.store.toLowerCase();
        list = list.filter(g => String(g.store || '').toLowerCase().includes(want));
    }
    return list;
}

function filterSummary() {
    const bits = [];
    if (prefs.store) bits.push(prefs.store.toUpperCase());
    if (prefs.onlyInstalled) bits.push('INSTALLED');
    return bits.join(' · ') || 'NONE';
}

// Every store named by any row, split out of the free-text field, so the list
// offers what the library actually contains rather than a hardcoded set.
function storeList() {
    const seen = new Map();
    for (const g of games) {
        for (const part of String(g.store || '').split(',')) {
            const name = part.trim();
            if (!name) continue;
            const key = name.toLowerCase();
            seen.set(key, (seen.get(key) || 0) + 1);
        }
    }
    return [...seen.entries()]
        .map(([key, count]) => ({ key, count, label: key.charAt(0).toUpperCase() + key.slice(1) }))
        .sort((a, b) => b.count - a.count);
}

function filtersScreen() {
    const rows = [{
        kind: 'action', label: 'All stores',
        pill: prefs.store ? '' : 'ON',
        run: async () => { prefs.store = ''; await saveSetting('crt_store', ''); refresh(filtersScreen); },
    }];

    for (const store of storeList()) {
        rows.push({
            kind: 'action',
            label: store.label,
            meta: String(store.count),
            pill: prefs.store === store.key ? 'ON' : '',
            run: async () => {
                prefs.store = prefs.store === store.key ? '' : store.key;
                await saveSetting('crt_store', prefs.store);
                refresh(filtersScreen);
            },
        });
    }

    rows.push({
        kind: 'toggle', label: 'Show only installed',
        pill: prefs.onlyInstalled ? 'ON' : 'OFF',
        run: async () => {
            prefs.onlyInstalled = !prefs.onlyInstalled;
            await saveSetting('crt_only_installed', prefs.onlyInstalled ? '1' : '0');
            refresh(filtersScreen);
        },
    });

    return { title: 'FILTERS', rows, okLabel: 'CHOOSE' };
}

async function saveSetting(key, value) {
    try { await window.crt.setSetting(key, value); } catch (e) { /* a lost preference is not worth failing over */ }
}

/*
 * Search: type, and the list narrows.
 *
 * ⚠️ This exists because the input story changed. The face was built for a
 * D-pad, where typing is a torture device and a menu of rows is the only sane
 * shape. It is driven from a keyboard now, and with a keyboard the fastest path
 * to one game out of 523 is its name. The row grammar does not change — the
 * query is simply a row that shows what has been typed.
 */
function searchScreen() {
    const q = query.trim().toLowerCase();
    const matches = q
        ? filtered().filter(g => g.name.toLowerCase().includes(q)).slice(0, 200)
        : [];

    const rows = [{
        kind: 'query',
        label: query ? query : 'Type to search',
        meta: q ? `${matches.length}` : '',
        typing: true,
    }];

    for (const g of matches) rows.push(gameRow(g));

    return {
        title: 'SEARCH',
        rows,
        okLabel: 'OPEN',
        emptyText: 'NOTHING MATCHES',
    };
}

function gameRow(g) {
    return {
        kind: 'game',
        game: g,
        label: g.name,
        thumb: g.cover,
        meta: g.year || '',
        pill: g.installed ? '' : 'GET',
        run: () => openGame(g),
    };
}

function libraryScreen() {
    let list = filtered().slice();

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

    const title = prefs.store || prefs.onlyInstalled
        ? `LIBRARY · ${filterSummary()}`
        : 'LIBRARY';

    return {
        title,
        rows,
        okLabel: 'OPEN',
        emptyText: prefs.onlyInstalled || prefs.store ? 'NOTHING MATCHES THESE FILTERS' : 'THE LIBRARY IS EMPTY',
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
const detailCache = new Map();

async function openGame(game) {
    if (!launcherCache.has(game.id) || !detailCache.has(game.id)) {
        $status.textContent = 'READING…';
        try {
            const [launchers, details] = await Promise.all([
                window.crt.launchers(game.id),
                window.crt.game(game.id),
            ]);
            launcherCache.set(game.id, launchers || []);
            detailCache.set(game.id, details || null);
        } catch (e) {
            launcherCache.set(game.id, launcherCache.get(game.id) || []);
            detailCache.set(game.id, null);
        }
        $status.textContent = '';
    }
    push(gameScreen, game);
}

function gameScreen(game) {
    const launchers = launcherCache.get(game.id) || [];
    const details = detailCache.get(game.id);
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

    if (details && details.description) {
        rows.push({ kind: 'nav', label: 'About this game', run: () => push(aboutScreen, game) });
    }

    // What is known about the game, stated rather than offered. These rows are
    // drawn flat and the cursor steps over them.
    const facts = [game.genre, game.year, details && details.developer].filter(Boolean).join(' · ');
    if (facts) rows.push({ kind: 'info', label: facts });
    if (game.lastPlayed) rows.push({ kind: 'info', label: `Last played ${ago(game.lastPlayed)}` });
    if (!game.installed) rows.push({ kind: 'info', label: 'Not installed' });

    return { title: game.name.toUpperCase(), rows, okLabel: 'PLAY', art: details };
}

/*
 * The blurb, on a screen of its own.
 *
 * Paragraphs, not rows: this is the one place in the face that is prose, and
 * squeezing it into the row grammar would make it unreadable. Scrolled with the
 * same keys everything else uses.
 */
function aboutScreen(game) {
    const details = detailCache.get(game.id);
    return {
        title: 'ABOUT',
        rows: [],
        prose: (details && details.description) || '',
        okLabel: 'CLOSE',
        art: details,
        emptyText: '',
    };
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

// ⚠️ "Show only installed" lives in Filters, not here, and deliberately in one
// place only. It was in both for a moment and that is worse than either: two
// rows with the same label and the same state, in different menus, leave you
// checking which one you actually changed.
function settingsScreen() {
    const rows = [
        {
            kind: 'toggle',
            label: 'Sort library by',
            pill: prefs.sort === 'name' ? 'NAME' : 'RECENT',
            run: async () => {
                prefs.sort = prefs.sort === 'name' ? 'recent' : 'name';
                await saveSetting('crt_sort', prefs.sort);
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
    const here = screen();

    /*
     * Prose scrolls; it has no rows to move between. Handled before everything
     * else so the About screen does not try to run a cursor over an empty list.
     */
    if (here && here.prose) {
        const step = e.key === 'PageDown' || e.key === 'PageUp' ? $prose.clientHeight - 24 : 40;
        if (e.key === 'ArrowDown' || e.key === 'PageDown') {
            here.scroll = Math.min($prose.scrollHeight, here.scroll + step);
            $prose.scrollTop = here.scroll;
        } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
            here.scroll = Math.max(0, here.scroll - step);
            $prose.scrollTop = here.scroll;
        } else if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'ArrowLeft' || e.key === 'Enter') {
            pop();
        } else {
            return;
        }
        e.preventDefault();
        return;
    }

    /*
     * Typing, on the search screen only.
     *
     * ⚠️ Checked before the navigation keys, and deliberately narrow: a single
     * printable character with no modifier. Without the modifier test, Ctrl+W
     * types a "w" into the query instead of doing whatever the user meant, and
     * without the length test every named key ("Shift", "Enter") arrives as a
     * word and lands in the query as one.
     */
    if (here && here.rows[0] && here.rows[0].typing) {
        if (e.key === 'Backspace') {
            query = query.slice(0, -1);
            refresh(searchScreen);
            e.preventDefault();
            return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            query += e.key;
            refresh(searchScreen);
            e.preventDefault();
            return;
        }
    }

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
            // nothing where it is not, rather than acting as a second Enter.
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
        const [onlyInstalled, sort, store] = await Promise.all([
            window.crt.getSetting('crt_only_installed'),
            window.crt.getSetting('crt_sort'),
            window.crt.getSetting('crt_store'),
        ]);
        prefs.onlyInstalled = onlyInstalled === '1';
        prefs.sort = sort === 'name' ? 'name' : 'recent';
        prefs.store = String(store || '');
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

