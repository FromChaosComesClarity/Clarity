'use strict';
/*
 * @clarity/core, playlists that fill themselves.
 *
 * A playlist is normally a hand-picked list of games in playlist_games. A *smart*
 * playlist instead stores a rule and computes its members on read, so "CRPGs" stays
 * right as the library grows instead of being a snapshot of the day it was made.
 *
 * One table, one optional column: playlists.rule holds JSON, and its absence means the
 * playlist is an ordinary manual one. Nothing about existing playlists changes.
 *
 * Rule shape, every present key must match (AND), values within a key are alternatives (OR):
 *   { genres: ['crpg','arpg'], stores: ['gog'], installed: true, fav: true, want: true }
 */

const genreStore = require('./genre-store.js');

function ensureSmartSchema(db) {
    if (!db) return;
    try { db.prepare("ALTER TABLE playlists ADD COLUMN rule TEXT").run(); } catch (e) {}
}

function parseRule(raw) {
    if (!raw) return null;
    try {
        const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!r || typeof r !== 'object') return null;
        const genres = Array.isArray(r.genres) ? r.genres.filter(Boolean) : [];
        const stores = Array.isArray(r.stores) ? r.stores.filter(Boolean) : [];
        const rule = {};
        if (genres.length) rule.genres = genres;
        if (stores.length) rule.stores = stores;
        for (const k of ['installed', 'fav', 'want']) if (r[k]) rule[k] = true;
        return Object.keys(rule).length ? rule : null;
    } catch { return null; }
}

function isSmart(playlistRow) { return !!parseRule(playlistRow && playlistRow.rule); }

// Build the SELECT for a rule. Returns { sql, params } or null when the rule is empty,
// an empty rule must never silently resolve to "the whole library".
function ruleQuery(rule) {
    const r = parseRule(rule);
    if (!r) return null;
    const where = [ "IFNULL(g.Hidden,0) <> 1" ];
    const params = [];

    if (r.genres) {
        where.push(`EXISTS (SELECT 1 FROM game_genres gg WHERE gg.game_id = g.id AND gg.slug IN (${r.genres.map(() => '?').join(',')}))`);
        params.push(...r.genres);
    }
    if (r.stores) {
        where.push('(' + r.stores.map(() => 'LOWER(IFNULL(g.Store,\'\')) LIKE ?').join(' OR ') + ')');
        params.push(...r.stores.map(s => `%${String(s).toLowerCase()}%`));
    }
    // Manual-category games (physical/emulation/apps/others) have no install flag to
    // trust, for them "installed" means "has something to launch", matching how every
    // other view in the suite decides it.
    if (r.installed) {
        where.push(
            "(CASE WHEN g.InstallerGameId IS NULL AND (LOWER(IFNULL(g.Store,'')) LIKE '%others%' OR LOWER(IFNULL(g.Store,'')) LIKE '%emulation%' " +
            "OR LOWER(IFNULL(g.Store,'')) LIKE '%physical%' OR LOWER(IFNULL(g.Store,'')) LIKE '%apps%') " +
            "THEN IFNULL(g.LaunchCommand,'') <> '' ELSE g.Installed = 1 END)"
        );
    }
    if (r.fav)  where.push("g.FAV = 'YES'");
    if (r.want) where.push("g.WANT_TO_PLAY = 'YES'");

    return { sql: `SELECT g.* FROM games g WHERE ${where.join(' AND ')} ORDER BY g.Game ASC`, params };
}

// Members of a playlist: computed for a smart one, the stored list for a manual one.
function playlistGames(db, playlistId) {
    if (!db) return [];
    let row;
    try { row = db.prepare("SELECT id, name, rule FROM playlists WHERE id=?").get(playlistId); } catch { return []; }
    if (!row) return [];

    const q = ruleQuery(row.rule);
    if (q) {
        try { return genreStore.attachGenres(db, db.prepare(q.sql).all(...q.params)); } catch { return []; }
    }
    try {
        return genreStore.attachGenres(db, db.prepare(
            "SELECT g.* FROM playlist_games pg JOIN games g ON g.id = pg.game_id " +
            "WHERE pg.playlist_id=? ORDER BY pg.sort_order, g.Game"
        ).all(playlistId));
    } catch { return []; }
}

// How many games a rule currently matches, for the live preview while creating one,
// and for the counts beside each playlist.
function ruleCount(db, rule) {
    const q = ruleQuery(rule);
    if (!db || !q) return 0;
    try {
        return db.prepare(q.sql.replace('SELECT g.*', 'SELECT COUNT(*) AS n').replace(/ ORDER BY .*$/, '')).get(...q.params)?.n || 0;
    } catch { return 0; }
}

module.exports = { ensureSmartSchema, parseRule, isSmart, ruleQuery, playlistGames, ruleCount };
