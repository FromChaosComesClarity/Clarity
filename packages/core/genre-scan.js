'use strict';
/*
 * @clarity/core — fill every game's genres from the best source available.
 *
 * Three passes, cheapest-and-best first, each one only handling what the previous
 * could not:
 *
 *   1. SteamSpy, for anything with a Steam appid. Community tags are the only source
 *      that actually distinguishes an ARPG from a CRPG, because thousands of players
 *      voted on exactly that. Free, no key. Their docs ask for one request a second
 *      for appdetails, so this pass sets the pace of the whole scan.
 *   2. IGDB genres + themes + keywords, for the GOG/Epic/itch/emulated games Steam has
 *      never heard of. Coarser, but it covers the rest of the library.
 *   3. The existing GENRE column, parsed through the same vocabulary. Recovers nothing
 *      new, but it means a game with no network answer still lands somewhere sensible.
 *
 * Cancellable and resumable: progress is written per game, so stopping halfway keeps
 * everything already classified, and re-running skips what is still fresh.
 */
const { session } = require('electron');
const genres = require('./genres.js');
const store = require('./genre-store.js');

const STEAMSPY_DELAY_MS = 1100;   // their appdetails guidance is 1 req/sec; 1.1s is polite
const IGDB_DELAY_MS     = 280;    // IGDB allows 4 req/sec
const FRESH_SECONDS     = 30 * 24 * 3600;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, timeoutMs = 20000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await session.defaultSession.fetch(url, { signal: ctrl.signal });
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; }
    finally { clearTimeout(t); }
}

// SteamSpy's tags field is `{ "Action RPG": 35022, … }` — but an unknown appid answers
// with an empty array instead of an empty object, hence the shape check.
async function steamspyTags(appId) {
    const d = await fetchJson(`https://steamspy.com/api.php?request=appdetails&appid=${encodeURIComponent(appId)}`);
    const tags = d && d.tags;
    if (!tags || Array.isArray(tags) || !Object.keys(tags).length) return null;
    return tags;
}

function cleanAppId(v) {
    const s = String(v || '').replace(/\.0+$/, '').trim();
    return (!s || s === 'None' || !/^\d+$/.test(s)) ? '' : s;
}

/*
 * options:
 *   db          — games.db handle
 *   igdbLookup  — async (name, appId) => { genres:[{name}], themes:[{name}], keywords:[{name}] }
 *                 supplied by the face that owns the IGDB token; omit to skip pass 2
 *   onProgress  — ({ scanned, total, label, classified }) => void
 *   shouldCancel— () => boolean, polled between games
 *   force       — re-scan rows scanned recently (default: skip anything under a month old)
 *
 * Returns { scanned, classified, skipped, cancelled }.
 */
async function runGenreScan({ db, igdbLookup, onProgress, shouldCancel, force = false } = {}) {
    if (!db) return { scanned: 0, classified: 0, skipped: 0, cancelled: false };
    store.ensureGenreSchema(db);

    let rows = [];
    try {
        rows = db.prepare(
            "SELECT id, Game, SteamAppID, GENRE, GenreScanned, PrimaryGenre FROM games " +
            "WHERE IFNULL(GenreLocked,0) <> 1 AND IFNULL(Hidden,0) <> 1 ORDER BY Game ASC"
        ).all();
    } catch { return { scanned: 0, classified: 0, skipped: 0, cancelled: false }; }

    const cutoff = Math.floor(Date.now() / 1000) - FRESH_SECONDS;
    const todo = rows.filter(r => force || !r.PrimaryGenre || (r.GenreScanned || 0) < cutoff);
    const skipped = rows.length - todo.length;

    // Steam-backed games first: they are the ones that get the good answer, so a user
    // who cancels halfway still ends up with the most useful half.
    const withAppId = todo.filter(r => cleanAppId(r.SteamAppID));
    const without   = todo.filter(r => !cleanAppId(r.SteamAppID));
    const ordered   = [...withAppId, ...without];

    let scanned = 0, classified = 0, cancelled = false;
    const report = label => { try { onProgress && onProgress({ scanned, total: ordered.length, label, classified }); } catch {} };
    report('');

    for (const row of ordered) {
        if (shouldCancel && shouldCancel()) { cancelled = true; break; }
        report(row.Game || '');

        let result = { primary: null, genres: [] };
        let source = 'genre-column';

        const appId = cleanAppId(row.SteamAppID);
        if (appId) {
            const tags = await steamspyTags(appId);
            if (tags) { result = genres.classify(tags); source = 'steamspy'; }
            await sleep(STEAMSPY_DELAY_MS);
        }

        if (!result.primary && igdbLookup) {
            try {
                const g = await igdbLookup(row.Game, appId);
                if (g) {
                    // Genres first, then themes, then keywords: classify() reads an array
                    // as descending priority, and that is exactly their order of authority.
                    const names = [
                        ...(g.genres   || []).map(x => x && x.name),
                        ...(g.themes   || []).map(x => x && x.name),
                        ...(g.keywords || []).map(x => x && x.name),
                    ].filter(Boolean);
                    if (names.length) { result = genres.classify(names); source = 'igdb'; }
                }
            } catch {}
            await sleep(IGDB_DELAY_MS);
        }

        if (!result.primary && row.GENRE) {
            result = genres.classifyGenreString(row.GENRE);
            source = 'genre-column';
        }

        if (result.primary) {
            if (store.setGameGenres(db, row.id, result, source)) classified++;
        } else {
            // Nothing recognised it. Stamp the row anyway so the next scan moves past it
            // instead of paying for the same three lookups again.
            try { db.prepare("UPDATE games SET GenreScanned=? WHERE id=?").run(Math.floor(Date.now() / 1000), row.id); } catch {}
        }
        scanned++;
    }

    report('');
    return { scanned, classified, skipped, cancelled };
}

// One-shot reclassification with no network at all: re-runs the current vocabulary over
// the GENRE column. Instant, and the natural thing to offer before a 10-minute scan.
function quickGenrePass(db) {
    if (!db) return { scanned: 0, classified: 0 };
    store.ensureGenreSchema(db);
    let rows = [];
    try {
        rows = db.prepare(
            "SELECT id, GENRE FROM games WHERE IFNULL(GenreLocked,0) <> 1 AND IFNULL(Hidden,0) <> 1 " +
            "AND IFNULL(PrimaryGenre,'') = '' AND IFNULL(GENRE,'') <> ''"
        ).all();
    } catch { return { scanned: 0, classified: 0 }; }

    let classified = 0;
    for (const r of rows) {
        const result = genres.classifyGenreString(r.GENRE);
        if (result.primary && store.setGameGenres(db, r.id, result, 'genre-column')) classified++;
    }
    return { scanned: rows.length, classified };
}

module.exports = { runGenreScan, quickGenrePass, steamspyTags };
