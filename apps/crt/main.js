'use strict';
/*
 * Clarity, CRT face.
 *
 * A menu-led face for a tube TV: 720x480, interlaced, over composite, through
 * whatever overscan the set happens to have. That combination rules out most
 * of what the other faces do well, so this is not a restyled Couch:
 *
 *   - Art is a garnish, not the interface. A 2:3 cover at this resolution is
 *     about 90px wide and box art does not survive chroma subsampling; the row
 *     of text beside it is what you actually read.
 *   - Nothing thinner than two scanlines. A 1px rule on an interlaced display
 *     is drawn by one field and not the other, so it strobes at 30Hz. Every
 *     border here is 4px or it is not drawn.
 *   - Everything lives inside the title-safe box, because a CRT crops the edges
 *     of the picture and no two sets crop the same amount.
 *
 * Nothing here is a second implementation of something a face already does.
 * The library and settings come from registerSharedHandlers, the palette from
 * the shared omarchy-theme bridge, and what "Play" means — multi-store rows,
 * the Installer engine for GOG and Epic, itch's custom scheme — comes from
 * packages/core/launch.js, which every face shares.
 *
 * What this face does *not* do is hand you somewhere else. Starting a game
 * happens here and leaves the menu exactly where it was; the only ways out are
 * the ones on the root screen.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { spawn } = require('child_process');

const host = require('../../packages/core/platform/index.js');
const { registerSharedHandlers } = require('../../packages/core/shared-ipc.js');
const desktopDescriptor = require('../../packages/core/desktop-descriptor.js');
const launch = require('../../packages/core/launch.js');
const scrape = require('../../packages/core/scrape.js');
const installerOps = require('../../packages/core/installer-ops.js');
const smartPlaylists = require('../../packages/core/smart-playlists.js');

// The CRT face is the Manager wearing different clothes: same identity, so it
// reads the same library and the same settings. A face with its own userData
// would be a second install.
app.setName('clarity');

/*
 * ⚠️ One CSS pixel must be one screen pixel here, and nothing else in the suite
 * cares about that.
 *
 * Omarchy exports GDK_SCALE=2 for the desktop, and Chromium turns that into a
 * fractional device scale factor of its own choosing — on this machine 1.64,
 * which laid a 720x480 window out in a 439x293 viewport. Every measurement in
 * this face is a scanline count: a 4px rule is "two scanlines, so both fields
 * draw it". Multiplied by 1.64 it becomes 6.56 physical pixels, lands on a half
 * pixel, and strobes at 30Hz — precisely the artefact the stylesheet exists to
 * avoid. Scaled text is worse: interlace punishes the resampled stems.
 *
 * So this face opts out of desktop scaling entirely. It is the only face that
 * does, because it is the only one whose design target is a fixed 480-line
 * raster rather than a window of whatever size the user dragged it to.
 */
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// Same derivation as every other face: portable beside the AppImage when
// packaged, the face's own directory in dev.
const baseDir = host.portableBaseDir({
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    devDir: __dirname,
});
const baseAssetPath = app.isPackaged ? process.resourcesPath : __dirname;

// Same portable paths every other face uses.
const configDir    = path.join(baseDir, 'GameManagerConfig');
const dbPath       = path.join(configDir, 'games.db');
const trailersDir  = path.join(configDir, 'videos');
const binDir       = path.join(baseAssetPath, 'assets', 'bin', host.binDirName);
const ytDlpPath    = path.join(binDir, 'yt-dlp');
const ytDlpConfigPath = path.join(binDir, 'yt-dlp.conf');
const ffmpegPath   = path.join(binDir, 'ffmpeg');

let db = null;
let win = null;

function createWindow() {
    win = new BrowserWindow({
        width: 720,
        height: 480,
        fullscreen: true,
        frame: false,
        backgroundColor: '#000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // ⚠️ The same lesson Couch learned: Hyprland can drop a window out of
    // fullscreen and nothing puts it back on its own. A face meant to own the
    // screen has to insist.
    win.on('leave-full-screen', () => { if (win && !win.isDestroyed()) win.setFullScreen(true); });

    win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
    try {
        if (fs.existsSync(dbPath)) db = new Database(dbPath);
    } catch (e) { db = null; }

    if (db) {
        registerSharedHandlers({
            db, baseDir, trailersDir, ytDlpPath, ytDlpConfigPath, ffmpegPath,
            getBeautifulName: (n) => n,
            getOldCrushedName: (n) => n,
        });
    }

    try {
        desktopDescriptor.publish({
            version: app.getVersion(),
            baseDir,
            libraryDb: db ? dbPath : null,
            installerDb: null,
            selfExecutable: host.selfExecutable(),
        });
    } catch (e) { /* the descriptor is a courtesy to other consumers, never load-bearing */ }

    createWindow();
});

app.on('window-all-closed', () => app.quit());

// ── What this face needs that the shared handlers do not already cover ───────

// The rows the menu shows. Deliberately a narrow projection rather than
// `get-games` wholesale: this face shows a name, a state and a thumbnail, and
// shipping every column of 523 rows to display three fields of each is work
// done once per row to use none of it.
ipcMain.handle('crt-library', () => {
    if (!db) return [];
    try {
        return db.prepare(`
            SELECT id, Game, Installed, LastPlayed, GENRE, RELEASED, CoverArt, LaunchCommand, Store,
                   FAV, WANT_TO_PLAY
            FROM games
            WHERE IFNULL(Hidden, '') NOT IN ('1', 'true', 'yes')
            ORDER BY (LastPlayed IS NULL OR LastPlayed = 0), LastPlayed DESC, Game COLLATE NOCASE
        `).all().map(r => ({
            id: r.id,
            name: String(r.Game || ''),
            installed: isTruthy(r.Installed),
            lastPlayed: Number(r.LastPlayed || 0),
            genre: String(r.GENRE || ''),
            year: year(r.RELEASED),
            cover: assetPath(r.CoverArt),
            store: String(r.Store || ''),
            // ⚠️ Stored as the text 'YES'/'NO', not 0/1, and often NULL on rows
            // no one has ever marked. isTruthy handles all three.
            fav: isTruthy(r.FAV) || String(r.FAV || '').toUpperCase() === 'YES',
            want: isTruthy(r.WANT_TO_PLAY) || String(r.WANT_TO_PLAY || '').toUpperCase() === 'YES',
            playable: !!r.LaunchCommand,
        }));
    } catch (e) {
        return [];
    }
});

// ⚠️ This schema stores booleans as text, and not consistently: '1', 'true'
// and 'yes' all occur depending on which importer wrote the row. Truthiness
// has to be decided here rather than by JavaScript, which would call the
// string '0' true.
function isTruthy(v) {
    const s = String(v ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
}

// RELEASED is a free-text date: '1997', '1997-09-30' and 'Sep 1997' all appear.
// The menu has room for a year and nothing else.
function year(v) {
    const m = String(v ?? '').match(/\b(19|20)\d{2}\b/);
    return m ? m[0] : '';
}

/*
 * ⚠️ Three spellings of the same picture live in this column, depending on how
 * the row got into the library: absolute, relative to the install root
 * ('GameManagerConfig/images/x.jpg', which is what the importer writes), and
 * relative to the config directory itself. Resolving against only one of them
 * is why the menu first drew a library with no art in it.
 */
function assetPath(p) {
    const value = String(p || '').trim();
    if (!value) return '';
    if (value.startsWith('/')) return fs.existsSync(value) ? value : '';
    for (const root of [baseDir, configDir]) {
        const abs = path.join(root, value);
        if (fs.existsSync(abs)) return abs;
    }
    return '';
}

/*
 * Starting a game, from here, without leaving this face.
 *
 * ⚠️ The first version handed the game back to the suite as --play=<id>, which
 * started the Manager. That was wrong in the way that matters: this face is not
 * a menu that hands off to a desktop, it is the interface. You stay in it.
 *
 * What "play" means is still not decided here — packages/core/launch.js owns
 * that, and Couch is being moved onto the same module, so there is one answer
 * to the multi-store question and one place that knows GOG and Epic must go
 * through the Installer engine rather than a shell command.
 */
// ⚠️ Built after the database is open, not at module load: `db` is still null
// here, and a launcher holding a null db silently loses the PICO-8 path.
let launcher = null;
function ensureLauncher() {
    if (!launcher) {
        launcher = launch.create({
            db,
            baseDir,
            binDir,
            onLaunchIssue:    (info) => send('crt-launch-failed', info),
            // Three separate things, on three channels, because the face shows
            // them in three different places: a progress panel for an install,
            // a launch panel for the wait between Play and a picture, and a
            // running/exited state for the session itself.
            onProgress:       (info) => send('crt-install-progress', info),
            onLaunchProgress: (info) => send('crt-launch-progress', info),
            onGameSession:    (running, info) => send('crt-game-session', { running, ...info }),
        });
    }
    return launcher;
}

function send(channel, payload) {
    if (win && !win.isDestroyed()) {
        try { win.webContents.send(channel, payload); } catch (e) {}
    }
}

/*
 * Everything the game screen shows that the library list does not carry:
 * artwork and the blurb. Fetched per game, on the way in, rather than for all
 * 523 rows up front — each one costs several fs.existsSync calls to resolve,
 * and a library screen needs none of it.
 *
 * ⚠️ Screenshot is a pipe-separated list, not a path. Description and SteamDesc
 * are both used, because scrapers fill one or the other depending on where the
 * row came from.
 */
ipcMain.handle('crt-game', (event, gameId) => {
    if (!db || !gameId) return null;
    try {
        const r = db.prepare(`
            SELECT id, Game, Store, GENRE, RELEASED, DEV, PUB, Description, SteamDesc,
                   CoverArt, HeroArt, Screenshot, Logo
            FROM games WHERE id=?
        `).get(gameId);
        if (!r) return null;
        const shots = String(r.Screenshot || '').split('|').map(s => assetPath(s)).filter(Boolean);
        return {
            id: r.id,
            name: String(r.Game || ''),
            store: String(r.Store || ''),
            genre: String(r.GENRE || ''),
            year: year(r.RELEASED),
            developer: String(r.DEV || ''),
            publisher: String(r.PUB || ''),
            description: String(r.Description || r.SteamDesc || '').trim(),
            cover: assetPath(r.CoverArt),
            hero: assetPath(r.HeroArt),
            logo: assetPath(r.Logo),
            shot: shots[0] || '',
        };
    } catch (e) {
        return null;
    }
});

// Every way this game can be started, and whether each one is installed right
// now. One launcher is the common case and the face plays it directly; several
// is a real multi-store row and the face asks which.
ipcMain.handle('crt-launchers', (event, gameId) => {
    if (!db || !gameId) return [];
    try {
        // ⚠️ Store, SteamAppID and InstallerGameId are not decoration: without
        // them expandLaunchers silently returns fewer launchers than the row has.
        const game = db.prepare(
            'SELECT id, Store, SteamAppID, InstallerGameId, LaunchCommand, LaunchCommands FROM games WHERE id=?'
        ).get(gameId);
        return game ? ensureLauncher().launcherStates(game) : [];
    } catch (e) {
        return [];
    }
});

ipcMain.handle('crt-launch', (event, gameId, cmd) => {
    if (!db) return { ok: false, error: 'The library is not open.' };
    let command = cmd;
    if (!command) {
        try {
            const game = db.prepare(
                'SELECT id, Store, SteamAppID, InstallerGameId, LaunchCommand, LaunchCommands FROM games WHERE id=?'
            ).get(gameId);
            command = game && (ensureLauncher().expandLaunchers(game)[0] || {}).cmd;
        } catch (e) { /* falls through to the no-command answer below */ }
    }

    const result = ensureLauncher().run(command);
    if (result.ok) {
        // The same write the other faces do, so Continue on the root screen
        // means what it says after playing something from here.
        try { db.prepare('UPDATE games SET LastPlayed=? WHERE id=?').run(Date.now(), gameId); } catch (e) {}
    }
    return result;
});

/*
 * ── Scraping ─────────────────────────────────────────────────────────────────
 *
 * Filling in art and details from here, because the point of this face is that
 * the desktop is optional. packages/core/scrape.js owns what a scrape means —
 * finding the Steam appid by name, Steam, SteamGridDB, HowLongToBeat, ProtonDB
 * and IGDB, and never overwriting art the user already has. This decides which
 * rows to do it to, and says what happened.
 */
let scraper = null;
function ensureScraper() {
    if (!scraper) scraper = scrape.create({ db, imagesDir: path.join(configDir, 'images') });
    return scraper;
}

// Candidate Steam entries for a name — the answer to "the library matched the
// wrong game". The chosen id is passed straight back into a scrape.
ipcMain.handle('crt-steam-search', (event, name) => ensureScraper().searchSteam(String(name || '')));

/*
 * One game. `appId` is optional: given, it forces that Steam entry (the name
 * search having settled which one); omitted, the scraper finds it by title and
 * falls back to IGDB, which is the only source for a GOG-only row.
 */
ipcMain.handle('crt-scrape-one', async (event, gameId, appId) => {
    if (!db) return { ok: false, message: 'The library is not open.' };
    try {
        const row = db.prepare('SELECT id, Game FROM games WHERE id=?').get(gameId);
        if (!row) return { ok: false, message: 'No such game.' };
        return await ensureScraper().autoFetch(gameId, row.Game, appId || '');
    } catch (e) {
        return { ok: false, message: 'Scrape failed.' };
    }
});

/*
 * A batch, over the library or part of it.
 *
 * ⚠️ Sequential, with a pause between games, deliberately. Steam, SteamGridDB,
 * HowLongToBeat and IGDB all rate-limit, and 523 games in parallel is the
 * reliable way to earn a temporary ban rather than a scraped library. Progress
 * is reported per game and the run can be stopped between them.
 */
let scrapeStop = false;
ipcMain.on('crt-scrape-stop', () => { scrapeStop = true; });

ipcMain.handle('crt-scrape-batch', async (event, scope) => {
    if (!db) return { ok: false, message: 'The library is not open.' };
    scrapeStop = false;

    let rows = [];
    try {
        const onlyInstalled = scope === 'installed' ? "AND IFNULL(Installed,'') IN ('1','true','yes')" : '';
        rows = db.prepare(`
            SELECT id, Game, CoverArt, Description, SteamDesc
            FROM games
            WHERE IFNULL(Hidden,'') NOT IN ('1','true','yes') ${onlyInstalled}
            ORDER BY Game COLLATE NOCASE
        `).all();
    } catch (e) {
        return { ok: false, message: 'Could not read the library.' };
    }

    const s = ensureScraper();
    if (scope === 'missing') rows = rows.filter(r => !s.isScraped(r));

    let done = 0, scraped = 0;
    for (const row of rows) {
        if (scrapeStop) break;
        send('crt-scrape-progress', { done, total: rows.length, name: row.Game });
        try {
            const result = await s.autoFetch(row.id, row.Game, '');
            if (result.ok) scraped++;
        } catch (e) { /* one bad row must not end the run */ }
        done++;
        await new Promise(r => setTimeout(r, 400));   // a good citizen of four APIs
    }

    send('crt-scrape-progress', { done, total: rows.length, name: '', finished: true });
    return { ok: true, done, scraped, stopped: scrapeStop, total: rows.length };
});

// How much of the library has anything at all, so the scrape menu can say what
// there is to do rather than making the user guess.
ipcMain.handle('crt-scrape-counts', () => {
    if (!db) return { total: 0, missing: 0, installed: 0, installedMissing: 0 };
    try {
        const rows = db.prepare(`
            SELECT Installed, CoverArt, Description, SteamDesc
            FROM games WHERE IFNULL(Hidden,'') NOT IN ('1','true','yes')
        `).all();
        const s = ensureScraper();
        const installed = rows.filter(r => isTruthy(r.Installed));
        return {
            total: rows.length,
            missing: rows.filter(r => !s.isScraped(r)).length,
            installed: installed.length,
            installedMissing: installed.filter(r => !s.isScraped(r)).length,
        };
    } catch (e) {
        return { total: 0, missing: 0, installed: 0, installedMissing: 0 };
    }
});

/*
 * ── Installing ───────────────────────────────────────────────────────────────
 *
 * GOG and Epic have no client on this machine; the Installer engine is what
 * downloads and sets them up. packages/core/installer-ops.js is the small
 * surface over it, and it shares this process's single engine — prepared by the
 * launcher — rather than configuring a second one.
 */
let installer = null;
function ensureInstaller() {
    if (!installer) {
        installer = installerOps.create({
            baseDir,
            ensureEngine: () => ensureLauncher().ensureEngine(),
        });
    }
    return installer;
}

ipcMain.handle('crt-store-status', async () => {
    const ops = ensureInstaller();
    const status = await ops.status();
    return { ...status, counts: status.available ? ops.counts() : { total: 0, installed: 0, available: 0 } };
});

// Owned but not on disk — the list worth showing on a screen called Install.
ipcMain.handle('crt-store-available', () => ensureInstaller().owned({ installed: false }));

ipcMain.handle('crt-store-refresh', () => ensureInstaller().refreshOwned());

ipcMain.handle('crt-install', async (event, installerGameId) => {
    const result = await ensureInstaller().install(installerGameId);
    // ⚠️ Clarity's own row has to learn about this too, or the library goes on
    // calling an installed game "GET" until something else reconciles it.
    if (result.ok && db) {
        try {
            db.prepare("UPDATE games SET Installed='1' WHERE InstallerGameId=?").run(String(installerGameId));
        } catch (e) { /* the install still happened */ }
        ensureLauncher().invalidateInstallerMap();
    }
    return result;
});

ipcMain.handle('crt-uninstall', async (event, installerGameId) => {
    const result = await ensureInstaller().uninstall(installerGameId);
    if (result.ok && db) {
        try {
            db.prepare("UPDATE games SET Installed='0' WHERE InstallerGameId=?").run(String(installerGameId));
        } catch (e) {}
        ensureLauncher().invalidateInstallerMap();
    }
    return result;
});

ipcMain.on('crt-install-cancel', () => { try { ensureInstaller().cancel(); } catch (e) {} });

// What a game row knows about its Installer counterpart, so the game screen can
// offer Install or Uninstall rather than guessing from Clarity's own flag.
ipcMain.handle('crt-installer-entry', (event, gameId) => {
    if (!db) return null;
    try {
        const row = db.prepare('SELECT InstallerGameId FROM games WHERE id=?').get(gameId);
        const key = String(row?.InstallerGameId || '');
        if (!key) return null;
        return ensureInstaller().owned().find(g => g.id === key) || null;
    } catch (e) {
        return null;
    }
});

/*
 * Everything currently on disk, wherever it came from — the list an Uninstall
 * screen needs.
 *
 * ⚠️ Two kinds of installed game, and only one of them is ours to remove. GOG
 * and Epic titles were downloaded by the Installer engine and it can delete
 * them. A Steam game belongs to Steam: the honest action is to open Steam's own
 * uninstall dialog, not to delete a directory behind its back and leave its
 * manifest claiming the game is there.
 */
ipcMain.handle('crt-installed-games', () => {
    if (!db) return [];
    try {
        const rows = db.prepare(`
            SELECT id, Game, Store, SteamAppID, InstallerGameId, LaunchCommand, LaunchCommands, CoverArt
            FROM games
            WHERE IFNULL(Hidden,'') NOT IN ('1','true','yes')
              AND IFNULL(Installed,'') IN ('1','true','yes')
            ORDER BY Game COLLATE NOCASE
        `).all();

        const ops = ensureInstaller();
        const owned = ops.owned({ installed: true });
        const ownedById = new Map(owned.map(g => [g.id, g]));

        return rows.map(r => {
            const key = String(r.InstallerGameId || '');
            const entry = key ? ownedById.get(key) : null;
            const appId = String(r.SteamAppID || '').replace(/\.0+$/, '').trim();
            const steam = /steam:\/\/rungameid/i.test(String(r.LaunchCommand || '') + String(r.LaunchCommands || ''))
                || (String(r.Store || '').toLowerCase().includes('steam') && appId && appId !== 'None');
            return {
                id: r.id,
                name: String(r.Game || ''),
                cover: assetPath(r.CoverArt),
                // Removable here when the Installer owns it; otherwise Steam's job.
                installerId: entry ? entry.id : '',
                store: entry ? entry.store : (steam ? 'steam' : ''),
                steamAppId: steam ? appId : '',
            };
        }).filter(g => g.installerId || g.steamAppId);
    } catch (e) {
        return [];
    }
});

// Hand a Steam game back to Steam. steam://uninstall opens its own dialog,
// which is the only thing that can remove the game *and* correct its manifest.
ipcMain.handle('crt-steam-uninstall', (event, appId) => {
    const id = String(appId || '').replace(/\.0+$/, '').trim();
    if (!id) return { ok: false, error: 'No Steam app id for this game.' };
    return ensureLauncher().run(`steam steam://uninstall/${id}`);
});

/*
 * ── Marks and collections ────────────────────────────────────────────────────
 *
 * Favourite, want-to-play and playlists already exist in this library; the
 * desktop face writes them and Couch reads them. This face only needed to be
 * taught to do the same, and to store them the way they are already stored.
 *
 * ⚠️ 'YES' / 'NO', as text. Writing 1 and 0 here would produce rows the other
 * faces quietly disagree with.
 */
ipcMain.handle('crt-set-flag', (event, gameId, field, on) => {
    if (!db) return { ok: false };
    const allowed = { fav: 'FAV', want: 'WANT_TO_PLAY' };
    const column = allowed[field];
    if (!column) return { ok: false };
    try {
        db.prepare(`UPDATE games SET ${column}=? WHERE id=?`).run(on ? 'YES' : 'NO', gameId);
        return { ok: true };
    } catch (e) {
        return { ok: false };
    }
});

/*
 * Playlists, including the smart ones.
 *
 * ⚠️ Membership comes from packages/core/smart-playlists.js rather than a
 * straight read of playlist_games: a smart playlist has no rows there at all —
 * its members are computed from its rule every time, which is what keeps it
 * current as the library changes.
 */
ipcMain.handle('crt-playlists', () => {
    if (!db) return [];
    try {
        return db.prepare('SELECT id, name, rule FROM playlists ORDER BY name COLLATE NOCASE').all().map(p => ({
            id: p.id,
            name: String(p.name || ''),
            smart: !!p.rule,
            count: (smartPlaylists.playlistGames(db, p.id) || []).length,
        }));
    } catch (e) {
        return [];
    }
});

ipcMain.handle('crt-playlist-games', (event, playlistId) => {
    if (!db) return [];
    try { return (smartPlaylists.playlistGames(db, playlistId) || []).map(g => g.id); }
    catch (e) { return []; }
});

ipcMain.handle('crt-game-playlists', (event, gameId) => {
    if (!db) return [];
    try { return db.prepare('SELECT playlist_id FROM playlist_games WHERE game_id=?').all(gameId).map(r => r.playlist_id); }
    catch (e) { return []; }
});

// ⚠️ Manual playlists only. A smart playlist's membership is its rule, so
// adding a game by hand would be written and then ignored on the next read.
ipcMain.handle('crt-playlist-toggle', (event, playlistId, gameId) => {
    if (!db) return { ok: false };
    try {
        const playlist = db.prepare('SELECT rule FROM playlists WHERE id=?').get(playlistId);
        if (playlist?.rule) return { ok: false, error: 'That playlist picks its own games.' };
        const present = db.prepare('SELECT 1 FROM playlist_games WHERE playlist_id=? AND game_id=?').get(playlistId, gameId);
        if (present) {
            db.prepare('DELETE FROM playlist_games WHERE playlist_id=? AND game_id=?').run(playlistId, gameId);
            return { ok: true, member: false };
        }
        const max = db.prepare('SELECT MAX(sort_order) AS m FROM playlist_games WHERE playlist_id=?').get(playlistId);
        db.prepare('INSERT INTO playlist_games (playlist_id, game_id, sort_order) VALUES (?,?,?)')
          .run(playlistId, gameId, (max?.m ?? -1) + 1);
        return { ok: true, member: true };
    } catch (e) {
        return { ok: false, error: 'Could not change that playlist.' };
    }
});

// Leaving for another face. The CRT menu is an entry point, not a prison.
ipcMain.on('crt-open-face', (event, face) => {
    const faceArgs = face === 'couch' ? ['--couch']
                   : face === 'manager' ? []
                   : Array.isArray(face) ? face : [];
    openFace(faceArgs);
});

function openFace(faceArgs) {
    try {
        spawn(host.selfExecutable(), host.selfSpawnArgs(faceArgs, baseDir), {
            detached: true,
            stdio: 'ignore',
        }).unref();
    } catch (e) { return; }   // if the other face cannot start, staying here is the right failure
    app.quit();
}

ipcMain.on('crt-quit', () => app.quit());
