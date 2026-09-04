'use strict';
/*
 * @clarity/core, where a game's genres live in games.db.
 *
 * Both faces open the same database and each one used to re-declare the schema in its
 * own migration block; this keeps the genre tables in one place so they cannot drift.
 * Whichever face opens the DB first creates them, the other is a no-op.
 *
 * Two ideas worth knowing before reading further:
 *
 *   PrimaryGenre is denormalized onto games. Every layout that prints a genre chip and
 *   every sort/filter path wants one string per row, and joining for that on each of the
 *   892 rows in every view would be silly. game_genres stays the source of truth for
 *   "what else is this", PrimaryGenre is the answer to "what IS this".
 *
 *   GenreLocked is the contract with the user: a scan may correct anything it wrote
 *   before, but it must never overwrite a genre a person chose by hand.
 */

function ensureGenreSchema(db) {
    if (!db) return;
    try {
        db.prepare(`CREATE TABLE IF NOT EXISTS game_genres (
            game_id INTEGER NOT NULL,
            slug    TEXT    NOT NULL,
            score   REAL    DEFAULT 0,
            source  TEXT,
            PRIMARY KEY (game_id, slug),
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )`).run();
    } catch (e) {}
    try { db.prepare("CREATE INDEX IF NOT EXISTS idx_game_genres_slug ON game_genres(slug)").run(); } catch (e) {}
    // 1 = a human set this genre; scans skip the row entirely.
    try { db.prepare("ALTER TABLE games ADD COLUMN PrimaryGenre TEXT").run(); } catch (e) {}
    try { db.prepare("ALTER TABLE games ADD COLUMN GenreLocked INTEGER DEFAULT 0").run(); } catch (e) {}
    // When a scan last touched the row (unix seconds), lets a re-scan skip fresh rows.
    try { db.prepare("ALTER TABLE games ADD COLUMN GenreScanned INTEGER DEFAULT 0").run(); } catch (e) {}
}

function isLocked(db, gameId) {
    try { return db.prepare("SELECT GenreLocked FROM games WHERE id=?").get(gameId)?.GenreLocked == 1; }
    catch { return false; }
}

/*
 * Write one game's classification. `result` is what genres.classify() returned.
 * Replaces every previously scanned genre for the game but leaves manual ones alone,
 * so re-running a scan corrects its own past mistakes without erasing the user's.
 */
function setGameGenres(db, gameId, result, source = 'scan') {
    if (!db || !gameId) return false;
    const manual = source === 'manual';
    if (!manual && isLocked(db, gameId)) return false;

    const genres = (result && result.genres) || [];
    const primary = (result && result.primary) || null;

    const tx = db.transaction(() => {
        if (manual) db.prepare("DELETE FROM game_genres WHERE game_id=?").run(gameId);
        else        db.prepare("DELETE FROM game_genres WHERE game_id=? AND source <> 'manual'").run(gameId);

        const ins = db.prepare("INSERT OR REPLACE INTO game_genres (game_id, slug, score, source) VALUES (?,?,?,?)");
        for (const g of genres) ins.run(gameId, g.slug, g.score ?? 0, source);

        db.prepare("UPDATE games SET PrimaryGenre=?, GenreScanned=?, GenreLocked=? WHERE id=?")
          .run(primary, Math.floor(Date.now() / 1000), manual ? 1 : 0, gameId);
    });
    try { tx(); return true; } catch { return false; }
}

// Clear a manual override so scans own the row again.
function unlockGenres(db, gameId) {
    try { db.prepare("UPDATE games SET GenreLocked=0 WHERE id=?").run(gameId); return true; }
    catch { return false; }
}

// game_id → ['fps','horror',…]. One query for the whole library; callers stitch it onto
// the rows they already have rather than issuing a join per game.
function genresByGame(db) {
    const map = new Map();
    try {
        for (const r of db.prepare("SELECT game_id, slug FROM game_genres ORDER BY score DESC").all()) {
            let arr = map.get(r.game_id);
            if (!arr) map.set(r.game_id, arr = []);
            arr.push(r.slug);
        }
    } catch {}
    return map;
}

// Stamp a `Genres` string onto game rows on their way to a renderer. Every handler that
// hands out rows must go through this, or a playlist view would filter by genre against
// rows that have no genre field and quietly show nothing.
function attachGenres(db, rows) {
    if (!Array.isArray(rows) || !rows.length) return rows;
    const byGame = genresByGame(db);
    for (const r of rows) r.Genres = (byGame.get(r.id) || []).join(',');
    return rows;
}

// slug → how many games carry it, for menu counts. Hidden games are excluded so the
// number next to a genre matches what clicking it actually shows.
function genreCounts(db) {
    const out = {};
    try {
        const rows = db.prepare(
            "SELECT gg.slug AS slug, COUNT(*) AS n FROM game_genres gg " +
            "JOIN games g ON g.id = gg.game_id WHERE IFNULL(g.Hidden,0) <> 1 GROUP BY gg.slug"
        ).all();
        for (const r of rows) out[r.slug] = r.n;
    } catch {}
    return out;
}

// How much of the library has been classified, drives the "run a scan" nudge.
function genreCoverage(db) {
    try {
        const r = db.prepare(
            "SELECT COUNT(*) AS total, " +
            "SUM(CASE WHEN IFNULL(PrimaryGenre,'') <> '' THEN 1 ELSE 0 END) AS classified, " +
            "SUM(CASE WHEN GenreLocked = 1 THEN 1 ELSE 0 END) AS locked " +
            "FROM games WHERE IFNULL(Hidden,0) <> 1"
        ).get();
        return { total: r?.total || 0, classified: r?.classified || 0, locked: r?.locked || 0 };
    } catch { return { total: 0, classified: 0, locked: 0 }; }
}

module.exports = {
    ensureGenreSchema, setGameGenres, unlockGenres, isLocked,
    genresByGame, attachGenres, genreCounts, genreCoverage,
};
