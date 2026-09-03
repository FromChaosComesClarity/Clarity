'use strict';
/*
 * @clarity/core — shared IPC handlers that are byte-identical across the
 * suite's faces (Manager today; Couch in Phase 3). Single source of truth so a
 * fix here can never drift between faces.
 *
 * Call once per face (faces run as separate processes) after the DB is open:
 *   require('../../packages/core/shared-ipc.js').registerSharedHandlers({
 *     db, baseDir, trailersDir, ytDlpPath, ytDlpConfigPath, ffmpegPath,
 *     getBeautifulName, getOldCrushedName });
 */
const { ipcMain, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { spawn } = require('child_process');
const homeStats = require('./home-stats.js');
const itad = require('./itad.js');
const freebies = require('./freebies.js');
const rss = require('./rss.js');
const proton = require('./proton.js');
const steamnews = require('./steamnews.js');
const genres = require('./genres.js');
const genreStore = require('./genre-store.js');
const smartPlaylists = require('./smart-playlists.js');
const manuals = require('./manuals.js');
const host = require('./platform/index.js');

function registerSharedHandlers(ctx) {
    const { db, baseDir, trailersDir, ytDlpPath, ytDlpConfigPath, ffmpegPath,
            getBeautifulName, getOldCrushedName } = ctx;

    // Genre tables live here rather than in each face's migration block — both faces
    // share this DB and the schema must not drift between them.
    genreStore.ensureGenreSchema(db);
    smartPlaylists.ensureSmartSchema(db);
    manuals.ensureManualSchema(db);

    // Wishlist of UN-OWNED games (Phase 2) — distinct from WANT_TO_PLAY (owned).
    try { db.prepare(`CREATE TABLE IF NOT EXISTS wishlist (id INTEGER PRIMARY KEY AUTOINCREMENT, itad_id TEXT UNIQUE, title TEXT, slug TEXT, cover TEXT, appid TEXT, added_at INTEGER DEFAULT 0, target_price REAL)`).run(); } catch (e) {}

    // Tiny TTL memo so the online Home widgets don't refetch on every Home open
    // (the CPU/network spike). Keyed by inputs → settings changes bust naturally.
    const _hcache = {};
    function _cached(key, ttl, fn) {
        const c = _hcache[key];
        if (c && Date.now() - c.ts < ttl) return Promise.resolve(c.val);
        return Promise.resolve().then(fn).then(v => { _hcache[key] = { ts: Date.now(), val: v }; return v; }).catch(() => (c ? c.val : null));
    }

    ipcMain.handle('get-basedir', () => baseDir);

    // Suite version (package.json) — shown in the About dialog of every face.
    ipcMain.handle('get-app-version', () => { try { return require('electron').app.getVersion(); } catch { return ''; } });

    ipcMain.handle('get-games', () => {
        if (!db) return { games: [] };
        try {
            const rows = db.prepare("SELECT * FROM games ORDER BY Game ASC").all();
            // Every row carries its genre slugs so the renderers can filter without a
            // per-game round trip. One extra query for the whole library, not 892.
            const byGame = genreStore.genresByGame(db);
            for (const r of rows) r.Genres = (byGame.get(r.id) || []).join(',');
            return { games: rows };
        } catch (err) { return { games: [] }; }
    });

    // The curated vocabulary + how many games sit in each genre, for menus and chips.
    ipcMain.handle('genre-list', () => {
        const counts = genreStore.genreCounts(db);
        return {
            genres: genres.GENRES.map(g => ({ slug: g.slug, label: g.label, count: counts[g.slug] || 0 })),
            coverage: genreStore.genreCoverage(db),
        };
    });

    // Manual override from the edit dialog — locks the row against future scans.
    // slugs[0] is the primary. An empty list clears the override and unlocks.
    ipcMain.handle('set-game-genres', (e, gameId, slugs) => {
        if (!db) return false;
        const list = (Array.isArray(slugs) ? slugs : []).filter(s => genres.GENRES.some(g => g.slug === s));
        if (!list.length) {
            try { db.prepare("DELETE FROM game_genres WHERE game_id=? AND source='manual'").run(gameId); } catch {}
            genreStore.unlockGenres(db, gameId);
            return true;
        }
        // Descending scores keep the chosen order meaningful downstream (genresByGame
        // sorts by score, and the first slug is what PrimaryGenre becomes).
        const result = { primary: list[0], genres: list.map((slug, i) => ({ slug, score: 1 - i * 0.01 })) };
        return genreStore.setGameGenres(db, gameId, result, 'manual');
    });

    ipcMain.handle('clear-history', () => {
        if (!db) return false;
        try { db.prepare("UPDATE games SET LastPlayed = 0").run(); return true; } catch(err) { return false; }
    });

    ipcMain.handle('read-file-base64', (e, filePath) => {
        try { return fs.readFileSync(filePath).toString('base64'); } catch { return null; }
    });

    ipcMain.handle('open-install-url', async (e, url) => {
        if (url) await shell.openExternal(url);
    });

    // ── The Omarchy theme ────────────────────────────────────────────────────
    // Shared rather than Manager-only, and that is a correctness matter, not tidiness:
    // Couch mirrors the Manager's theme by name when themeSource is MANAGER, resolving it
    // against its OWN theme table. A theme the Manager knows about and Couch does not
    // resolves to null there and the couch face silently falls back to its default — so a
    // user matching their desktop on one face would stop matching it on the other.
    //
    // ⚠️ Null on macOS, and self-gating on Linux: on a host that is not Omarchy this
    // answers "unavailable" and every face carries on with its own themes.
    const omarchyTheme = host.desktop?.omarchyTheme || null;
    ipcMain.handle('omarchy-theme', () => omarchyTheme?.describe?.() || { available: false, name: '', theme: null, mode: '' });

    if (omarchyTheme?.isSupported?.()) {
        try {
            const stop = omarchyTheme.watch(d => {
                for (const w of BrowserWindow.getAllWindows()) {
                    try { w.webContents.send('omarchy-theme-changed', d); } catch {}
                }
            });
            try { require('electron').app.on('before-quit', () => { try { stop(); } catch {} }); } catch {}
        } catch {}
    }

    ipcMain.handle('get-setting', (e, key) => { try { const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key); return row ? row.value : null; } catch(e) { return null; } });

    ipcMain.handle('set-setting', (e, key, val) => { try { db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, val); return true; } catch(e) { return false; } });

    // ── Home dashboard (Phase 1) — one snapshot, rendered by both faces' Home screens. ──
    ipcMain.handle('get-home-stats', (e, opts) => {
        if (!db) return null;
        try {
            const games = db.prepare("SELECT * FROM games").all();
            return homeStats.computeHomeSnapshot(games, {
                dailySeed: new Date().toISOString().slice(0, 10),
                ...(opts || {}),
            });
        } catch (err) { return null; }
    });

    // Random game for the Roulette widget (constraints: installedOnly/backlogOnly/favsOnly/wantOnly/store/genre/maxHours).
    ipcMain.handle('get-random-game', (e, constraints) => {
        if (!db) return null;
        try { return homeStats.pickRandom(db.prepare("SELECT * FROM games").all(), constraints || {}); }
        catch (err) { return null; }
    });

    // ── Wishlist + IsThereAnyDeal deals (Phase 2) — all opt-in (no key → no network). ──
    const _itadKey = () => { try { return db.prepare("SELECT value FROM settings WHERE key='itad_api_key'").get()?.value || ''; } catch { return ''; } };
    const _itadCountry = () => { try { return db.prepare("SELECT value FROM settings WHERE key='itad_country'").get()?.value || 'US'; } catch { return 'US'; } };

    ipcMain.handle('itad-search', async (e, q) => itad.search(_itadKey(), q));
    const _bustWishlist = () => Object.keys(_hcache).forEach(k => { if (k.startsWith('wishlist')) delete _hcache[k]; });
    ipcMain.handle('wishlist-get', () => { try { return db.prepare("SELECT * FROM wishlist ORDER BY added_at DESC").all(); } catch { return []; } });
    ipcMain.handle('wishlist-remove', (e, itadId) => { try { db.prepare("DELETE FROM wishlist WHERE itad_id=?").run(itadId); _bustWishlist(); return true; } catch { return false; } });
    ipcMain.handle('wishlist-add', async (e, item) => {
        if (!item || !item.id) return { ok: false };
        let cover = item.cover || '', appid = item.appid || null;
        if (!cover) { const inf = await itad.info(_itadKey(), item.id); if (inf) { cover = inf.cover; appid = appid || inf.appid; } }
        try {
            db.prepare("INSERT OR IGNORE INTO wishlist (itad_id,title,slug,cover,appid,added_at) VALUES (?,?,?,?,?,?)")
              .run(item.id, item.title || '', item.slug || '', cover || '', appid, Date.now());
            _bustWishlist();
            return { ok: true };
        } catch (err) { return { ok: false, error: err.message }; }
    });
    // List + live prices/historical-low (network — only if a key is set). Cached ~20 min.
    ipcMain.handle('wishlist-deals', () => _cached('wishlist:' + _itadCountry(), 20 * 60000, async () => {
        let rows = []; try { rows = db.prepare("SELECT * FROM wishlist ORDER BY added_at DESC").all(); } catch {}
        const key = _itadKey();
        if (!key || !rows.length) return { keyed: !!key, rows: rows.map(r => ({ ...r, deal: null, low: null })) };
        return { keyed: true, rows: await itad.enrich(key, _itadCountry(), rows) };
    }));

    // Free games this week (Epic public endpoint, no key). Cached ~30 min.
    ipcMain.handle('free-games', () => _cached('free:' + _itadCountry(), 30 * 60000, async () => { try { return await freebies.freeGames(_itadCountry()); } catch { return []; } }));

    // Gaming news (RSS/Atom) — sources from `news_sources` or curated defaults. Cached ~15 min (key = sources).
    ipcMain.handle('get-news', () => {
        let urls = [];
        try { const raw = db.prepare("SELECT value FROM settings WHERE key='news_sources'").get()?.value; if (raw) urls = raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean); } catch {}
        if (!urls.length) urls = rss.DEFAULT_NEWS;
        return _cached('news:' + urls.join('|'), 15 * 60000, () => rss.fetchNews(urls, 14).catch(() => []));
    });

    // Raw page HTML for the in-app TV Reader (Couch) — extraction/sanitizing happens in
    // the renderer via DOMParser, so main stays DOM-free. Same fetch path as rss/freebies.
    ipcMain.handle('fetch-article', async (_, url) => {
        try {
            if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, error: 'bad url' };
            const { session } = require('electron');
            const r = await session.defaultSession.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' } });
            if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
            const html = await r.text();
            return { ok: true, html: html.slice(0, 2500000), url: r.url || url };
        } catch (e) { return { ok: false, error: e.message }; }
    });

    // Steam patch notes for the games you actually play/own. Cached ~20 min.
    ipcMain.handle('get-game-news', () => _cached('gamenews', 20 * 60000, async () => {
        let games = [];
        try {
            games = db.prepare("SELECT Game, SteamAppID FROM games WHERE SteamAppID IS NOT NULL AND TRIM(SteamAppID) != '' AND SteamAppID != 'None' ORDER BY (LastPlayed > 0) DESC, LastPlayed DESC, Installed DESC LIMIT 24").all();
        } catch {}
        const targets = games.map(g => ({ appid: String(g.SteamAppID).replace(/\.0+$/, ''), name: g.Game }));
        try { return await steamnews.gameNews(targets, { limit: 24, total: 14 }); } catch { return []; }
    }));

    // Achievement completion — cached scan result (the scan itself runs in the Manager).
    ipcMain.handle('ach-get', () => { try { const raw = db.prepare("SELECT value FROM settings WHERE key='ach_stats'").get()?.value; return raw ? JSON.parse(raw) : null; } catch { return null; } });

    // ProtonDB tier watch — last cached result + an on-demand library sweep.
    ipcMain.handle('proton-watch-get', () => { try { const raw = db.prepare("SELECT value FROM settings WHERE key='proton_watch'").get()?.value; return raw ? JSON.parse(raw) : null; } catch { return null; } });
    ipcMain.handle('proton-check', async () => {
        let games = [];
        try { games = db.prepare("SELECT id, Game, SteamAppID, ProtonTier FROM games WHERE SteamAppID IS NOT NULL AND TRIM(SteamAppID) != '' AND SteamAppID != 'None'").all(); } catch {}
        const { checked, changes } = await proton.checkLibrary(games, { limit: 120 });
        for (const c of changes) { try { db.prepare("UPDATE games SET ProtonTier=? WHERE id=?").run(c.now, c.id); } catch {} }
        const result = { ts: Date.now(), checked, changes };
        try { db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('proton_watch', ?)").run(JSON.stringify(result)); } catch {}
        return result;
    });

    // Games installed outside the known stores that still announce themselves to the
    // desktop (Flatpak on Linux). FINDING them is the host's business; reconciling what it
    // finds against the library is the same work everywhere, so that half stays here.
    ipcMain.handle('find-flatpak-icon', (e, iconName) => host.extraStore.findIcon(iconName));

    ipcMain.handle('scan-flatpak', () => {
        const store = host.extraStore;
        if (!store.supported) return { count: 0, iconMap: {} };

        const entries = store.scan();
        const found   = new Set(entries.map(x => x.launchCmd));
        const iconMap = {};   // gameId → icon name

        for (const entry of entries) {
            const row = db.prepare('SELECT id, Store, CoverArt FROM games WHERE LaunchCommand = ?').get(entry.launchCmd);
            if (row) {
                const stores = (row.Store || '').split(',').map(x => x.trim());
                if (!stores.some(x => x.toLowerCase() === store.label.toLowerCase()))
                    db.prepare('UPDATE games SET Store=?, Installed=1 WHERE id=?').run([...stores, store.label].join(', '), row.id);
                else
                    db.prepare('UPDATE games SET Installed=1 WHERE id=?').run(row.id);
                if (!row.CoverArt) iconMap[row.id] = entry.icon;
            } else {
                const info = db.prepare('INSERT INTO games (Game,Store,LaunchCommand,Installed) VALUES (?,?,?,1)')
                               .run(entry.name, store.label, entry.launchCmd);
                iconMap[info.lastInsertRowid] = entry.icon;
            }
        }

        // Anything of this store's that is no longer on disk drops out of the library.
        for (const row of db.prepare('SELECT id, LaunchCommand FROM games WHERE Store = ?').all(store.label)) {
            if (!found.has(row.LaunchCommand)) db.prepare('DELETE FROM games WHERE id=?').run(row.id);
        }

        return { count: found.size, iconMap };
    });

    ipcMain.handle('check-local-trailer', (event, gameName) => {
        const beautifulPath = path.join(trailersDir, `${getBeautifulName(gameName)}.mp4`);
        const oldPath = path.join(trailersDir, `${getOldCrushedName(gameName)}.mp4`);
        if (fs.existsSync(beautifulPath)) return `file://${beautifulPath}`;
            if (fs.existsSync(oldPath)) return `file://${oldPath}`;
                return null;
    });

    ipcMain.handle('download-trailer', (event, gameName, videoId) => {
        const fileName = `${getBeautifulName(gameName)}.mp4`;
        const filePath = path.join(trailersDir, fileName);
        const win = BrowserWindow.getFocusedWindow();
        const args = [ '--config-location', ytDlpConfigPath, '--ffmpeg-location', ffmpegPath, `https://www.youtube.com/watch?v=${videoId}`, '-f', 'bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4]/best', '-o', filePath, '--no-part', '--newline' ];
        return new Promise((resolve) => {
            const ytdlp = spawn(ytDlpPath, args);
            ytdlp.stdout.on('data', (data) => {
                const match = data.toString().match(/\[download\]\s+(\d+(\.\d+)?)%/);
                if (match && match[1]) { if (win) win.webContents.send('download-progress', parseFloat(match[1])); }
            });
            ytdlp.on('close', (code) => resolve(code === 0));
        });
    });

    ipcMain.handle('fetch-steam-achievements', async (_, appId) => {
        const get = k => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
        const apiKey  = get('steam_api_key');
        const steamId = get('steam_id');
        if (!apiKey || !steamId) return { ok: false, error: 'no_credentials' };

        const dbKey = `steam_${appId}`;
        try {
            const [playerRes, schemaRes] = await Promise.all([
                fetch(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${apiKey}&steamid=${steamId}&appid=${appId}&l=english`),
                fetch(`https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${appId}`),
            ]);
            const playerData = await playerRes.json();
            const schemaData = await schemaRes.json();

            if (!playerData.playerstats?.success) return { ok: false, error: playerData.playerstats?.error || 'no_stats' };

            const playerAchs = playerData.playerstats.achievements || [];
            const schemaAchs = schemaData.game?.availableGameStats?.achievements || [];
            const iconMap = {};
            for (const s of schemaAchs) iconMap[s.name] = { icon: s.icon || null, icongray: s.icongray || null };

            db.exec(`CREATE TABLE IF NOT EXISTS achievements (
                app_id TEXT NOT NULL, key TEXT NOT NULL, name TEXT,
                description TEXT, image_locked TEXT, image_unlocked TEXT,
                date_unlocked TEXT, visible INTEGER DEFAULT 1,
                PRIMARY KEY (app_id, key)
            )`);
            const upsert = db.prepare(`INSERT OR REPLACE INTO achievements
                (app_id, key, name, description, image_locked, image_unlocked, date_unlocked, visible)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            db.transaction(list => {
                for (const a of list) {
                    const icons = iconMap[a.apiname] || {};
                    const dateUnlocked = (a.achieved && a.unlocktime) ? new Date(a.unlocktime * 1000).toISOString() : null;
                    upsert.run(dbKey, a.apiname, a.name || a.apiname, a.description || null,
                        icons.icongray || null, icons.icon || null, dateUnlocked, 1);
                }
            })(playerAchs);

            const rows = db.prepare(
                "SELECT * FROM achievements WHERE app_id = ? ORDER BY date_unlocked DESC, name COLLATE NOCASE"
            ).all(dbKey);
            return { ok: true, achievements: rows };
        } catch (e) { return { ok: false, error: e.message }; }
    });

    ipcMain.handle('get-game-achievements', (_, appId) => {
        try {
            // Ensure the table exists (created by Installer on first sync)
            db.exec(`CREATE TABLE IF NOT EXISTS achievements (
                app_id TEXT NOT NULL, key TEXT NOT NULL, name TEXT,
                description TEXT, image_locked TEXT, image_unlocked TEXT,
                date_unlocked TEXT, visible INTEGER DEFAULT 1,
                PRIMARY KEY (app_id, key)
            )`);
            const rows = db.prepare(
                "SELECT * FROM achievements WHERE app_id = ? ORDER BY date_unlocked DESC, name COLLATE NOCASE"
            ).all(appId);
            return { ok: true, achievements: rows };
        } catch (e) { return { ok: false, achievements: [] }; }
    });

}

module.exports = { registerSharedHandlers };
