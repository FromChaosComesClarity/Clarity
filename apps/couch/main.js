const { app, BrowserWindow, ipcMain, shell } = require('electron');
app.setName('clarity-couch');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const { registerSharedHandlers } = require('../../packages/core/shared-ipc.js');
const _smart = require('../../packages/core/smart-playlists.js');
const host = require('../../packages/core/platform/index.js');
const { spawn, exec, execFile } = require('child_process');
const https = require('https');
const mm = require('music-metadata');

async function searchHltb(gameName) {
    const initData = await new Promise((resolve, reject) => {
        const req = https.get(`https://howlongtobeat.com/api/bleed/init?t=${Date.now()}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'referer': 'https://howlongtobeat.com/',
            }
        }, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    });
    const { token, hpKey, hpVal } = initData;
    const payload = {
        searchType: 'games', searchTerms: gameName.trim().split(' '),
        searchPage: 1, size: 5,
        searchOptions: {
            games: { userId: 0, platform: '', sortCategory: 'popular', rangeCategory: 'main', rangeTime: { min: 0, max: 0 }, gameplay: { perspective: '', flow: '', genre: '', difficulty: '' }, rangeYear: { min: 0, max: 0 }, modifier: '' },
            users: { sortCategory: 'postcount' }, lists: { sortCategory: 'all' },
            filter: '', sort: 0, randomizer: 0
        },
        useCache: true
    };
    if (hpKey) payload[hpKey] = hpVal;
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
        const req = https.request({ hostname: 'howlongtobeat.com', path: '/api/bleed', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'origin': 'https://howlongtobeat.com', 'referer': 'https://howlongtobeat.com/search',
                'x-auth-token': token, 'x-hp-key': hpKey, 'x-hp-val': hpVal }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data).data || []); } catch(e) { reject(e); } });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
        req.write(body); req.end();
    });
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// --- PORTABILITY LOGIC ---
// Where user data lives is the host's call: portable beside the AppImage on Linux, an
// absolute Library path on systems where an app bundle cannot hold its own data.
const baseDir = host.portableBaseDir({ isPackaged: app.isPackaged, execPath: process.execPath, devDir: __dirname });

const isPackaged = app.isPackaged;
const baseAssetPath = isPackaged ? process.resourcesPath : __dirname;
const binDir = path.join(baseAssetPath, 'assets', 'bin', host.binDirName);
const ytDlpPath = path.join(binDir, 'yt-dlp');
const ffmpegPath = path.join(binDir, 'ffmpeg');
const ytDlpConfigPath = path.join(binDir, 'yt-dlp.conf');

// --- UNIFIED PORTABLE PATHS ---
// User Data (EXTERNAL - Uses baseDir)
const configDir = path.join(baseDir, 'GameManagerConfig');

const dbPath = path.join(configDir, 'games.db');
const audioCfgPath = path.join(configDir, 'audio.json');
const playlistsPath = path.join(configDir, 'playlists.json');
const imagesDir = path.join(configDir, 'images');
const trailersDir = path.join(configDir, 'videos');
const musicDir = path.join(baseDir, 'CUSTOM_MUSIC');
// App Assets (INTERNAL - Uses __dirname so it stays packed inside the AppImage)
const soundsDir = path.join(__dirname, 'assets', 'sounds');

let db;

function createWindow () {
    const win = new BrowserWindow({ width: 1280, height: 720, fullscreen: true, frame: false, backgroundColor: '#2C1E16', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webSecurity: false } });
    win.loadFile(path.join(__dirname, 'index.html')); win.webContents.on('did-finish-load', () => { win.webContents.insertCSS('* { cursor: none !important; }'); startSteamInstallWatcher(win); });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const w = BrowserWindow.getAllWindows()[0];
        if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
    });
}

app.whenReady().then(() => {
    if(!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    if(!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });
    if(!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    if(!fs.existsSync(trailersDir)) fs.mkdirSync(trailersDir, { recursive: true });
    try {
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        registerSharedHandlers({ db, baseDir, trailersDir, ytDlpPath, ytDlpConfigPath, ffmpegPath, getBeautifulName, getOldCrushedName });
        db.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)").run();
        // FIX: Ensure the LastPlayed column exists so Couch can register game launches
        try { db.prepare("ALTER TABLE games ADD COLUMN LastPlayed INTEGER DEFAULT 0").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN Description_i18n TEXT DEFAULT ''").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN Franchise TEXT DEFAULT ''").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN IGDBTrailer TEXT DEFAULT ''").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN Installed INTEGER DEFAULT 1").run(); } catch(e) {}
        // One-time migration: rename the legacy launch scheme heroic://launch/… → installer://launch/… (Heroic-era leftover)
        try { db.prepare("UPDATE games SET LaunchCommand = REPLACE(LaunchCommand, 'heroic://launch/', 'installer://launch/') WHERE LaunchCommand LIKE '%heroic://launch/%'").run(); } catch(e) {}
        // Game playlists + Recently-Imported support, schema MUST match The Manager
        // (apps/manager/main.js) since both faces share this games.db. Whichever face
        // opens first creates the tables; the other is a no-op.
        try { db.prepare("ALTER TABLE games ADD COLUMN date_added INTEGER DEFAULT 0").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN kb_played INTEGER DEFAULT 0").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN MacNative INTEGER DEFAULT 0").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN MacNativeChecked INTEGER DEFAULT 0").run(); } catch(e) {}
        try {
            db.prepare(`CREATE TRIGGER IF NOT EXISTS auto_date_added
                AFTER INSERT ON games
                WHEN NEW.date_added IS NULL OR NEW.date_added = 0
                BEGIN UPDATE games SET date_added = CAST(strftime('%s','now') AS INTEGER) WHERE id = NEW.id; END`).run();
        } catch(e) {}
        // A blank Store leaves a game uncategorizable; file it under "Others" (same bucket Installer games use).
        try { db.prepare("UPDATE games SET Store = 'Others' WHERE Store IS NULL OR TRIM(Store) = ''").run(); } catch(e) {}
        try {
            db.prepare(`CREATE TRIGGER IF NOT EXISTS auto_store_others
                AFTER INSERT ON games
                WHEN NEW.Store IS NULL OR TRIM(NEW.Store) = ''
                BEGIN UPDATE games SET Store = 'Others' WHERE id = NEW.id; END`).run();
        } catch(e) {}
        try {
            db.prepare(`CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`).run();
            db.prepare(`CREATE TABLE IF NOT EXISTS playlist_games (playlist_id INTEGER NOT NULL, game_id INTEGER NOT NULL, sort_order INTEGER DEFAULT 0, PRIMARY KEY (playlist_id, game_id), FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE, FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE)`).run();
        } catch(e) {}
    } catch (err) {}
    createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const STEAM_LANG_MAP = { en: 'english', pt_BR: 'brazilian' };
async function fetchDescI18n(appId, enDesc) {
    const lang = db?.prepare("SELECT value FROM settings WHERE key='language'").get()?.value || 'en';
    const i18n = { en: enDesc };
    if (lang !== 'en' && STEAM_LANG_MAP[lang]) {
        try {
            const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=${STEAM_LANG_MAP[lang]}`);
            const d = await r.json();
            if (d[appId]?.success) i18n[lang] = d[appId].data.short_description || enDesc;
        } catch(e) {}
    }
    return JSON.stringify(i18n);
}

// ── Installer integration ───────────────────────────────────────────────────────
// Installer is a face of this same binary now: re-invoke self with a leading 'installer' arg.
function spawnInstallerFace(subArgs, opts) {
    const bin  = host.selfExecutable();
    const args = host.selfSpawnArgs(['installer', ...subArgs], path.join(__dirname, '..', '..'));
    return spawn(bin, args, opts);
}

function readInstallerDb() {
    const dbPath = host.findInstallerDb(baseDir);
    if (!dbPath) return null;
    try {
        const gdb = new Database(dbPath, { readonly: true });
        const rows = gdb.prepare("SELECT id, app_id, store, installed FROM games WHERE installed=1 AND (is_dlc IS NULL OR is_dlc=0)").all();
        gdb.close();
        // Build lookup: app_id → installer game id
        const map = new Map();
        for (const r of rows) {
            if (r.app_id) map.set(String(r.app_id), r.id);
        }
        return map;
    } catch { return null; }
}

let _installerMap = null;   // cached at launch, refreshed lazily
let _installerPath = null;

function getInstallerMap() {
    if (_installerMap === null) {
        _installerMap = readInstallerDb() || new Map();   // read Installer's DB directly (no external AppImage needed)
    }
    return _installerMap;
}

// In-process Installer engine, launch GOG/Epic games without spawning anything
// (Installer is a face of this same binary now). Points at ~/.config/installer.
const installerEngine = require('../../packages/core/installer-engine.js');
let _installerEngineDb = null;
function ensureInstallerEngine() {
    if (_installerEngineDb) return true;
    const home = os.homedir();
    const gdbPath = host.findInstallerDb(baseDir);
    if (!gdbPath) return false;
    const gConfigDir   = path.dirname(gdbPath);
    const engineBinDir = path.join(isPackaged ? process.resourcesPath : __dirname, 'assets', 'bin', host.binDirName);
    try { _installerEngineDb = new Database(gdbPath, { timeout: 5000 }); }
    catch (e) { console.error('[installer-engine] DB open failed:', e); _installerEngineDb = null; return false; }
    installerEngine.init({
        configDir:   gConfigDir,
        prefixesDir: path.join(gConfigDir, 'prefixes'),
        logDir:      path.join(gConfigDir, 'game_logs'),
        binDir:      engineBinDir,
        appImageDir: baseDir,
        homeDir:     home,
        db:          _installerEngineDb,
        onProgress:  () => {},
        onLaunchIssue: (info) => reportLaunchFailure(info),
        onLaunchProgress: (info) => {
            for (const w of BrowserWindow.getAllWindows()) {
                try { w.webContents.send('game-launch-progress', info); } catch {}
            }
        },
    });
    return true;
}

// A Windows game that dies the moment it starts (almost always: no Proton installed) is
// invisible on a TV, the couch UI would just sit there. Push it to the overlay instead.
// Couch can't install Proton itself (no keyboard, and it never owns store/setup flows), so it
// says what's wrong and points at the Manager.
function reportLaunchThrow(installerGameId, err) {
    let title = '';
    try { title = _installerEngineDb?.prepare('SELECT title FROM games WHERE id=?').get(installerGameId)?.title || ''; } catch {}
    reportLaunchFailure({ title, reason: { code: err?.code || 'LAUNCH_ERROR', message: err?.message || 'The game could not be started.' } });
}

function reportLaunchFailure(info) {
    try {
        const payload = {
            title:   info?.title || '',
            code:    info?.reason?.code || 'UNKNOWN',
            message: info?.reason?.message || 'The game could not be started.',
        };
        for (const w of BrowserWindow.getAllWindows()) {
            try { w.webContents.send('game-launch-failed', payload); } catch {}
        }
    } catch {}
}

// Sync installed/uninstalled status from Installer's DB into Couch's games.db
// Same logic as Clarity's installer-status + sync-all-installer-games
function syncInstalledFromInstaller() {
    if (!db) return;
    const gDbPath = host.findInstallerDb(baseDir);
    if (!gDbPath) return;
    try {
        const gdb = new Database(gDbPath, { readonly: true });
        const rows = gdb.prepare("SELECT id, app_id, store, installed, is_dlc FROM games").all();
        gdb.close();
        for (const r of rows) {
            if (!r.app_id || r.is_dlc) continue;
            const val = r.installed ? 1 : 0;
            const res = db.prepare("UPDATE games SET Installed=? WHERE LaunchCommand LIKE ?")
                          .run(val, `%${r.app_id}%`);
            // ⚠️ games.db has no app_id column, it keys Installer games by InstallerGameId, which
            // is exactly the shape of library.db's own row id ('gog_<appId>'). The old fallback
            // asked for app_id and threw, and because the whole loop sits in one try/catch that
            // throw abandoned the sync for every remaining row, not just this one.
            if (res.changes === 0)
                db.prepare("UPDATE games SET Installed=? WHERE InstallerGameId=?").run(val, r.id);
        }
        // The writes above set Installed purely from the GOG/Epic side, which zeroes a
        // mixed-store row (e.g. Steam+GOG) whose Steam copy is the installed one. Re-assert
        // the Steam OR so those rows aren't wrongly downgraded.
        reconcileSteamInstalls();
        _installerMap = null; // invalidate map so launch routing picks up changes
    } catch {}
}

ipcMain.handle('sync-installer-installed', () => { syncInstalledFromInstaller(); return true; });

ipcMain.on('launch-game', (event, cmd) => {
    if (!cmd) return;

    // 1. GOG/Epic via Installer's in-process engine.
    const installerMatch = cmd.match(/installer:\/\/launch\/(epic|gog)\/([^"\s]+)/i);
    if (installerMatch) {
        const gId = getInstallerMap().get(installerMatch[2]);
        if (gId && ensureInstallerEngine()) {
            installerEngine.launchGame(gId).catch(e => { console.error('[launch-game] installer launch failed:', e.message); reportLaunchThrow(gId, e); });
        } else {
            console.error('[launch-game] no Installer mapping/engine for', installerMatch[2]);
        }
        return; // GOG/Epic must go through Installer, never fall through to a shell command
    }
    // installer://launch/<id> (direct Installer id)
    const gLaunch = cmd.match(/^installer:\/\/(?:launch\/)?(.+)$/);
    if (gLaunch) {
        if (ensureInstallerEngine()) installerEngine.launchGame(gLaunch[1]).catch(e => { console.error('[launch-game]', e.message); reportLaunchThrow(gLaunch[1], e); });
        return;
    }

    // 2. itch.io, hand the scheme to the desktop's opener (shell.openExternal rejects custom schemes)
    if (cmd.startsWith('itch://')) {
        host.desktop.openUrlScheme(cmd);
        return;
    }

    // 3. PICO-8 cart launch
    if (cmd.startsWith('pico8-cart:')) {
        const cartPath = cmd.slice('pico8-cart:'.length);
        const bin = _getPico8Bin();
        if (bin) spawn(bin, ['-run', cartPath], { detached: true, stdio: 'ignore' }).unref();
        return;
    }

    const child = spawn(cmd, [], { shell: true, detached: true, stdio: 'ignore' });
    child.unref();
});

ipcMain.on('quit-app', () => app.quit());
const SAVE_DB_ALLOWED_FIELDS = new Set(['FAV', 'WANT_TO_PLAY', 'LaunchCommand', 'Game', 'CoverArt', 'Screenshot', 'DEV', 'PUB', 'RELEASED', 'GENRE', 'METACRITIC', 'Description', 'Description_i18n', 'ProtonTier', 'SteamAppID', 'HLTB_Main', 'Installed', 'kb_played', 'Hidden']);

// Kept as a local name so the call sites below read unchanged.
const getSteamLibraryPaths = () => host.steamLibraryPaths();
function isSteamGameInstalled(appId) {
    if (!appId || appId === 'None' || appId === '') return false;
    const id = String(appId).replace(/\.0+$/, '');
    return getSteamLibraryPaths().some(dir => fs.existsSync(path.join(dir, `appmanifest_${id}.acf`)));
}
// ── Multi-store install detection (mirrors the Manager) ──────────────────────
// A row can front several stores (Store "Steam, GOG") with one launcher per store in
// LaunchCommands. Install state is the OR across those stores; keying off only the
// primary LaunchCommand hid an installed Steam copy whenever the primary was GOG/Epic.
function installerDbPath() {
    return host.findInstallerDb(baseDir);
}
function guessLauncherLabel(cmd) {
    if (!cmd) return 'Custom';
    if (/steam:\/\/rungameid/i.test(cmd))     return 'Steam';
    if (/installer:\/\/launch\/gog/i.test(cmd))  return 'GOG via Installer';
    if (/installer:\/\/launch\/epic/i.test(cmd)) return 'Epic via Installer';
    if (cmd.startsWith('itch://'))            return 'itch.io';
    if (cmd.startsWith('pico8-cart:'))        return 'PICO-8';
    if (/^flatpak run/i.test(cmd))           return 'Flatpak';
    if (cmd.startsWith('installer://'))         return 'Installer';
    return 'Custom';
}
function launcherStore(cmd) {
    if (/steam:\/\/rungameid/i.test(cmd))        return 'steam';
    if (/installer:\/\/launch\/gog\//i.test(cmd))  return 'gog';
    if (/installer:\/\/launch\/epic\//i.test(cmd)) return 'epic';
    return null;
}
// The canonical per-store launcher list for a row: [{ label, cmd }], mirrors the Manager.
// LaunchCommands is the source of truth when populated, but plenty of genuinely multi-store
// rows never had it written (legacy cross-store merges, or a Manager save that dropped the
// Installer launcher), so anything the row's own store fields prove exists is filled back in.
// Needs Store + InstallerGameId on the row; a SELECT without them just skips the synthesis.
function expandLaunchers(game) {
    const out = [], seen = new Set();
    const add = (label, cmd) => {
        if (!cmd || seen.has(cmd)) return;
        seen.add(cmd);
        out.push({ label: label || guessLauncherLabel(cmd), cmd });
    };
    try { for (const l of JSON.parse(game.LaunchCommands || '[]')) if (l && l.cmd) add(l.label, l.cmd); } catch {}
    add(null, game.LaunchCommand);

    const stores = (game.Store || '').toLowerCase();
    const has = s => out.some(l => launcherStore(l.cmd) === s);

    // SteamAppID alone proves nothing, it doubles as the metadata key on GOG/itch rows.
    const appId = String(game.SteamAppID || '').replace(/\.0+$/, '').trim();
    if (stores.includes('steam') && appId && appId !== 'None' && !has('steam')) {
        add('Steam', host.steamLaunchCommand(appId));
    }
    const gg = String(game.InstallerGameId || '').match(/^(gog|epic)_(.+)$/i);
    if (gg) {
        const store = gg[1].toLowerCase();
        if (stores.includes(store) && !has(store)) {
            add(store === 'gog' ? 'GOG via Installer' : 'Epic via Installer', `installer://launch/${store}/${gg[2]}`);
        }
    }
    return out;
}
function launchCmdsOf(game) {
    return expandLaunchers(game).map(l => l.cmd);
}
let _installerInstalledCache = { key: '', set: new Set() };
function installerInstalledSet() {
    const p = installerDbPath();
    if (!p) { _installerInstalledCache = { key: '', set: new Set() }; return _installerInstalledCache.set; }
    let key = p;
    try { key += ':' + fs.statSync(p).mtimeMs; } catch {}
    if (key === _installerInstalledCache.key) return _installerInstalledCache.set;
    const set = new Set();
    try {
        const gdb = new Database(p, { readonly: true, timeout: 5000 });
        for (const r of gdb.prepare("SELECT id FROM games WHERE installed=1").all()) set.add(String(r.id));
        gdb.close();
    } catch {}
    _installerInstalledCache = { key, set };
    return set;
}
function launcherInstalled(cmd, steamAppId) {
    const c = cmd || '';
    const sm = c.match(/steam:\/\/rungameid\/(\d+)/i);
    if (sm) return isSteamGameInstalled(sm[1] || steamAppId);
    const gm = c.match(/installer:\/\/launch\/(gog|epic)\/([^"\s]+)/i);
    if (gm) return installerInstalledSet().has(`${gm[1].toLowerCase()}_${gm[2]}`);
    return null;
}
function resolveInstallState(game) {
    const cmds = launchCmdsOf(game);
    if (!cmds.some(c => /steam:\/\/rungameid/i.test(c))) return null;
    let allTracked = true;
    for (const cmd of cmds) {
        const s = launcherInstalled(cmd, game.SteamAppID);
        if (s === true) return 1;
        if (s === null) allTracked = false;
    }
    return allTracked ? 0 : null;
}
function launcherStatesForGame(game) {
    return expandLaunchers(game).map(l => ({
        label: l.label || guessLauncherLabel(l.cmd),
        cmd: l.cmd,
        store: launcherStore(l.cmd || ''),
        installed: launcherInstalled(l.cmd, game.SteamAppID) === true,
    }));
}
ipcMain.handle('launcher-states', (e, gameId) => {
    if (!db) return [];
    const game = db.prepare("SELECT Store, SteamAppID, InstallerGameId, LaunchCommand, LaunchCommands FROM games WHERE id=?").get(gameId);
    return game ? launcherStatesForGame(game) : [];
});
ipcMain.handle('verify-install-status', (e, gameId) => {
    if (!db) return { installed: 1 };
    const game = db.prepare("SELECT id, Store, SteamAppID, InstallerGameId, LaunchCommand, LaunchCommands, Installed FROM games WHERE id=?").get(gameId);
    if (!game) return { installed: 1 };
    const installed = resolveInstallState(game);
    if (installed !== null) db.prepare("UPDATE games SET Installed=? WHERE id=?").run(installed, gameId);
    return { installed: installed ?? game.Installed ?? 1 };
});

// Reconcile Installed for every Steam-fronting row (incl. mixed-store rows whose Steam
// launcher lives in LaunchCommands, not the primary). Returns how many rows changed.
function reconcileSteamInstalls() {
    if (!db) return 0;
    let changed = 0;
    const games = db.prepare(
        "SELECT id, Store, SteamAppID, InstallerGameId, LaunchCommand, LaunchCommands, Installed FROM games " +
        // Also rows that only imply their Steam launcher: a Steam tag plus an appid (see expandLaunchers).
        "WHERE LaunchCommand LIKE '%steam://rungameid%' OR LaunchCommands LIKE '%steam://rungameid%' " +
        "OR (LOWER(Store) LIKE '%steam%' AND SteamAppID IS NOT NULL AND SteamAppID NOT IN ('', 'None'))"
    ).all();
    for (const g of games) {
        const s = resolveInstallState(g);
        if (s !== null && s !== g.Installed) { db.prepare("UPDATE games SET Installed=? WHERE id=?").run(s, g.id); changed++; }
    }
    return changed;
}

let steamInstallWatchers = [];
function startSteamInstallWatcher(win) {
    steamInstallWatchers.forEach(w => { try { w.close(); } catch(e) {} });
    steamInstallWatchers = [];
    // Reconcile once at boot so a Steam-installed game fronted by GOG/Epic corrects itself.
    try { if (reconcileSteamInstalls() && win) win.webContents.send('install-status-updated'); } catch(e) {}
    let debounce = null;
    const onChange = (ev, filename) => {
        if (!filename || !filename.startsWith('appmanifest_')) return;
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            if (reconcileSteamInstalls() >= 0 && win) win.webContents.send('install-status-updated');
        }, 1500);
    };
    for (const dir of getSteamLibraryPaths()) {
        try { steamInstallWatchers.push(fs.watch(dir, { persistent: false }, onChange)); } catch(e) {}
    }
}
ipcMain.on('save-db-field', (event, { game, field, value }) => { if (!db || !SAVE_DB_ALLOWED_FIELDS.has(field)) return; try { db.prepare(`UPDATE games SET ${field} = ? WHERE Game = ?`).run(value, game); } catch (e) {} });

// FIX: New IPC Handler to securely update the LastPlayed timestamp
ipcMain.handle('update-last-played', (event, gameName) => {
    if (!db) return false;
    try {
        db.prepare("UPDATE games SET LastPlayed = ? WHERE Game = ?").run(Date.now(), gameName);
        return true;
    } catch(err) { return false; }
});

// --- WINDOW FOCUS & FOREGROUND LOGIC ---
ipcMain.on('force-focus', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    app.focus({ steal: true }); // Electron's own steal flag, works on some Linux WMs

    // Visually pin on top, then release after the launcher has been pushed behind
    win.setAlwaysOnTop(true, 'screen-saver');
    setTimeout(() => win.setAlwaysOnTop(false), 2000);

    // Then whatever else the host can do to raise a window past focus-stealing
    // prevention. Always safe to call, a host with no such trick does nothing.
    host.desktop.focusWindow(win);
});

ipcMain.handle('fetch-hltb', async (event, gameName) => { try { const results = await searchHltb(gameName); if (results.length > 0 && results[0].comp_main > 0) return `${Math.round(results[0].comp_main / 3600)} Hours`; return "Unknown"; } catch (e) { return "Error"; } });
ipcMain.handle('fetch-proton', async (event, appId) => { try { const response = await fetch(`https://www.protondb.com/api/v1/reports/summaries/${appId}.json`); if (!response.ok) return "Error"; const data = await response.json(); return data.tier ? data.tier : "Unknown"; } catch (e) { return "Error"; } });

// --- BEAUTIFUL NAMING HELPERS ---
function getBeautifulName(gameName) { return gameName.replace(/[\\/:*?"<>|#]/g, '').trim(); }
function getOldCrushedName(gameName) { return gameName.replace(/[^a-z0-9]/gi, '_').toLowerCase(); }

// Trailer logic checks BOTH naming conventions so old trailers don't break!

ipcMain.handle('delete-trailer', (event, gameName) => {
    const beautifulPath = path.join(trailersDir, `${getBeautifulName(gameName)}.mp4`);
    const oldPath = path.join(trailersDir, `${getOldCrushedName(gameName)}.mp4`);
    try {
        if (fs.existsSync(beautifulPath)) fs.unlinkSync(beautifulPath);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        return true;
    } catch(e) { return false; }
});

async function downloadImage(url, dest) { try { const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (!res.ok) return false; const buffer = await res.arrayBuffer(); fs.writeFileSync(dest, Buffer.from(buffer)); return true; } catch(e) { return false; } }

function titleSimilarity(a, b) {
    const tokens = s => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
    const ta = tokens(a), tb = tokens(b);
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return inter / (ta.size + tb.size - inter);
}

async function getIgdbToken() {
    const clientId = db?.prepare("SELECT value FROM settings WHERE key='igdb_client_id'").get()?.value;
    const secret   = db?.prepare("SELECT value FROM settings WHERE key='igdb_client_secret'").get()?.value;
    if (!clientId || !secret) return null;
    const cached = db.prepare("SELECT value FROM settings WHERE key='igdb_token'").get()?.value;
    const expiry = db.prepare("SELECT value FROM settings WHERE key='igdb_token_expiry'").get()?.value;
    if (cached && expiry && Date.now() < parseInt(expiry)) return { token: cached, clientId };
    try {
        const res  = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${secret}&grant_type=client_credentials`, { method: 'POST' });
        const data = await res.json();
        if (!data.access_token) return null;
        const exp = Date.now() + (data.expires_in * 1000) - 86400000;
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('igdb_token',?)").run(data.access_token);
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('igdb_token_expiry',?)").run(String(exp));
        return { token: data.access_token, clientId };
    } catch(e) { return null; }
}
async function igdbQuery(auth, body) {
    const res = await fetch('https://api.igdb.com/v4/games', { method: 'POST', headers: { 'Client-ID': auth.clientId, 'Authorization': `Bearer ${auth.token}`, 'Content-Type': 'text/plain' }, body });
    const data = await res.json();
    if (!Array.isArray(data) || data[0]?.title) return null;
    return data[0] || null;
}
async function igdbSearch(gameName, steamAppId) {
    const auth = await getIgdbToken();
    if (!auth) return null;
    const fields = 'fields name,summary,involved_companies.developer,involved_companies.publisher,involved_companies.company.name,genres.name,themes.name,themes.id,first_release_date,aggregated_rating,cover.url,screenshots.url,similar_games.name,franchises.name,collection.name,external_games.category,external_games.uid;';
    try {
        if (steamAppId) {
            const byId = await igdbQuery(auth, `${fields} where external_games.uid = "${steamAppId}" & external_games.category = 1; limit 1;`);
            if (byId) return byId;
        }
        return await igdbQuery(auth, `search "${gameName.replace(/"/g, '')}"; ${fields} limit 3;`);
    } catch(e) { return null; }
}
function igdbImg(url, size = 'cover_big') { if (!url) return null; return 'https:' + url.replace('t_thumb', `t_${size}`); }

async function sgdbFetchFirst(gameName, apiKey, appId, assetType) {
    try {
        const headers = { "Authorization": `Bearer ${apiKey}`, "User-Agent": "Mozilla/5.0" };
        let sgdbId = null;
        if (appId) { const r = await fetch(`https://www.steamgriddb.com/api/v2/games/steam/${appId}`, { headers }); const d = await r.json(); if (d.success && d.data) sgdbId = d.data.id; }
        if (!sgdbId) { const res = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`, { headers }); const data = await res.json(); if (!data.success || !data.data?.length) return null; sgdbId = data.data[0].id; }
        const endpoint = assetType === 'hero' ? 'heroes' : assetType === 'logo' ? 'logos' : 'grids';
        const res2 = await fetch(`https://www.steamgriddb.com/api/v2/${endpoint}/game/${sgdbId}`, { headers });
        const data2 = await res2.json();
        if (!data2.success || !data2.data?.length) return null;
        const ext = assetType === 'logo' ? 'png' : 'jpg';
        const safeN = gameName.replace(/[\\/:*?"<>|#]/g, '').trim();
        const fileName = `${safeN} - SGDB ${assetType}.${ext}`;
        if (await downloadImage(data2.data[0].url, path.join(imagesDir, fileName))) return `GameManagerConfig/images/${fileName}`;
        return null;
    } catch(e) { return null; }
}

ipcMain.handle('get-strings', (_, lang) => require('./i18n')(lang || 'en'));

ipcMain.handle('search-steam', async (e, gameName) => { try { let res = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`); let data = await res.json(); if (!data.items || data.items.length === 0) return []; return data.items.map(item => ({ id: item.id, name: item.name })); } catch(e) { return []; } });

ipcMain.handle('search-igdb', async (e, gameName) => {
    try {
        const auth = await getIgdbToken();
        if (!auth) return [];
        const res = await fetch('https://api.igdb.com/v4/games', {
            method: 'POST',
            headers: { 'Client-ID': auth.clientId, 'Authorization': `Bearer ${auth.token}`, 'Content-Type': 'text/plain' },
            body: `search "${gameName.replace(/"/g, '')}"; fields id,name,first_release_date; limit 8;`
        });
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        return data.filter(g => g.name).map(g => ({ id: g.id, name: g.name, year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null }));
    } catch(e) { return []; }
});

// ── GOG Achievements ──────────────────────────────────────────────────────────
const GOG_CLIENT_ID     = '46899977096215655';
const GOG_CLIENT_SECRET = '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9';

ipcMain.handle('fetch-achievements-now', async (_, appId) => {
    const gdbPath = host.findInstallerDb(baseDir);
    if (!gdbPath) return { ok: false, error: 'installer_not_found' };

    let token, userId;
    try {
        const gdb = new Database(gdbPath, { timeout: 5000 });
        const get = k => gdb.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
        let access  = get('gog_access_token');
        const refresh = get('gog_refresh_token');
        const expiry  = parseInt(get('gog_token_expiry') || '0');
        userId = get('gog_user_id');

        if (!refresh || !userId) { gdb.close(); return { ok: false, error: 'not_logged_in' }; }

        if (!access || Date.now() >= expiry - 60000) {
            const res = await fetch('https://auth.gog.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: GOG_CLIENT_ID, client_secret: GOG_CLIENT_SECRET,
                    grant_type: 'refresh_token', refresh_token: refresh,
                }).toString(),
            });
            const data = await res.json();
            if (!data.access_token) { gdb.close(); return { ok: false, error: 'token_refresh_failed' }; }
            access = data.access_token;
            const set = (k, v) => gdb.prepare("INSERT OR REPLACE INTO settings VALUES (?,?)").run(k, v);
            set('gog_access_token', access);
            set('gog_token_expiry', String(Date.now() + data.expires_in * 1000));
            if (data.refresh_token) set('gog_refresh_token', data.refresh_token);
        }
        token = access;
        gdb.close();
    } catch (e) { return { ok: false, error: e.message }; }

    try {
        const res = await fetch(
            `https://gameplay.gog.com/clients/${appId}/users/${userId}/achievements`,
            { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'Couch/1.0' } }
        );
        if (!res.ok) return { ok: false, error: `GOG API ${res.status}` };
        const data = await res.json();
        const items = data.items || [];

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
            for (const a of list) upsert.run(
                appId, a.achievement_key, a.name, a.description,
                a.image_url_locked, a.image_url_unlocked, a.date_unlocked || null,
                a.visible === false ? 0 : 1
            );
        })(items);

        const rows = db.prepare(
            "SELECT * FROM achievements WHERE app_id = ? ORDER BY date_unlocked DESC, name COLLATE NOCASE"
        ).all(appId);
        return { ok: true, achievements: rows };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('scrape-igdb-data', async (e, gameName, mode, igdbId) => {
    try {
        const auth = await getIgdbToken();
        if (!auth) return false;
        const fields = 'fields name,summary,involved_companies.developer,involved_companies.publisher,involved_companies.company.name,genres.name,themes.name,themes.id,first_release_date,aggregated_rating,cover.url,screenshots.url,similar_games.name,franchises.name,collection.name,external_games.category,external_games.uid;';
        const res = await fetch('https://api.igdb.com/v4/games', {
            method: 'POST',
            headers: { 'Client-ID': auth.clientId, 'Authorization': `Bearer ${auth.token}`, 'Content-Type': 'text/plain' },
            body: `${fields} where id = ${igdbId}; limit 1;`
        });
        const data = await res.json();
        if (!Array.isArray(data) || !data[0]) return false;
        const igdb = data[0];
        const beautifulName = getBeautifulName(gameName);
        const steamExt = igdb.external_games?.find(ex => ex.category === 1);
        const steamAppId = steamExt?.uid ? String(steamExt.uid).replace(/\.0+$/, '') : null;
        const isAdultContent = igdb.themes?.some(t => t.id === 42);
        let overallSuccess = false;

        if (mode === 'COVER' || mode === 'ALL') {
            // Cover, Steam CDN preferred, IGDB fallback (skip IGDB if adult content)
            const coverFile = `${beautifulName} - Cover.jpg`;
            let coverOk = steamAppId ? await downloadImage(`https://steamcdn-a.akamaihd.net/steam/apps/${steamAppId}/library_600x900.jpg`, path.join(imagesDir, coverFile)) : false;
            if (!coverOk && igdb.cover?.url && !isAdultContent) coverOk = await downloadImage(igdbImg(igdb.cover.url, 'cover_big'), path.join(imagesDir, coverFile));
            if (coverOk) { db.prepare("UPDATE games SET CoverArt=? WHERE Game=?").run(`GameManagerConfig/images/${coverFile}`, gameName); overallSuccess = true; }

            // Hero Art, Steam CDN only
            if (steamAppId) {
                const heroFile = `${beautifulName} - Hero.jpg`;
                if (await downloadImage(`https://steamcdn-a.akamaihd.net/steam/apps/${steamAppId}/library_hero.jpg`, path.join(imagesDir, heroFile)))
                    db.prepare("UPDATE games SET HeroArt=? WHERE Game=?").run(`GameManagerConfig/images/${heroFile}`, gameName);
            }

            // Logo, Steam CDN, then SGDB
            const logoFile = `${beautifulName} - Logo.png`;
            let logoOk = steamAppId ? await downloadImage(`https://steamcdn-a.akamaihd.net/steam/apps/${steamAppId}/logo.png`, path.join(imagesDir, logoFile)) : false;
            if (!logoOk) {
                const sgdbKey = db?.prepare("SELECT value FROM settings WHERE key='steamgriddb_api'").get()?.value;
                if (sgdbKey) { const p = await sgdbFetchFirst(gameName, sgdbKey, steamAppId, 'logo'); if (p) { db.prepare("UPDATE games SET Logo=? WHERE Game=?").run(p, gameName); logoOk = true; } }
            }
            if (logoOk && !db?.prepare("SELECT Logo FROM games WHERE Game=?").get(gameName)?.Logo?.startsWith('GameManager'))
                db.prepare("UPDATE games SET Logo=? WHERE Game=?").run(`GameManagerConfig/images/${logoFile}`, gameName);
        }

        if (mode === 'SCREENSHOTS' || mode === 'ALL') {
            const saved = [];
            if (igdb.screenshots?.length && !isAdultContent) {
                for (let i = 0; i < Math.min(5, igdb.screenshots.length); i++) {
                    const fn = `${beautifulName} - Screen ${i+1}.jpg`;
                    if (await downloadImage(igdbImg(igdb.screenshots[i].url, 'screenshot_big'), path.join(imagesDir, fn)))
                        saved.push(`GameManagerConfig/images/${fn}`);
                }
            }
            if (saved.length) { db.prepare("UPDATE games SET Screenshot=? WHERE Game=?").run(saved.join('|'), gameName); overallSuccess = true; }
        }

        if (mode === 'METADATA' || mode === 'ALL') {
            const genre   = [...(igdb.genres?.map(g => g.name) || []), ...(igdb.themes?.map(t => t.name) || [])].slice(0, 3).join(', ');
            const release = igdb.first_release_date ? new Date(igdb.first_release_date * 1000).getFullYear().toString() : "";
            const meta    = igdb.aggregated_rating ? Math.round(igdb.aggregated_rating).toString() : "";
            const dev     = igdb.involved_companies?.filter(c => c.developer).map(c => c.company.name).join(', ') || "";
            const pub     = igdb.involved_companies?.filter(c => c.publisher).map(c => c.company.name).join(', ') || "";
            const desc    = igdb.summary || "";
            const similar = igdb.similar_games?.map(g => g.name).slice(0, 6).join(', ') || "";
            const franchise = igdb.franchises?.[0]?.name || igdb.collection?.name || "";
            let hltb = "", proton = "";
            try { let hr = await searchHltb(gameName); if (hr.length > 0 && hr[0].comp_main > 0) hltb = `${Math.round(hr[0].comp_main / 3600)} Hours`; } catch(e) {}
            if (steamAppId) { try { const pr = await fetch(`https://www.protondb.com/api/v1/reports/summaries/${steamAppId}.json`); if (pr.ok) { const pd = await pr.json(); if (pd.tier) proton = pd.tier.toUpperCase(); } } catch(e) {} }
            const descI18n = await fetchDescI18n(steamAppId, desc);
            db.prepare("UPDATE games SET GENRE=?,RELEASED=?,METACRITIC=?,DEV=?,PUB=?,Description=?,Description_i18n=?,SteamAppID=?,HLTB_Main=?,ProtonTier=?,SimilarGames=?,Franchise=? WHERE Game=?")
              .run(genre, release, meta, dev, pub, desc, descI18n, steamAppId || "", hltb, proton, similar, franchise, gameName);
            overallSuccess = true;
        }

        return overallSuccess;
    } catch(err) { return false; }
});

ipcMain.handle('sgdb-search', async (e, gameName, apiKey, appId) => {
    try {
        const headers = { "Authorization": `Bearer ${apiKey}`, "User-Agent": "Mozilla/5.0" }; let sgdbId = null;
        if (appId) { let r = await fetch(`https://www.steamgriddb.com/api/v2/games/steam/${appId}`, {headers}); let d = await r.json(); if (d.success && d.data) sgdbId = d.data.id; }
            if (!sgdbId) { let res = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`, {headers}); let data = await res.json(); if (!data.success || !data.data || data.data.length === 0) return []; sgdbId = data.data[0].id; }
                let res2 = await fetch(`https://www.steamgriddb.com/api/v2/grids/game/${sgdbId}?dimensions=600x900`, {headers}); let data2 = await res2.json(); if (!data2.success || !data2.data) return []; return data2.data.map(g => ({ thumb: g.thumb, url: g.url }));
    } catch(e) { return []; }
});

ipcMain.handle('sgdb-apply', async (e, gameName, url) => {
    const fileName = `${getBeautifulName(gameName)} - Custom Cover.jpg`;
    const savePath = path.join(imagesDir, fileName);
    const success = await downloadImage(url, savePath);
    if (success) {
        db.prepare("UPDATE games SET CoverArt = ? WHERE Game = ?").run(`GameManagerConfig/images/${fileName}`, gameName);
    }
    return success;
});

ipcMain.handle('scrape-steam-data', async (e, gameName, mode, appId) => {
    try {
        const beautifulName = getBeautifulName(gameName);
        if (!appId) return false;

        const steamRes = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
        const steamJson = await steamRes.json();
        if (!steamJson[appId]?.success) return false;
        const appData = steamJson[appId].data;
        let overallSuccess = false;

        // ── COVER + HERO + LOGO ───────────────────────────────────────────
        if (mode === 'COVER' || mode === 'ALL') {
            // Cover
            const coverFile = `${beautifulName} - Cover.jpg`;
            let coverOk = await downloadImage(`https://steamcdn-a.akamaihd.net/steam/apps/${appId}/library_600x900.jpg`, path.join(imagesDir, coverFile));
            if (!coverOk && appData.header_image) coverOk = await downloadImage(appData.header_image, path.join(imagesDir, coverFile));
            if (coverOk) { db.prepare("UPDATE games SET CoverArt=? WHERE Game=?").run(`GameManagerConfig/images/${coverFile}`, gameName); overallSuccess = true; }

            // Hero Art
            const heroFile = `${beautifulName} - Hero.jpg`;
            if (await downloadImage(`https://steamcdn-a.akamaihd.net/steam/apps/${appId}/library_hero.jpg`, path.join(imagesDir, heroFile)))
                db.prepare("UPDATE games SET HeroArt=? WHERE Game=?").run(`GameManagerConfig/images/${heroFile}`, gameName);

            // Logo, Steam CDN first, SGDB fallback
            const logoFile = `${beautifulName} - Logo.png`;
            let logoOk = await downloadImage(`https://steamcdn-a.akamaihd.net/steam/apps/${appId}/logo.png`, path.join(imagesDir, logoFile));
            if (!logoOk) {
                const sgdbKey = db?.prepare("SELECT value FROM settings WHERE key='steamgriddb_api'").get()?.value;
                if (sgdbKey) { const p = await sgdbFetchFirst(gameName, sgdbKey, appId, 'logo'); if (p) { db.prepare("UPDATE games SET Logo=? WHERE Game=?").run(p, gameName); logoOk = true; } }
            }
            if (logoOk && !db?.prepare("SELECT Logo FROM games WHERE Game=?").get(gameName)?.Logo?.startsWith('GameManager'))
                db.prepare("UPDATE games SET Logo=? WHERE Game=?").run(`GameManagerConfig/images/${logoFile}`, gameName);
        }

        // ── SCREENSHOTS ───────────────────────────────────────────────────
        if (mode === 'SCREENSHOTS' || mode === 'ALL') {
            if (appData.screenshots?.length) {
                const saved = [];
                for (let i = 0; i < Math.min(5, appData.screenshots.length); i++) {
                    const fn = `${beautifulName} - Screen ${i+1}.jpg`;
                    if (await downloadImage(appData.screenshots[i].path_full, path.join(imagesDir, fn)))
                        saved.push(`GameManagerConfig/images/${fn}`);
                }
                if (saved.length) { db.prepare("UPDATE games SET Screenshot=? WHERE Game=?").run(saved.join('|'), gameName); overallSuccess = true; }
            }
        }

        // ── METADATA ──────────────────────────────────────────────────────
        if (mode === 'METADATA' || mode === 'ALL') {
            let genre   = appData.genres?.map(g => g.description).join(', ') || "";
            let release = appData.release_date?.date?.slice(-4) || "";
            let meta    = appData.metacritic ? String(appData.metacritic.score) : "";
            let dev     = appData.developers?.join(', ') || "";
            let pub     = appData.publishers?.join(', ') || "";
            let desc    = appData.short_description || "";

            const cats    = appData.categories?.map(c => c.description) || [];
            let coop      = "None";
            if (cats.includes("Online Co-op") && cats.includes("Shared/Split Screen Co-op")) coop = "Local & Online";
            else if (cats.includes("Online Co-op")) coop = "Online";
            else if (cats.includes("Shared/Split Screen Co-op")) coop = "Local";
            else if (cats.includes("Co-op")) coop = "Online/Local";
            const players = [cats.includes("Single-player") && "Single-player", cats.includes("Multi-player") && "Multi-player"].filter(Boolean).join(', ');

            // HLTB
            let hltb = "";
            try {
                let hr = await searchHltb(gameName);
                if (!hr.length) hr = await searchHltb(gameName.replace(/[:\-].*/, '').replace(/[™®©]/g, '').trim());
                if (hr.length > 0 && hr[0].comp_main > 0) hltb = `${Math.round(hr[0].comp_main / 3600)} Hours`;
            } catch(e) {}

            // ProtonDB
            let proton = "";
            try {
                const pr = await fetch(`https://www.protondb.com/api/v1/reports/summaries/${appId}.json`);
                if (pr.ok) { const pd = await pr.json(); if (pd.tier) proton = pd.tier.toUpperCase(); }
            } catch(e) {}

            // IGDB, similar games, franchise, fill gaps
            let similar = "", franchise = "";
            try {
                const igdb = await igdbSearch(gameName, appId);
                if (igdb) {
                    if (igdb.similar_games?.length) similar = igdb.similar_games.map(g => g.name).slice(0, 6).join(', ');
                    franchise = igdb.franchises?.[0]?.name || igdb.collection?.name || "";
                    if (!genre   && igdb.genres)             genre   = [...(igdb.genres?.map(g => g.name) || []), ...(igdb.themes?.map(t => t.name) || [])].slice(0, 3).join(', ');
                    if (!dev     && igdb.involved_companies)  dev     = igdb.involved_companies.filter(c => c.developer).map(c => c.company.name).join(', ');
                    if (!pub     && igdb.involved_companies)  pub     = igdb.involved_companies.filter(c => c.publisher).map(c => c.company.name).join(', ');
                    if (!release && igdb.first_release_date)  release = new Date(igdb.first_release_date * 1000).getFullYear().toString();
                    if (!meta    && igdb.aggregated_rating)   meta    = Math.round(igdb.aggregated_rating).toString();
                    if (!desc    && igdb.summary)             desc    = igdb.summary;
                }
            } catch(e) {}

            const descI18n = await fetchDescI18n(appId, desc);
            db.prepare("UPDATE games SET GENRE=?,RELEASED=?,METACRITIC=?,DEV=?,PUB=?,Description=?,Description_i18n=?,SteamAppID=?,Coop=?,NumPlayers=?,HLTB_Main=?,ProtonTier=?,SimilarGames=?,Franchise=? WHERE Game=?")
              .run(genre, release, meta, dev, pub, desc, descI18n, appId, coop, players, hltb, proton, similar, franchise, gameName);
            overallSuccess = true;
        }

        return overallSuccess;
    } catch(err) { return false; }
});

ipcMain.handle('search-youtube', async (event, gameName) => { const query = `${gameName} gameplay trailer no commentary`; return new Promise((resolve) => { const args = [ '--config-location', ytDlpConfigPath, `ytsearch5:${query}`, '--print', '%(id)s|%(thumbnail)s|%(title)s' ]; execFile(ytDlpPath, args, (error, stdout, stderr) => { if (error || !stdout) resolve([]); else { const lines = stdout.split('\n').filter(l => l.trim() !== ""); const results = lines.map(line => { const parts = line.split('|'); return { id: parts[0], thumbnail: parts[1], title: parts.slice(2).join('|') }; }); resolve(results); } }); }); });

// Downloads trailer using the new beautiful naming convention

ipcMain.handle('get-audio-config', () => {
    try {
        if (fs.existsSync(audioCfgPath)) return JSON.parse(fs.readFileSync(audioCfgPath, 'utf8'));
    } catch(e){}
    return { bgm: true, sfx: true, vol: 0.3, bgm_mode: "AMBIENT", theme: "Couch (DEFAULT)", screensaver: "SCREENSHOTS", screensaverDelay: 3, gamepadLayout: "XBOX", wakeMethod: "START + SELECT" };
});

ipcMain.on('save-audio-config', (e, cfg) => { try { fs.writeFileSync(audioCfgPath, JSON.stringify(cfg)); } catch(err){} });
ipcMain.handle('get-custom-music', () => { let playlist = []; try { if (fs.existsSync(musicDir)) { const files = fs.readdirSync(musicDir); for (let f of files) { if (f.toLowerCase().endsWith('.mp3') || f.toLowerCase().endsWith('.wav') || f.toLowerCase().endsWith('.ogg') || f.toLowerCase().endsWith('.flac')) { playlist.push(`file://${path.join(musicDir, f)}`); } } } } catch(e) {} return playlist; });
ipcMain.handle('get-standard-bgm', (event, mode) => { const safeName = mode.toLowerCase().replace(/-/g, ''); for (let ext of ['wav', 'mp3', 'ogg']) { const p = path.join(soundsDir, `bgm_${safeName}.${ext}`); if (fs.existsSync(p)) return `file://${p}`; } return null; });

ipcMain.handle('get-audio-metadata', async (e, filePath) => {
    try {
        const cleanPath = filePath.replace('file://', '');
        const metadata = await mm.parseFile(cleanPath);
        let cover = null;
        if (metadata.common.picture && metadata.common.picture.length > 0) {
            const pic = metadata.common.picture[0];
            cover = `data:${pic.format};base64,${pic.data.toString('base64')}`;
        }
        return { title: metadata.common.title || path.basename(cleanPath), artist: metadata.common.artist || "Unknown Artist", cover: cover };
    } catch(err) { return { title: path.basename(filePath), artist: "Unknown Artist", cover: null }; }
});

ipcMain.handle('get-music-library', async () => {
    let library = [];
    try {
        if (fs.existsSync(musicDir)) {
            const files = fs.readdirSync(musicDir);
            for (let f of files) {
                if (f.match(/\.(mp3|wav|ogg|flac)$/i)) {
                    const p = path.join(musicDir, f);
                    try {
                        const meta = await mm.parseFile(p);
                        library.push({ path: `file://${p}`, title: meta.common.title || f, artist: meta.common.artist || 'Unknown Artist', album: meta.common.album || 'Unknown Album' });
                    } catch(e) { library.push({ path: `file://${p}`, title: f, artist: 'Unknown Artist', album: 'Unknown Album' }); }
                }
            }
        }
    } catch(e) {}
    return library;
});

ipcMain.handle('get-playlists', () => { try { if (fs.existsSync(playlistsPath)) return JSON.parse(fs.readFileSync(playlistsPath, 'utf8')); } catch(e){} return {}; });
ipcMain.on('save-playlists', (e, pl) => { try { fs.writeFileSync(playlistsPath, JSON.stringify(pl)); } catch(err){} });

// ── GAME PLAYLISTS (shared games.db, same tables as The Manager) ───────────────
// NOTE: the channel above (get-playlists) belongs to the JUKEBOX's music playlists.
// Game playlists are a different feature stored in games.db, so they use their own
// channel names that mirror The Manager's handlers, except the list-all channel,
// renamed to 'get-game-playlist-list' to avoid colliding with the jukebox one.
ipcMain.handle('get-game-playlist-list', () => {
    if (!db) return [];
    try { return db.prepare('SELECT * FROM playlists ORDER BY name').all(); } catch(e) { return []; }
});
ipcMain.handle('get-playlist-games', (_, playlistId) => {
    // Smart playlists resolve their rule (genre, store, installed…) instead of reading a
    // stored member list, same helper the Manager uses, so both faces agree on members.
    try { return _smart.playlistGames(db, playlistId); } catch(e) { return []; }
});
ipcMain.handle('get-game-playlists', (_, gameId) => {
    if (!db) return [];
    try { return db.prepare('SELECT playlist_id FROM playlist_games WHERE game_id=?').all(gameId).map(r => r.playlist_id); } catch(e) { return []; }
});
ipcMain.handle('add-playlist', (_, name) => {
    if (!db || !name || !String(name).trim()) return null;
    try { return db.prepare('INSERT INTO playlists (name) VALUES (?)').run(String(name).trim()).lastInsertRowid; } catch(e) { return null; }
});
ipcMain.handle('delete-playlist', (_, id) => {
    if (!db) return false;
    try { db.prepare('DELETE FROM playlist_games WHERE playlist_id=?').run(id); db.prepare('DELETE FROM playlists WHERE id=?').run(id); return true; } catch(e) { return false; }
});
ipcMain.handle('add-game-to-playlist', (_, playlistId, gameId) => {
    if (!db) return { ok: false };
    try {
        const max = db.prepare('SELECT MAX(sort_order) AS m FROM playlist_games WHERE playlist_id=?').get(playlistId);
        const order = (max && max.m != null ? max.m : -1) + 1;
        db.prepare('INSERT INTO playlist_games (playlist_id, game_id, sort_order) VALUES (?, ?, ?)').run(playlistId, gameId, order);
        return { ok: true };
    } catch { return { ok: false, error: 'Already in playlist' }; }
});
ipcMain.handle('remove-game-from-playlist', (_, playlistId, gameId) => {
    if (!db) return false;
    try { db.prepare('DELETE FROM playlist_games WHERE playlist_id=? AND game_id=?').run(playlistId, gameId); return true; } catch(e) { return false; }
});

// ── Installer headless install/uninstall ────────────────────────────────────────
const installerProgressFile = path.join(configDir, 'installer-progress.json');
let _headlessProc = null;

function getInstallerDbPath() {
    return host.findInstallerDb(baseDir);
}

/*
 * Whether the stores are signed in, REPORTED, never offered.
 *
 * ⚠️ Couch does not and must not have a store login: it is a gamepad UI on a television, and
 * a device-code flow with a browser and a password field has no business there. But it does
 * need to be able to say *why* an install cannot start, because "Size info unavailable" for a
 * signed-out account is the least useful sentence in the app. It was the oldest open bug in
 * the project. Reading the status is not offering a login.
 */
ipcMain.handle('couch-store-auth', async () => {
    if (!ensureInstallerEngine()) return { gog: false, epic: false, engine: false };
    // ⚠️ Both are async, read synchronously they return a Promise, which is truthy without
    // `.loggedIn`, so every account came back signed out.
    let gog = false, epic = false;
    try { gog = !!(await installerEngine.gogStatus())?.loggedIn; } catch {}
    try { epic = !!(await installerEngine.epicStatus())?.loggedIn; } catch {}
    return { gog, epic, engine: true };
});

ipcMain.handle('installer-get-default-install-dir', () => {
    const gDbPath = getInstallerDbPath();
    if (!gDbPath) return null;
    try { const gdb = new Database(gDbPath, { readonly: true }); const row = gdb.prepare("SELECT value FROM settings WHERE key='default_install_dir'").get(); gdb.close(); return row?.value || null; } catch { return null; }
});

ipcMain.handle('open-installer-gui', (_, searchTerm) => {
    spawnInstallerFace(searchTerm ? ['search', searchTerm] : [], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
});

// Pre-install: free disk space at a path + download/disk size for a GOG/Epic title (shared engine).
ipcMain.handle('get-disk-space', (_, p) => installerEngine.getDiskSpace(p));
ipcMain.handle('get-install-size', async (_, gid) => {
    if (!ensureInstallerEngine()) return null;
    const m = String(gid || '').match(/^(gog|epic)_(.+)$/i); if (!m) return null;
    const store = m[1].toLowerCase(), appId = m[2];
    if (store === 'gog') {
        let platform = null;
        try { platform = _installerEngineDb.prepare("SELECT platform FROM games WHERE app_id=? AND store=?").get(appId, store)?.platform; } catch {}
        return installerEngine.gogInstallInfo(appId, platform || 'linux');
    }
    return installerEngine.epicInstallInfo(appId);
});

ipcMain.handle('installer-headless-install', (_, store, appId, platform, installDir) => {
    if (_headlessProc) return { ok: false, error: 'Install already in progress.' };
    const args = ['install', store, appId];
    if (platform) args.push(platform);
    if (installDir) args.push(installDir);
    _headlessProc = spawnInstallerFace(args, { detached: false, stdio: 'ignore' });
    _headlessProc.on('close', () => { _headlessProc = null; _installerMap = null; }); // refresh map on completion
    return { ok: true };
});

ipcMain.handle('installer-headless-uninstall', (_, store, appId) => {
    if (_headlessProc) return { ok: false, error: 'Operation already in progress.' };
    _headlessProc = spawnInstallerFace(['uninstall-headless', store, appId], { detached: false, stdio: 'ignore' });
    _headlessProc.on('close', () => { _headlessProc = null; _installerMap = null; });
    return { ok: true };
});

ipcMain.handle('installer-get-progress', () => {
    try { return JSON.parse(fs.readFileSync(installerProgressFile, 'utf8')); } catch { return null; }
});

ipcMain.handle('installer-cancel-headless', () => {
    if (_headlessProc) { try { _headlessProc.kill('SIGTERM'); } catch {} _headlessProc = null; }
    try { fs.unlinkSync(installerProgressFile); } catch {}
    return { ok: true };
});

// ── FLATPAK ────────────────────────────────────────────────────────────────

// ── PICO-8 ────────────────────────────────────────────────────────────────

function humanizeCartName(filename) {
    let name = filename.replace(/\.p8\.png$/, '').replace(/\.p8$/, '');
    name = name.replace(/_\d+$/, '');
    name = name.replace(/[_-]+/g, ' ').trim();
    return name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || filename;
}

function _getPico8Bin() {
    const row = db.prepare("SELECT value FROM settings WHERE key='pico8_path'").get();
    if (row?.value && fs.existsSync(row.value)) return row.value;
    const pico8Dir = path.join(baseDir, 'GameManagerConfig', 'pico8');
    for (const n of ['pico8', 'pico8_dyn', 'pico8_64']) {
        const p = path.join(pico8Dir, n);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

ipcMain.handle('scan-pico8', () => {
    if (!db) return { count: 0 };
    const cartsDir = path.join(baseDir, 'GameManagerConfig', 'pico8', 'carts');
    const imagesDir = path.join(baseDir, 'GameManagerConfig', 'images');
    try { fs.mkdirSync(cartsDir, { recursive: true }); } catch {}
    let files;
    try { files = fs.readdirSync(cartsDir); } catch { return { count: 0 }; }

    const found = new Set();

    const setCartCover = (rowId, cartPath) => {
        try {
            const coverFile = `${rowId}_p8_cover.png`;
            fs.copyFileSync(cartPath, path.join(imagesDir, coverFile));
            db.prepare("UPDATE games SET CoverArt=? WHERE id=?").run(`GameManagerConfig/images/${coverFile}`, rowId);
        } catch {}
    };

    for (const file of files) {
        const hasPng = file.endsWith('.p8.png');
        const hasP8  = !hasPng && file.endsWith('.p8');
        if (!hasPng && !hasP8) continue;
        const cartPath = path.join(cartsDir, file);
        const launchCmd = `pico8-cart:${cartPath}`;
        found.add(launchCmd);
        const name = humanizeCartName(file);
        const row = db.prepare("SELECT id, Store, CoverArt FROM games WHERE LaunchCommand = ?").get(launchCmd);
        if (row) {
            const stores = (row.Store || '').split(',').map(s => s.trim());
            if (!stores.some(s => s.toLowerCase() === 'pico-8'))
                db.prepare("UPDATE games SET Store=?, Installed=1 WHERE id=?").run([...stores, 'PICO-8'].join(', '), row.id);
            else
                db.prepare("UPDATE games SET Installed=1 WHERE id=?").run(row.id);
            if (!row.CoverArt && hasPng) setCartCover(row.id, cartPath);
        } else {
            const info = db.prepare("INSERT INTO games (Game,Store,LaunchCommand,Installed) VALUES (?,?,?,1)").run(name, 'PICO-8', launchCmd);
            if (hasPng) setCartCover(info.lastInsertRowid, cartPath);
        }
    }

    const all = db.prepare("SELECT id, LaunchCommand FROM games WHERE LaunchCommand LIKE 'pico8-cart:%'").all();
    for (const row of all) {
        if (!found.has(row.LaunchCommand)) db.prepare("DELETE FROM games WHERE id=?").run(row.id);
    }
    return { count: found.size };
});

// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('save-flatpak-art', (e, gameId, coverB64, heroB64, iconSrcPath) => {
    const ts = Date.now();
    const coverFile = `${gameId}_fp_cover_${ts}.png`;
    const heroFile  = `${gameId}_fp_hero_${ts}.png`;
    fs.writeFileSync(path.join(imagesDir, coverFile), Buffer.from(coverB64, 'base64'));
    fs.writeFileSync(path.join(imagesDir, heroFile),  Buffer.from(heroB64,  'base64'));
    const coverPath = `GameManagerConfig/images/${coverFile}`;
    const heroPath  = `GameManagerConfig/images/${heroFile}`;
    let logoPath = '';
    if (iconSrcPath && fs.existsSync(iconSrcPath)) {
        const ext = path.extname(iconSrcPath);
        const logoFile = `${gameId}_fp_logo_${ts}${ext}`;
        fs.copyFileSync(iconSrcPath, path.join(imagesDir, logoFile));
        logoPath = `GameManagerConfig/images/${logoFile}`;
    }
    db.prepare('UPDATE games SET CoverArt=?, HeroArt=?, Logo=?, Icon=? WHERE id=?')
      .run(coverPath, heroPath, logoPath, logoPath, gameId);
    return true;
});
