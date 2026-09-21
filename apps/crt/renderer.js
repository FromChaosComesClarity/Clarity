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
        // ⚠️ Kept so a screen can rebuild itself without the caller naming it
        // again. Typing used to call refresh(searchScreen) literally, which
        // meant every other screen that accepted typing rebuilt as the search.
        builder, arg,
    });
    render();
}

/*
 * ⚠️ Rebuilt on the way back, not replayed.
 *
 * A screen's rows are a snapshot of the library at the moment it was built, and
 * coming back to one is exactly when that snapshot is most likely to be wrong —
 * you went away to install, uninstall, scrape or mark something. Returning to a
 * game's page after installing it and being offered "Install" again is what
 * this fixes.
 */
function pop() {
    if (stack.length <= 1) return;      // the root is the floor; Esc there does nothing
    stack.pop();
    const here = screen();
    if (here && typeof here.builder === 'function') {
        refresh(here.builder, here.arg);
        return;
    }
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
    here.builder = builder;
    here.arg = arg;
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

        if (row.fav) {
            const fav = document.createElement('span');
            fav.className = 'fav';
            li.append(fav);
        }

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
    rows.push({ kind: 'nav', label: 'Collections', run: () => openCollections() });
    rows.push({ kind: 'nav', label: 'Filters', meta: filterSummary(), run: () => push(filtersScreen) });
    rows.push({ kind: 'nav', label: 'Install', meta: storeSummary(), run: () => openStore() });
    rows.push({ kind: 'nav', label: 'Uninstall', run: () => openUninstall() });
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
/*
 * ⚠️ Matched on letters and digits alone, with the punctuation stripped from
 * both sides.
 *
 * A plain substring match cannot find "B.I.O.T.A." by typing "biota", and this
 * library is full of titles like it — S.T.A.L.K.E.R., DOOM + DOOM II, "Hack 'n
 * Splash". Typing the punctuation of a title you are searching *for* is not a
 * thing anyone does, least of all on a TV.
 */
const searchKey = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function searchScreen() {
    const q = searchKey(query);
    const matches = q
        ? filtered().filter(g => searchKey(g.name).includes(q)).slice(0, 200)
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
        // A filled block, not a star: at 480 interlaced lines a star's points
        // are single pixels and the first thing the display loses.
        fav: !!g.fav,
        meta: g.year || '',
        pill: g.installed ? '' : 'GET',
        run: () => openGame(g),
    };
}

function libraryScreen() {
    const title = prefs.store || prefs.onlyInstalled ? `LIBRARY · ${filterSummary()}` : 'LIBRARY';
    return {
        title,
        rows: sortedGames(filtered()).map(gameRow),
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
// What the Installer knows about this row, when it is a GOG or Epic game. Null
// for a Steam-only row, which installs through Steam and not through us.
const entryCache = new Map();
// 'auto' or 'opengl', for an installed GOG/Epic game.
const compatCache = new Map();

async function openGame(game) {
    if (!launcherCache.has(game.id) || !detailCache.has(game.id) || !entryCache.has(game.id)) {
        $status.textContent = 'READING…';
        try {
            const [launchers, details, entry, inPlaylists] = await Promise.all([
                window.crt.launchers(game.id),
                window.crt.game(game.id),
                window.crt.installerEntry(game.id),
                window.crt.gamePlaylists(game.id),
            ]);
            if (entry && entry.installed) {
                try { compatCache.set(game.id, await window.crt.compatGet(entry.id)); } catch (e) {}
            }
            launcherCache.set(game.id, launchers || []);
            detailCache.set(game.id, details || null);
            entryCache.set(game.id, entry || null);
            gamePlaylistCache.set(game.id, inPlaylists || []);
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

    // ⚠️ Only for a game the Installer owns. A Steam row installs through
    // Steam — offering an Install button here that cannot install would be a
    // worse lie than offering nothing.
    const entry = entryCache.get(game.id);
    if (entry && !entry.installed) {
        rows.push({ kind: 'action', label: 'Install', pill: entry.store.toUpperCase(), run: () => installFromGame(game, entry) });
    }

    if (details && details.description) {
        rows.push({ kind: 'nav', label: 'About this game', run: () => push(aboutScreen, game) });
    }

    // The two marks the rest of the suite already keeps, written the way it
    // writes them.
    rows.push({
        kind: 'toggle', label: 'Favourite', pill: game.fav ? 'ON' : 'OFF',
        run: () => toggleFlag(game, 'fav'),
    });
    rows.push({
        kind: 'toggle', label: 'Want to play', pill: game.want ? 'ON' : 'OFF',
        run: () => toggleFlag(game, 'want'),
    });
    rows.push({
        kind: 'nav', label: 'Playlists',
        meta: String((gamePlaylistCache.get(game.id) || []).length || ''),
        run: async () => {
            if (!playlists.length) { try { playlists = await window.crt.playlists() || []; } catch (e) {} }
            push(playlistsScreenFor, game);
        },
    });

    // Scraping, per game. A row that already has art offers a re-scrape — the
    // scraper keeps local art it did not fetch, so this is safe to press.
    const scraped = !!(details && (details.cover || details.description));
    rows.push({
        kind: 'action',
        label: scraped ? 'Refresh details' : 'Find art and details',
        run: () => scrapeGame(game),
    });
    // ⚠️ The escape hatch for the case a scrape cannot fix: the library matched
    // the wrong game entirely, and no amount of re-fetching the wrong id helps.
    rows.push({ kind: 'nav', label: 'Wrong game? Search by name', run: () => { query = game.name; push(matchScreen, game); } });

    if (entry && entry.installed) {
        const mode = compatCache.get(game.id) || 'auto';
        rows.push({
            kind: 'toggle',
            label: 'Graphics',
            pill: mode === 'opengl' ? 'OPENGL' : 'AUTO',
            run: () => toggleCompat(game, entry),
        });
        rows.push({ kind: 'action', label: 'Uninstall', pill: entry.store.toUpperCase(), run: () => uninstallFromGame(game, entry) });
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

/*
 * ── Collections ──────────────────────────────────────────────────────────────
 *
 * Favourites, want-to-play and playlists, which the library already had and
 * this face could not see. Favourites and Want to play sit alongside the
 * playlists rather than above them: they behave identically — a named set of
 * games — and giving them their own root rows would have said otherwise.
 *
 * ⚠️ A smart playlist computes its members from a rule every time it is read,
 * so it can be browsed but not edited by hand. The game screen says so rather
 * than offering an add that would be silently ignored.
 */
let playlists = [];

async function openCollections() {
    $status.textContent = 'READING…';
    try { playlists = await window.crt.playlists() || []; } catch (e) { playlists = []; }
    $status.textContent = '';
    push(collectionsScreen);
}

function collectionsScreen() {
    const favs = games.filter(g => g.fav);
    const wants = games.filter(g => g.want);
    const rows = [
        {
            kind: 'nav', label: 'Favourites', meta: String(favs.length),
            run: () => push(gamesScreen, { title: 'FAVOURITES', list: favs, empty: 'NOTHING MARKED YET' }),
        },
        {
            kind: 'nav', label: 'Want to play', meta: String(wants.length),
            run: () => push(gamesScreen, { title: 'WANT TO PLAY', list: wants, empty: 'NOTHING MARKED YET' }),
        },
    ];

    for (const list of playlists) {
        rows.push({
            kind: 'nav',
            label: list.name,
            meta: String(list.count),
            pill: list.smart ? 'SMART' : '',
            run: () => openPlaylist(list),
        });
    }

    rows.push({ kind: 'action', label: 'New playlist', run: () => { query = ''; push(newPlaylistScreen); } });
    if (playlists.some(p => !p.smart)) {
        rows.push({ kind: 'nav', label: 'Delete a playlist', run: () => push(deletePlaylistScreen) });
    }

    return { title: 'COLLECTIONS', rows, okLabel: 'OPEN' };
}

async function openPlaylist(list) {
    $status.textContent = 'READING…';
    let ids = [];
    try { ids = await window.crt.playlistGames(list.id) || []; } catch (e) {}
    $status.textContent = '';
    const members = new Set(ids);
    push(gamesScreen, {
        title: list.name.toUpperCase(),
        list: games.filter(g => members.has(g.id)),
        empty: 'THIS PLAYLIST IS EMPTY',
    });
}

// One list of games, however it was arrived at. Library, a playlist and the two
// marks all render through this, so they stay identical to use.
function gamesScreen({ title, list, empty }) {
    return {
        title,
        rows: sortedGames(list).map(gameRow),
        okLabel: 'OPEN',
        emptyText: empty || 'NOTHING HERE',
    };
}

function sortedGames(list) {
    const out = list.slice();
    if (prefs.sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

// Which playlists a game is in, fetched with everything else on the way into
// its screen.
const gamePlaylistCache = new Map();

function playlistsScreenFor(game) {
    const mine = new Set(gamePlaylistCache.get(game.id) || []);
    const rows = playlists.map(list => ({
        kind: list.smart ? 'info' : 'toggle',
        label: list.name,
        pill: list.smart ? 'SMART' : (mine.has(list.id) ? 'IN' : ''),
        run: list.smart ? undefined : async () => {
            const r = await window.crt.playlistToggle(list.id, game.id);
            if (!r || !r.ok) { fail((r && r.error) || 'Could not change that playlist.'); return; }
            const next = new Set(gamePlaylistCache.get(game.id) || []);
            if (r.member) next.add(list.id); else next.delete(list.id);
            gamePlaylistCache.set(game.id, [...next]);
            try { playlists = await window.crt.playlists() || playlists; } catch (e) {}
            refresh(playlistsScreenFor, game);
        },
    }));

    if (!playlists.length) rows.push({ kind: 'info', label: 'No playlists yet — make one in Desktop Mode' });

    return { title: 'PLAYLISTS', rows, okLabel: 'CHANGE' };
}


/*
 * Naming a new playlist.
 *
 * The same typing row the search screens use — the screen is the field, there
 * is no caret to place. ⚠️ Only manual playlists: a smart one is a saved query
 * and building a query needs more than a list of rows, so that stays a desktop
 * job and the collections screen labels those SMART.
 */
function newPlaylistScreen() {
    const name = query.trim();
    return {
        title: 'NEW PLAYLIST',
        rows: [
            { kind: 'query', label: query || 'Type a name', typing: true, run: () => createPlaylist() },
            name
                ? { kind: 'action', label: `Create "${name}"`, run: () => createPlaylist() }
                : { kind: 'info', label: 'Type a name, then press Enter' },
        ],
        okLabel: 'CREATE',
    };
}

async function createPlaylist() {
    const name = query.trim();
    if (!name) return;
    const r = await window.crt.playlistCreate(name);
    if (!r || !r.ok) { fail((r && r.error) || 'Could not create that playlist.'); return; }
    query = '';
    try { playlists = await window.crt.playlists() || []; } catch (e) {}
    $status.textContent = 'CREATED';
    setTimeout(() => { $status.textContent = ''; }, 4000);
    pop();
    refresh(collectionsScreen);
}

// ⚠️ Deleting asks first, on its own screen, for the same reason uninstalling
// does: one key does everything in this face, and a list you curated is not
// something to lose to a mis-press.
function deletePlaylistScreen() {
    const rows = playlists.filter(p => !p.smart).map(list => ({
        kind: 'nav',
        label: list.name,
        meta: String(list.count),
        run: () => push(confirmDeletePlaylistScreen, list),
    }));
    return { title: 'DELETE A PLAYLIST', rows, okLabel: 'CHOOSE', emptyText: 'NO PLAYLISTS TO DELETE' };
}

function confirmDeletePlaylistScreen(list) {
    return {
        title: list.name.toUpperCase(),
        rows: [
            { kind: 'info', label: `${list.count} games are in this playlist` },
            { kind: 'info', label: 'The games themselves are not touched' },
            { kind: 'action', label: 'Delete it', run: () => deletePlaylist(list) },
            { kind: 'action', label: 'Keep it', run: () => pop() },
        ],
        okLabel: 'CONFIRM',
    };
}

async function deletePlaylist(list) {
    const r = await window.crt.playlistDelete(list.id);
    if (!r || !r.ok) { fail((r && r.error) || 'Could not delete that playlist.'); return; }
    try { playlists = await window.crt.playlists() || []; } catch (e) {}
    $status.textContent = 'DELETED';
    setTimeout(() => { $status.textContent = ''; }, 4000);
    pop();
    pop();
    refresh(collectionsScreen);
}

/*
 * ── Launching ────────────────────────────────────────────────────────────────
 *
 * ⚠️ This screen exists because pressing Play looked like pressing nothing.
 *
 * A first launch of a Windows game is not instant and is not quick: the runner
 * downloads a multi-gigabyte Steam runtime, then builds a Wine prefix, and only
 * then does a window appear. Minutes. The face said "STARTING…" for six seconds
 * and then went quiet, so the only honest reading was that it had failed.
 *
 * The engine knew all of this the whole time — which phase, what percent,
 * whether the game process came up, and a diagnosis when it did not. Nothing
 * here is new information; it is information that was being thrown away.
 */
let launchRun = null;     // { title, phase, percent, message, state }

function launchScreen() {
    const run = launchRun || {};
    const rows = [];

    const pct = Number.isFinite(run.percent) && run.percent > 0 ? `${Math.round(run.percent)}%` : '';
    const phase = (run.phase || '').replace(/[_-]/g, ' ');

    if (run.state === 'failed') {
        rows.push({ kind: 'info', label: 'Could not start' });
        rows.push({ kind: 'info', label: run.message || 'No reason given.' });
        // The log is where the real answer is. Offered rather than shown,
        // because it is a wall of text and the line above is usually enough.
        rows.push({ kind: 'nav', label: 'What happened', run: () => showLaunchLog(run.title) });
    } else if (run.state === 'running') {
        rows.push({ kind: 'info', label: 'Running' });
        rows.push({ kind: 'info', label: 'This menu is behind the game' });
    } else if (run.state === 'exited') {
        rows.push({ kind: 'info', label: 'Closed' });
        // ⚠️ A Windows game that exits in seconds has almost certainly failed
        // to make a Direct3D device rather than been quit by anyone. Saying so
        // here is the difference between a dead end and a fix that is one press
        // away.
        if (run.quick) {
            rows.push({ kind: 'info', label: 'It closed straight away' });
            rows.push({ kind: 'info', label: 'Try Graphics: OpenGL on its page' });
            rows.push({ kind: 'nav', label: 'What happened', run: () => showLaunchLog(run.title) });
        }
    } else {
        rows.push({ kind: 'info', label: [phase || 'Starting', pct].filter(Boolean).join('  ·  ') });
        if (run.message) rows.push({ kind: 'info', label: run.message });
        // A first run downloads a runtime; saying so is the difference between
        // waiting and force-quitting.
        if (!run.message && !pct) rows.push({ kind: 'info', label: 'First run can take several minutes' });
    }

    rows.push({ kind: 'action', label: 'Back', run: () => { launchRun = null; pop(); } });

    // ⚠️ Not the game's name: the breadcrumb above already ends with it, and
    // using it here printed the title twice in a row.
    return { title: 'LAUNCHING', rows, okLabel: 'BACK' };
}

// The engine's log, on the prose screen the About blurb uses.
async function showLaunchLog(title) {
    $status.textContent = 'READING…';
    let text = '';
    try { text = await window.crt.launchLog(title) || ''; } catch (e) {}
    $status.textContent = '';
    push(() => ({
        title: 'WHAT HAPPENED',
        rows: [],
        prose: text || 'No log was written for this game.\n\nThat usually means it never started at all — a launch command that is wrong, or a store client that is not running.',
        okLabel: 'CLOSE',
    }));
}

// Redraw only while the launch screen is the one on top, so a game starting in
// the background never moves the cursor out from under the user.
function refreshLaunch() {
    const here = screen();
    if (here && here.builder === launchScreen) refresh(launchScreen);
}

window.crt.onLaunchProgress((info) => {
    if (!launchRun || !info) return;
    // ⚠️ Once it has failed, it has failed. The engine emits a final progress
    // event with an empty message *after* reporting the failure, and blindly
    // applying it wiped the reason — which is exactly how "Could not start"
    // came to be followed by "no reason given".
    if (launchRun.state === 'failed') return;
    launchRun = {
        ...launchRun,
        title: info.title || launchRun.title,
        phase: info.done ? launchRun.phase : (info.phase || launchRun.phase),
        percent: Number.isFinite(info.percent) ? info.percent : launchRun.percent,
        message: info.message || '',
    };
    refreshLaunch();
});

window.crt.onGameSession((info) => {
    if (!launchRun || !info) return;
    const quick = !info.running && Date.now() - (launchRun.startedAt || 0) < 25000;
    launchRun = { ...launchRun, state: info.running ? 'running' : 'exited', quick,
                  title: info.title || launchRun.title };
    refreshLaunch();
    // A game that has exited leaves nothing to look at; step back to where the
    // user was rather than stranding them on a dead panel.
    // A game that ran and was quit needs no epitaph; one that died on the spot
    // has something to say, so that screen stays until it is dismissed.
    if (!info.running && !quick) {
        setTimeout(() => {
            const here = screen();
            if (here && here.builder === launchScreen && launchRun && launchRun.state === 'exited') {
                launchRun = null;
                pop();
            }
        }, 4000);
    }
});

/*
 * ── Installing ───────────────────────────────────────────────────────────────
 *
 * Steam installs itself; GOG and Epic do not, and without this the only way to
 * put a game on this machine is the desktop. That is the gap this screen
 * closes.
 *
 * ⚠️ Signing in is not offered here. Both stores need an OAuth redirect
 * completed in a browser, which is hopeless at 720x480 across a room — so when
 * the account is not connected the screen says exactly that and points at
 * Desktop Mode for the one-time step, rather than pretending.
 */
let storeStatus = { available: false, gog: false, epic: false, counts: { total: 0, installed: 0, available: 0 } };
let ownedGames = [];
let installRun = null;                   // { title, percent, message } while one runs

function storeSummary() {
    if (!storeStatus.available) return '';
    return storeStatus.counts.available ? String(storeStatus.counts.available) : 'ALL INSTALLED';
}

async function openStore() {
    $status.textContent = 'READING…';
    try { storeStatus = await window.crt.storeStatus(); } catch (e) {}
    try { ownedGames = storeStatus.available ? await window.crt.storeAvailable() || [] : []; } catch (e) { ownedGames = []; }
    $status.textContent = '';
    push(storeScreen);
}

/*
 * The progress panel, pushed whenever an install starts — from the Install list
 * or from a game's own page.
 *
 * ⚠️ It is a screen rather than a line in the footer because the first version
 * put it in the footer and the user's verdict was "no feedback whatsoever". A
 * download of several gigabytes needs somewhere to say so.
 */
function installScreen() {
    const run = installRun || {};
    const pct = Number.isFinite(run.percent) && run.percent > 0 ? `${Math.round(run.percent)}%` : '';
    const step = String(run.step || 'starting').replace(/[_-]/g, ' ');
    const rows = [{ kind: 'info', label: run.title || 'Installing…' }];

    if (run.state === 'failed') {
        rows.push({ kind: 'info', label: 'Could not install' });
        rows.push({ kind: 'info', label: run.error || run.message || 'No reason given.' });
        rows.push({ kind: 'action', label: 'Back', run: () => { installRun = null; pop(); } });
    } else if (run.state === 'done') {
        rows.push({ kind: 'info', label: 'Installed' });
        rows.push({ kind: 'action', label: 'Back', run: () => { installRun = null; pop(); } });
    } else {
        rows.push({ kind: 'info', label: [step, pct].filter(Boolean).join('  ·  ').toUpperCase() });
        if (run.message) rows.push({ kind: 'info', label: run.message });
        rows.push({ kind: 'action', label: 'Cancel', run: () => { window.crt.installCancel(); $status.textContent = 'CANCELLING…'; } });
    }

    return { title: 'INSTALL', rows, okLabel: run.state ? 'BACK' : 'CANCEL' };
}

function storeScreen() {
    // No Installer library on this machine at all: nothing has ever been set
    // up, and that is a desktop job.
    if (!storeStatus.available) {
        return {
            title: 'INSTALL',
            rows: [
                { kind: 'info', label: 'No GOG or Epic library yet' },
                { kind: 'info', label: 'Sign in once from Desktop Mode' },
                { kind: 'action', label: 'Open Desktop Mode', run: () => window.crt.openFace('manager') },
            ],
            okLabel: 'OPEN',
        };
    }

    const rows = [];
    if (!storeStatus.gog && !storeStatus.epic) {
        rows.push({ kind: 'info', label: 'Not signed in to GOG or Epic' });
        rows.push({ kind: 'action', label: 'Open Desktop Mode to sign in', run: () => window.crt.openFace('manager') });
    }

    for (const game of ownedGames) {
        rows.push({
            kind: 'action',
            label: game.title,
            pill: game.store.toUpperCase(),
            run: () => startInstall({ id: game.id, title: game.title }),
        });
    }

    if (!ownedGames.length && (storeStatus.gog || storeStatus.epic)) {
        rows.push({ kind: 'info', label: 'Everything you own is installed' });
    }

    rows.push({
        kind: 'action', label: 'Refresh owned games',
        // The only way a purchase made anywhere else ever appears here.
        run: async () => {
            $status.textContent = 'REFRESHING…';
            const r = await window.crt.storeRefresh();
            $status.textContent = r && r.ok ? '' : 'COULD NOT REFRESH';
            try { storeStatus = await window.crt.storeStatus(); } catch (e) {}
            try { ownedGames = await window.crt.storeAvailable() || []; } catch (e) {}
            refresh(storeScreen);
        },
    });

    return {
        title: 'INSTALL',
        rows,
        okLabel: 'INSTALL',
        emptyText: 'NOTHING TO INSTALL',
    };
}

/*
 * Installing, from anywhere. The panel is pushed first so there is something on
 * screen before the first byte moves, and the result is reported on it rather
 * than in a message that scrolls away.
 */
async function startInstall({ id, title }) {
    installRun = { title, percent: 0, step: 'starting', message: '', error: '' };
    push(installScreen);

    const result = await window.crt.install(id);

    // ⚠️ The engine's own reason beats the caller's. ops.install() can only see
    // that the library still says "not installed"; the progress stream carries
    // what actually went wrong.
    installRun = {
        ...installRun,
        state: result && result.ok ? 'done' : 'failed',
        error: (installRun.error) || (result && result.error) || '',
    };

    try { storeStatus = await window.crt.storeStatus(); } catch (e) {}
    try { ownedGames = await window.crt.storeAvailable() || []; } catch (e) {}
    try { installedGames = await window.crt.installedGames() || []; } catch (e) {}
    try { games = await window.crt.library(); } catch (e) {}
    detailCache.clear();
    launcherCache.clear();
    entryCache.clear();

    refresh(installScreen);
}

/*
 * ── Scraping ─────────────────────────────────────────────────────────────────
 *
 * The whole point of this face is that the desktop is optional, and a library
 * of 523 rows with art on ten of them is the clearest case of it: without this
 * screen, filling them in means leaving the sofa.
 */
let scrapeCounts = { total: 0, missing: 0, installed: 0, installedMissing: 0 };
let scrapeRun = null;                    // { done, total, name } while a batch is going

function scrapeSummary() {
    if (!scrapeCounts.total) return '';
    return scrapeCounts.missing ? `${scrapeCounts.missing} MISSING` : 'ALL DONE';
}

function scrapeScreen() {
    if (scrapeRun) {
        // A run in progress owns the screen: one thing happening, one way to
        // stop it. Anything else here would be a button pressed mid-download.
        const pct = scrapeRun.total ? Math.round((scrapeRun.done / scrapeRun.total) * 100) : 0;
        return {
            title: 'ARTWORK AND DETAILS',
            rows: [
                { kind: 'info', label: `${scrapeRun.done} of ${scrapeRun.total}  ·  ${pct}%` },
                { kind: 'info', label: scrapeRun.name || 'Working…' },
                { kind: 'action', label: 'Stop', run: () => { window.crt.scrapeStop(); $status.textContent = 'STOPPING…'; } },
            ],
            okLabel: 'STOP',
        };
    }

    const rows = [
        {
            kind: 'action', label: 'Missing only', meta: String(scrapeCounts.missing),
            run: () => startScrape('missing'),
        },
        {
            kind: 'action', label: 'Installed games', meta: String(scrapeCounts.installed),
            run: () => startScrape('installed'),
        },
        {
            kind: 'action', label: 'Every game', meta: String(scrapeCounts.total),
            run: () => startScrape('all'),
        },
        { kind: 'info', label: `${scrapeCounts.total - scrapeCounts.missing} of ${scrapeCounts.total} have art` },
    ];

    return { title: 'ARTWORK AND DETAILS', rows, okLabel: 'START' };
}

/*
 * ⚠️ A batch is slow on purpose — four rate-limited services, one game at a
 * time — so "every game" over this library is tens of minutes. Saying so before
 * it starts is the difference between patience and a force-quit.
 */
async function startScrape(scope) {
    const total = scope === 'missing' ? scrapeCounts.missing
                : scope === 'installed' ? scrapeCounts.installed
                : scrapeCounts.total;
    if (!total) { $status.textContent = 'NOTHING TO DO'; setTimeout(() => { $status.textContent = ''; }, 4000); return; }

    scrapeRun = { done: 0, total, name: '' };
    refresh(scrapeScreen);

    const result = await window.crt.scrapeBatch(scope);
    scrapeRun = null;
    try { scrapeCounts = await window.crt.scrapeCounts(); } catch (e) {}
    try { storeStatus = await window.crt.storeStatus(); } catch (e) {}
    // The library list carries covers, so it is stale the moment a batch ends.
    try { games = await window.crt.library(); } catch (e) {}
    detailCache.clear();

    $status.textContent = result && result.ok
        ? `${result.scraped} OF ${result.done} SCRAPED${result.stopped ? ' (STOPPED)' : ''}`
        : 'SCRAPE FAILED';
    setTimeout(() => { $status.textContent = ''; }, 8000);
    refresh(scrapeScreen);
}

// ⚠️ Written through, then re-read from the row this face already holds: the
// library list is what Collections counts from, so leaving it stale would show
// a game marked on its own page and missing from Favourites.
async function toggleFlag(game, field) {
    const next = !game[field];
    game[field] = next;
    refresh(gameScreen, game);
    const r = await window.crt.setFlag(game.id, field, next);
    if (!r || !r.ok) {
        game[field] = !next;                       // put it back; nothing was saved
        fail('Could not save that.');
        refresh(gameScreen, game);
        return;
    }
    const row = games.find(g => g.id === game.id);
    if (row) row[field] = next;
}

/*
 * ⚠️ The setting that makes a whole class of games work on this machine.
 *
 * Direct3D normally runs through DXVK, which needs Vulkan. Where Vulkan is
 * incomplete — this machine's Haswell graphics, for one — the game starts,
 * fails to create a device and exits in under a second, which looks exactly
 * like a launch that did nothing at all. OpenGL mode translates Direct3D
 * through WineD3D instead, and the same game runs.
 */
async function toggleCompat(game, entry) {
    const next = (compatCache.get(game.id) || 'auto') === 'opengl' ? 'auto' : 'opengl';
    const r = await window.crt.compatSet(entry.id, next);
    if (!r || !r.ok) { fail((r && r.error) || 'Could not save that setting.'); return; }
    compatCache.set(game.id, next);
    $status.textContent = next === 'opengl' ? 'OPENGL MODE ON' : 'AUTO';
    setTimeout(() => { $status.textContent = ''; }, 5000);
    refresh(gameScreen, game);
}

// Installing from a game's own screen, rather than finding it again in the
// Install list. Progress goes to the footer here: this screen is about the
// game, and replacing it with a progress panel would lose the place.
async function installFromGame(game, entry) {
    // The same panel the Install list uses. ⚠️ The first version set a footer
    // message here and left the game screen up, which is why an install from
    // this page looked like nothing at all was happening.
    await startInstall({ id: entry.id, title: game.name });

    entryCache.delete(game.id);
    launcherCache.delete(game.id);
    try {
        entryCache.set(game.id, await window.crt.installerEntry(game.id));
        launcherCache.set(game.id, await window.crt.launchers(game.id) || []);
    } catch (e) {}
    const fresh = games.find(g => g.id === game.id);
    if (fresh) game.installed = fresh.installed;
}

async function uninstallFromGame(game, entry) {
    $status.textContent = 'REMOVING…';
    const result = await window.crt.uninstall(entry.id);

    entryCache.delete(game.id);
    launcherCache.delete(game.id);
    try { games = await window.crt.library(); } catch (e) {}
    const fresh = games.find(g => g.id === game.id);
    if (fresh) game.installed = fresh.installed;
    try {
        entryCache.set(game.id, await window.crt.installerEntry(game.id));
        launcherCache.set(game.id, await window.crt.launchers(game.id) || []);
    } catch (e) {}

    $status.textContent = result && result.ok ? 'REMOVED' : ((result && result.error) || 'COULD NOT REMOVE').toUpperCase();
    setTimeout(() => { $status.textContent = ''; }, 8000);
    refresh(gameScreen, game);
}

// One game, from its own screen.
async function scrapeGame(game, appId) {
    $status.textContent = 'FETCHING…';
    const result = await window.crt.scrapeOne(game.id, appId || '');
    if (!result || !result.ok) {
        fail((result && result.message) || 'Nothing found for this game.');
        return;
    }
    // Everything this game shows is now out of date: its row in the list, its
    // cached detail, and the backdrop currently on screen.
    detailCache.delete(game.id);
    try { games = await window.crt.library(); } catch (e) {}
    const fresh = games.find(g => g.id === game.id);
    if (fresh) { game.cover = fresh.cover; game.genre = fresh.genre; game.year = fresh.year; }
    try { detailCache.set(game.id, await window.crt.game(game.id)); } catch (e) {}

    $status.textContent = (result.message || 'DONE').toUpperCase();
    setTimeout(() => { $status.textContent = ''; }, 6000);
    refresh(gameScreen, game);
}

/*
 * "That is the wrong game."
 *
 * Steam's own search is fuzzy, so an importer can attach the wrong appid and
 * every scrape after that faithfully fetches the wrong game's art. Typing the
 * real name here and choosing from the results pins the id, then scrapes with
 * it — the one flow that cannot be fixed by scraping harder.
 */
function matchScreen(game) {
    const rows = [{
        kind: 'query',
        label: query || 'Type a name',
        meta: matchResults.length ? String(matchResults.length) : '',
        typing: true,
        run: () => runSteamSearch(game),
    }];

    for (const hit of matchResults) {
        rows.push({
            kind: 'action',
            label: hit.name,
            meta: hit.id,
            run: () => { matchResults = []; scrapeGame(game, hit.id); pop(); },
        });
    }

    if (!matchResults.length && query) rows.push({ kind: 'info', label: 'Press Enter to search Steam' });

    return { title: 'FIND THE RIGHT GAME', rows, okLabel: 'SEARCH' };
}

let matchResults = [];
let matchPending = false;

async function runSteamSearch(game) {
    if (matchPending || !query.trim()) return;
    matchPending = true;
    $status.textContent = 'SEARCHING…';
    try { matchResults = await window.crt.steamSearch(query.trim()) || []; }
    catch (e) { matchResults = []; }
    matchPending = false;
    $status.textContent = matchResults.length ? '' : 'NO MATCHES';
    refresh(matchScreen, game);
}

// ⚠️ "Show only installed" lives in Filters, not here, and deliberately in one
// place only. It was in both for a moment and that is worse than either: two
// rows with the same label and the same state, in different menus, leave you
// checking which one you actually changed.
function settingsScreen() {
    const rows = [
        { kind: 'nav', label: 'Artwork and details', meta: scrapeSummary(), run: () => push(scrapeScreen) },
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
    launchRun = { title: game.name, phase: '', percent: 0, message: '', state: 'starting', startedAt: Date.now() };
    push(launchScreen);

    try {
        const res = await window.crt.launch(game.id, launcher && launcher.cmd);
        if (res && res.ok === false) {
            launchRun = { ...launchRun, state: 'failed', message: res.error || 'The game could not be started.' };
            refreshLaunch();
            return;
        }
        game.lastPlayed = Date.now();
        // ⚠️ No timer closing this screen. The engine says when the game is up,
        // when it exits and when it failed, and a guess on a stopwatch is what
        // made the old version feel broken.
    } catch (e) {
        launchRun = { ...launchRun, state: 'failed', message: 'The game could not be started.' };
        refreshLaunch();
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
window.crt.onLaunchFailed((info) => {
    if (launchRun) {
        launchRun = { ...launchRun, state: 'failed', message: (info && info.message) || 'The game could not be started.' };
        refreshLaunch();
        return;
    }
    fail(info && info.message);
});

// Install progress, from the engine itself. Only redrawn while the install
// screen is on top — a rebuild under a game screen would throw the cursor.
window.crt.onInstallProgress((info) => {
    if (!installRun || !info) return;
    installRun = {
        title: info.title || installRun.title,
        percent: Number.isFinite(info.percent) ? info.percent : installRun.percent,
        step: info.step || installRun.step,
        message: info.message || '',
        // ⚠️ Kept, because this is where the *reason* lives. The engine reports
        // a failed install as a progress event with step 'error' and then
        // returns normally, so the caller's own answer knows only that it did
        // not work — not why.
        error: info.step === 'error' ? (info.message || installRun.error) : installRun.error,
    };
    const here = screen();
    if (here && here.builder === installScreen) refresh(installScreen);
});

// Batch scrape progress. Only redrawn while that screen is the one on top —
// a rebuild underneath a game screen would throw the cursor around.
window.crt.onScrapeProgress((p) => {
    if (!scrapeRun || !p) return;
    scrapeRun = { done: p.done, total: p.total, name: p.name };
    const here = screen();
    if (here && here.builder === scrapeScreen) refresh(scrapeScreen);
});

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
            refresh(here.builder, here.arg);
            e.preventDefault();
            return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            query += e.key;
            refresh(here.builder, here.arg);
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
    try { scrapeCounts = await window.crt.scrapeCounts(); } catch (e) {}

    stack.length = 0;
    const built = rootScreen();
    stack.push({
        title: built.title, rows: built.rows, index: firstSelectable(built.rows),
        okLabel: built.okLabel, emptyText: built.emptyText,
    });
    render();
})();

