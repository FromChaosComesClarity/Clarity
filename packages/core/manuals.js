'use strict';
/*
 * @clarity/core, per-game manuals.
 *
 * Plenty of games, RPGs above all, still expect you to read something, and more often than
 * not the file is already on disk: GOG ships manuals, cluebooks and reference cards inside
 * the game folder and never surfaces them anywhere. This keeps a list of those documents
 * per game so they are one click from the gamepage.
 *
 * A game can hold several. Realms of Arkania alone ships a manual, a cluebook and a
 * password reference card, and picking one of the three to be "the manual" would have been
 * an odd thing to make someone do.
 *
 * POINTERS, never copies, except for what we download ourselves. A file the user chose, or
 * one GOG installed, belongs to them: removing it here only forgets the association. Only a
 * manual this app downloaded may be deleted from disk, and only from the folder it owns.
 */
const path = require('path');

function ensureManualSchema(db) {
    if (!db) return;
    try {
        db.prepare(`CREATE TABLE IF NOT EXISTS game_manuals (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id    INTEGER NOT NULL,
            path       TEXT    NOT NULL,
            label      TEXT,
            source     TEXT,
            sort_order INTEGER DEFAULT 0,
            UNIQUE(game_id, path),
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )`).run();
    } catch (e) {}
    try { db.prepare("CREATE INDEX IF NOT EXISTS idx_game_manuals_game ON game_manuals(game_id)").run(); } catch (e) {}

    // Was a single games.ManualPath before multiple manuals existed; keep the column so an
    // older build reading this DB still works, but move its value into the table once.
    try { db.prepare("ALTER TABLE games ADD COLUMN ManualPath TEXT").run(); } catch (e) {}
    try {
        const rows = db.prepare("SELECT id, ManualPath FROM games WHERE IFNULL(ManualPath,'') <> ''").all();
        const ins = db.prepare("INSERT OR IGNORE INTO game_manuals (game_id, path, label, source) VALUES (?,?,?,'user')");
        for (const r of rows) ins.run(r.id, r.ManualPath, 'Manual');
    } catch (e) {}
}

// Anything Chromium renders in an iframe without help. PDF is the realistic case; the rest
// cost nothing to allow and cover the odd README or HTML manual.
const MANUAL_EXTENSIONS = ['pdf', 'htm', 'html', 'txt', 'md'];
const MANUAL_FILTERS = [
    { name: 'Manuals', extensions: MANUAL_EXTENSIONS },
    { name: 'PDF', extensions: ['pdf'] },
    { name: 'All Files', extensions: ['*'] },
];
const isDoc = f => MANUAL_EXTENSIONS.includes(path.extname(f).slice(1).toLowerCase());

// Attached manuals, newest sort_order last. `exists` is re-checked every time because these
// files live outside our control, an uninstall or a moved folder takes one away silently.
function listManuals(db, fs, gameId) {
    let rows = [];
    try {
        rows = db.prepare(
            "SELECT id, path, label, source FROM game_manuals WHERE game_id=? ORDER BY sort_order, id"
        ).all(gameId);
    } catch { return []; }
    return rows.map(r => {
        let exists = false;
        try { exists = fs.existsSync(r.path); } catch {}
        return { ...r, exists };
    });
}

function addManual(db, gameId, filePath, label, source = 'user') {
    if (!db || !gameId || !filePath) return null;
    try {
        const max = db.prepare("SELECT MAX(sort_order) AS m FROM game_manuals WHERE game_id=?").get(gameId);
        const order = (max?.m ?? -1) + 1;
        db.prepare("INSERT OR IGNORE INTO game_manuals (game_id, path, label, source, sort_order) VALUES (?,?,?,?,?)")
          .run(gameId, filePath, label || path.basename(filePath), source, order);
        return db.prepare("SELECT id FROM game_manuals WHERE game_id=? AND path=?").get(gameId, filePath)?.id ?? null;
    } catch { return null; }
}

// Forget one. Files we downloaded ourselves are ours to remove; everything else is the
// user's own and is left exactly where it is.
function removeManual(db, fs, manualId, downloadDir) {
    try {
        const row = db.prepare("SELECT path, source FROM game_manuals WHERE id=?").get(manualId);
        db.prepare("DELETE FROM game_manuals WHERE id=?").run(manualId);
        if (row && row.source === 'gog-download' && downloadDir && row.path.startsWith(downloadDir)) {
            try { fs.unlinkSync(row.path); } catch {}
        }
        return true;
    } catch { return false; }
}

/*
 * Documents a game already has, without asking the user to go looking.
 *
 * Two sources, best first:
 *   1. goggame-<appId>.info, GOG lists its documents as FileTasks with real names
 *      ("Cluebook", "Password reference card"), which beats anything guessed from a
 *      filename. Both playTasks and supportTasks carry them.
 *   2. A shallow scan of the install folder for documents the manifest did not mention.
 *      Depth-limited: manuals sit at the top or one level down, and walking a whole game
 *      folder to find a PDF would be slow and would drag in unrelated files.
 *
 * Returns [{ path, label, source }], already-attached paths excluded by the caller.
 */
function detectManuals(fs, installPath, appId) {
    if (!installPath) return [];
    const out = [];
    const seen = new Set();

    // GOG's manifests are written on Windows and their casing does not always match what
    // is on disk, Realms of Arkania declares "Manual.pdf" and ships MANUAL.PDF. On a
    // case-sensitive filesystem that is a different file, and the best-labelled source
    // would silently lose to the folder scan.
    const resolveCase = p => {
        try { if (fs.existsSync(p)) return p; } catch { return null; }
        const dir = path.dirname(p), base = path.basename(p).toLowerCase();
        try {
            const hit = fs.readdirSync(dir).find(f => f.toLowerCase() === base);
            return hit ? path.join(dir, hit) : null;
        } catch { return null; }
    };

    const push = (p, label, source) => {
        const real = resolveCase(p);
        if (!real) return;
        const key = real.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ path: real, label, source });
    };

    if (appId) {
        try {
            const info = JSON.parse(fs.readFileSync(path.join(installPath, `goggame-${appId}.info`), 'utf8'));
            for (const t of [...(info.playTasks || []), ...(info.supportTasks || [])]) {
                if (t?.type !== 'FileTask' || !t.path || !isDoc(t.path)) continue;
                const abs = path.join(installPath, ...String(t.path).replace(/\\/g, '/').split('/'));
                push(abs, t.name || path.basename(abs), 'gog-info');
            }
        } catch {}
    }

    const scan = (dir, depth) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isFile()) {
                // A folder scan cannot tell a manual from a licence, so only take the
                // formats people actually read, and never plain text, which at the top of
                // a game folder is almost always a EULA or a changelog.
                if (/\.(pdf|html?)$/i.test(e.name)) push(full, path.basename(e.name, path.extname(e.name)), 'folder-scan');
            } else if (e.isDirectory() && depth > 0) {
                if (/^(gog-support|__redist|DOSBOX|Video Codec)$/i.test(e.name)) continue;
                scan(full, depth - 1);
            }
        }
    };
    scan(installPath, 1);

    return out;
}

module.exports = {
    ensureManualSchema, listManuals, addManual, removeManual, detectManuals,
    MANUAL_FILTERS, MANUAL_EXTENSIONS,
};
