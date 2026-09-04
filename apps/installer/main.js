'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { spawn, execSync } = require('child_process');
const Database = require('better-sqlite3');

// Shared window-free Installer engine. Leaf helpers are re-bound here so existing
// call sites in this file keep working unchanged; engine.init() runs in initDb().
const installerEngine = require('../../packages/core/installer-engine.js');
const host = require('../../packages/core/platform/index.js');
const {
    sanitizeLogName, expandTilde, resolvePathCaseInsensitive,
    which, findLegendary, findGogdl, findComet, findUmu, findWineCached, findRuntime,
    scanProtonVersions,
    GOG_CLIENT_ID, GOG_CLIENT_SECRET, GOG_REDIRECT_URI,
    syncSharedDb, headlessInstall, headlessUninstall, launchGame, runLegendary,
    getGameInstallInfo, runRedist, injectGogRegistry, gogFetch, getGogToken,
    writeGogAuthConfig, findGogInstallResult, findLinuxGameExe,
} = installerEngine;

// Installer face keeps its own identity even inside the unified suite:
//  - userData is ~/.config/clarity-installer  → its own data dir + the Clarity↔Installer DB bridge
//  - independent single-instance lock  → Installer GUI can open alongside the Manager window
app.setName('clarity-installer');

// ── Paths ─────────────────────────────────────────────────────────────────────
const configDir = app.isPackaged
    ? app.getPath('userData')          // ~/.config/clarity-installer on Linux (Electron uses the app name verbatim)
    : path.join(__dirname, 'InstallerConfig');

const prefixesDir = path.join(configDir, 'prefixes');
const logDir      = path.join(configDir, 'game_logs');

// Directory containing the AppImage (same folder as Clarity.AppImage)
const appImageDir  = host.portableBaseDir({ devDir: configDir });
const progressFile = path.join(appImageDir, 'GameManagerConfig', 'installer-progress.json');

// Installer's own db normally lives at configDir/library.db, its dedicated identity (see the
// comment above), and findInstallerDb's own candidate list already includes that exact path
// first. But if a library.db with real data already exists at one of the OTHER candidates
// (most likely the shared suite's own baseDir/InstallerConfig, from an install or sync that ran
// against it before this dedicated path ever got created, e.g. dev-mode testing, or the
// Manager face running before Installer's own packaged path existed), use that instead of
// silently creating another, empty library.db right next to it. Two live, disagreeing
// databases for the same suite is exactly the split that made "Play" fail with a real, correct
// InstallerGameId that simply wasn't in *this* file. Falls back to the original dedicated path
// when nothing exists anywhere yet (the normal fresh-install case, unchanged from before).
const dbPath = host.findInstallerDb(appImageDir) || path.join(configDir, 'library.db');


let db;
let win;

// ── CLI mode detection ────────────────────────────────────────────────────────
const allArgs        = process.argv;
const launchIdx      = allArgs.indexOf('launch');
const cliGameId      = launchIdx !== -1 ? allArgs[launchIdx + 1] : null;
const cliMode        = !!cliGameId;
const searchIdx      = allArgs.indexOf('search');
const cliSearch      = searchIdx !== -1 ? allArgs.slice(searchIdx + 1).join(' ') : null;
const setupIdx       = allArgs.indexOf('setup');
const cliSetupId     = setupIdx  !== -1 ? allArgs[setupIdx  + 1] : null;
const cliStorage     = allArgs.indexOf('storage') !== -1;  // opened from CN "Manage Storage" → installed games, sorted by size
const installHIdx    = allArgs.indexOf('install');
const cliInstall     = installHIdx !== -1 ? allArgs.slice(installHIdx + 1) : null;
const uninstHIdx     = allArgs.indexOf('uninstall-headless');
const cliUninstall   = uninstHIdx  !== -1 ? allArgs.slice(uninstHIdx  + 1) : null;
const headlessInstMode = !!(cliInstall || cliUninstall);

// ── Headless progress file ────────────────────────────────────────────────────
function writeProgress(data) {
    try { fs.writeFileSync(progressFile, JSON.stringify(data), 'utf8'); } catch {}
}

// [engine] GOG consts + install/launch/auth functions moved to packages/core/installer-engine.js



// ── Database ──────────────────────────────────────────────────────────────────
function initDb() {
    fs.mkdirSync(configDir,  { recursive: true });
    fs.mkdirSync(prefixesDir, { recursive: true });

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Wire the shared engine now that paths + DB handle are available.
    installerEngine.init({ configDir, prefixesDir, logDir, binDir, appImageDir, homeDir: HOME, db, onProgress: writeProgress });

    db.exec(`
        CREATE TABLE IF NOT EXISTS games (
            id           TEXT PRIMARY KEY,
            title        TEXT NOT NULL,
            store        TEXT NOT NULL DEFAULT 'custom',
            app_id       TEXT,
            install_path TEXT,
            executable   TEXT,
            prefix_path  TEXT,
            proton_path  TEXT,
            installed    INTEGER DEFAULT 0,
            version      TEXT,
            notes        TEXT,
            added_at     INTEGER DEFAULT (strftime('%s','now'))
        );
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        );
    `);
    // Migrations
    try { db.prepare("ALTER TABLE games ADD COLUMN platform TEXT").run(); } catch(e) {}
    try { db.prepare("ALTER TABLE games ADD COLUMN platforms TEXT").run(); } catch(e) {}
    try { db.prepare("ALTER TABLE games ADD COLUMN custom_env TEXT").run(); } catch(e) {}
    try { db.prepare("ALTER TABLE games ADD COLUMN winetricks TEXT").run(); } catch(e) {}
    try { db.prepare("ALTER TABLE games ADD COLUMN use_esync INTEGER DEFAULT 1").run(); } catch(e) {}
    try { db.prepare("ALTER TABLE games ADD COLUMN use_fsync INTEGER DEFAULT 1").run(); } catch(e) {}
    try { db.prepare("ALTER TABLE games ADD COLUMN use_dxvk_nvapi INTEGER DEFAULT 0").run(); } catch(e) {}
    try { db.prepare("ALTER TABLE games ADD COLUMN use_battleye INTEGER DEFAULT 0").run(); } catch(e) {}
    try { db.prepare("ALTER TABLE games ADD COLUMN use_eac INTEGER DEFAULT 0").run(); } catch(e) {}
    try { db.prepare("ALTER TABLE games ADD COLUMN launch_target TEXT").run(); } catch(e) {}
    try { db.prepare("ALTER TABLE games ADD COLUMN launch_args TEXT").run(); } catch(e) {}
    try { db.prepare("ALTER TABLE games ADD COLUMN is_dlc INTEGER DEFAULT 0").run(); } catch(e) {}
    try { db.prepare("ALTER TABLE games ADD COLUMN custom_exe TEXT").run(); } catch(e) {}
    try { db.exec(`CREATE TABLE IF NOT EXISTS achievements (
        app_id         TEXT NOT NULL,
        key            TEXT NOT NULL,
        name           TEXT,
        description    TEXT,
        image_locked   TEXT,
        image_unlocked TEXT,
        date_unlocked  TEXT,
        visible        INTEGER DEFAULT 1,
        PRIMARY KEY (app_id, key)
    )`); } catch(e) {}
}

// ── Proton scanner ────────────────────────────────────────────────────────────
const HOME = os.homedir();

// Proton discovery (PROTON_DIRS + scanProtonVersions) now lives in packages/core/installer-engine.js
// so the Manager and Couch resolve exactly the same builds this face lists; `scanProtonVersions`
// is re-bound from the engine at the top of this file.

// Expand ~ to HOME so spawn() (which doesn't use a shell) gets real paths
// ── Bundled binary paths ──────────────────────────────────────────────────────
// In a packaged build, extraResources land in process.resourcesPath/assets/bin/<host>.
// In dev, they live in __dirname/assets/bin/<host>.
const binDir = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'assets', 'bin', host.binDirName);

// expandTilde, resolvePathCaseInsensitive, which, find* and findRuntime now live
// in packages/core/installer-engine.js (re-bound at the top of this file).


// ── Launch engine ─────────────────────────────────────────────────────────────

// ── Window ────────────────────────────────────────────────────────────────────

// ── App lifecycle ─────────────────────────────────────────────────────────────
if (cliMode) {
    // Headless CLI: launch game and exit
    app.disableHardwareAcceleration();
    app.whenReady().then(() => {
        initDb();
        launchGame(cliGameId)
            .then(r  => { console.log(`Installer: launched via ${r.method}`); setTimeout(() => app.quit(), 300); })
            .catch(e => { console.error('Installer error:', e.message); app.quit(); });
    });
} else if (headlessInstMode) {
    // Headless install/uninstall mode, no window, writes progress to installer-progress.json
    app.disableHardwareAcceleration();
    app.whenReady().then(async () => {
        initDb();
        try {
            if (cliInstall)    await headlessInstall(cliInstall[0], cliInstall[1], cliInstall[2], cliInstall[3]);
            else               await headlessUninstall(cliUninstall[0], cliUninstall[1]);
        } catch (e) {
            writeProgress({ step: 'error', message: e.message, done: true });
        }
        setTimeout(() => app.quit(), 500);
    });
} else {
    // ⚠️ Installer has no GUI as of Phase 2B. Its setup modal and storage view live in
    // the Manager now, so a bare `installer` invocation has nothing to show. The CLI
    // paths above, launch, install, uninstall-headless, are the whole face, and the
    // `installer://launch/…` scheme every installed game carries still routes here.
    console.error('Installer is headless: use `installer launch <id>`, `installer install …` or `installer uninstall-headless …`.');
    app.whenReady().then(() => app.quit());
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.on('window-minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
ipcMain.on('window-maximize', () => {
    const w = BrowserWindow.getFocusedWindow();
    if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
});
ipcMain.on('window-close',    () => BrowserWindow.getFocusedWindow()?.close());

// Games
ipcMain.handle('get-games', () => db.prepare('SELECT * FROM games ORDER BY title COLLATE NOCASE').all());

ipcMain.handle('add-game', (_, data) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    db.prepare(`
        INSERT INTO games (id, title, store, app_id, install_path, executable, prefix_path, proton_path, installed, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.title || 'Unnamed', data.store || 'custom', data.app_id || null,
           data.install_path || null, data.executable || null,
           data.prefix_path || null, data.proton_path || null,
           data.installed ? 1 : 0, data.notes || null);
    return id;
});

ipcMain.handle('update-game', (_, id, data) => {
    const allowed = ['title','store','app_id','install_path','executable','prefix_path','proton_path','installed','version','notes','platform','platforms','custom_env','winetricks','use_esync','use_fsync','use_dxvk_nvapi','use_battleye','use_eac','launch_target','launch_task_index','launch_args','custom_exe'];
    const entries = Object.entries(data).filter(([k]) => allowed.includes(k));
    if (!entries.length) return false;
    const set = entries.map(([k]) => `${k}=?`).join(', ');
    const vals = entries.map(([,v]) => v);
    db.prepare(`UPDATE games SET ${set} WHERE id=?`).run(...vals, id);
    // Propagate install-state changes (e.g. GUI install completion) to the shared Clarity games.db
    if (Object.prototype.hasOwnProperty.call(data, 'installed')) {
        try { const g = db.prepare("SELECT app_id FROM games WHERE id=?").get(id); if (g?.app_id) syncSharedDb(g.app_id, data.installed ? 1 : 0); } catch {}
    }
    return true;
});

ipcMain.handle('delete-game', (_, id) => { db.prepare('DELETE FROM games WHERE id=?').run(id); return true; });

ipcMain.handle('uninstall-game-files', async (_, id) => {
    const game = db.prepare('SELECT * FROM games WHERE id=?').get(id);
    if (!game) return { ok: false, error: 'Game not found.' };

    const errors = [];

    const installPath = expandTilde(game.install_path || '');
    // Both the configured install folder and the built-in default count as valid bases: the
    // folder is user-changeable, so games installed under the previous one must stay removable.
    const bases = [
        db.prepare("SELECT value FROM settings WHERE key='default_install_dir'").get()?.value,
        path.join(HOME, 'Games', 'Clarity'),
    ].filter(Boolean).map(expandTilde);

    // Safety guard: never delete a base install directory or any ancestor of one.
    // A valid game path must be at least one level deeper than its base.
    const isSafe = installPath &&
        installPath !== HOME &&
        installPath !== '/' &&
        bases.some(b => installPath !== b && installPath.startsWith(b + path.sep));

    if (installPath && fs.existsSync(installPath)) {
        if (!isSafe) {
            errors.push(`Refusing to delete "${installPath}", looks like a base directory, not a game folder. Remove files manually.`);
        } else {
            try { fs.rmSync(installPath, { recursive: true, force: true }); }
            catch (e) { errors.push(`Game files: ${e.message}`); }
        }
    }

    const prefixPath = installerEngine.prefixPathForGame(game);
    if (fs.existsSync(prefixPath)) {
        try { fs.rmSync(prefixPath, { recursive: true, force: true }); }
        catch (e) { errors.push(`Prefix: ${e.message}`); }
    }

    // For Epic games, also tell legendary to remove its own install record
    if (game.store === 'epic' && game.app_id) {
        const leg = findLegendary();
        if (leg) await new Promise(resolve => {
            const proc = spawn(leg, ['uninstall', game.app_id, '-y'], { stdio: 'ignore' });
            proc.on('close', resolve);
            proc.on('error', resolve);
        });
    }

    db.prepare("UPDATE games SET installed=0, install_path=NULL, executable=NULL, version=NULL WHERE id=?").run(id);
    if (game.app_id) syncSharedDb(game.app_id, false);   // reflect uninstall in the shared Clarity games.db

    return errors.length ? { ok: false, error: errors.join('; ') } : { ok: true };
});

function appendGameLog(game, method, error) {
    try {
        fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, sanitizeLogName(game.title) + '.md');
        const ts = new Date().toLocaleString('sv-SE').replace('T', ' ');
        const existed = fs.existsSync(logPath);
        let header = '';
        if (!existed) {
            header = `# Game Launch Log: ${game.title}\n\n`;
        }
        const entry = [
            `## ${ts}`,
            ``,
            `| Field | Value |`,
            `|---|---|`,
            `| Store | ${game.store || '-'} |`,
            `| App ID | ${game.app_id || '-'} |`,
            `| Method | ${method || '-'} |`,
            `| Executable | \`${game.executable || '-'}\` |`,
            `| Install Path | \`${game.install_path || '-'}\` |`,
            `| Proton | \`${game.proton_path || '(default)'}\` |`,
            `| Prefix | \`${game.prefix_path || '(auto)'}\` |`,
            `| Status | ${error ? `**ERROR**: ${error}` : '**OK**'} |`,
            ``,
        ].join('\n');
        fs.appendFileSync(logPath, header + entry + '\n');
    } catch {}
}

ipcMain.handle('launch-game', async (_, gameId) => {
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
    try {
        const result = await launchGame(gameId);
        if (game) appendGameLog(game, result.method, null);
        return result;
    } catch (e) {
        if (game) appendGameLog(game, null, e.message);
        return { ok: false, error: e.message };
    }
});

// "Play with Log", verbose launch that streams the game's stdout/stderr live to the renderer
// (for troubleshooting problematic titles). The game itself is spawned detached exactly like a
// normal launch; only its output is piped here.
const _logWatched = new Set();   // game ids whose log modal is currently open
ipcMain.handle('launch-game-verbose', async (event, gameId) => {
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
    _logWatched.add(gameId);
    // Once the user closes the modal we stop forwarding: a chatty Proton title would otherwise
    // push tens of thousands of IPC messages at a renderer that just discards them.
    const onOutput = line => {
        if (!_logWatched.has(gameId)) return;
        try { event.sender.send('game-log-line', { id: gameId, line: String(line) }); } catch {}
    };
    try {
        const result = await launchGame(gameId, { onOutput });
        if (game) appendGameLog(game, result.method, null);
        return result;
    } catch (e) {
        onOutput(`[launch error] ${e.message}`);
        if (game) appendGameLog(game, null, e.message);
        return { ok: false, error: e.message };
    }
});
ipcMain.handle('stop-game-log', (_, gameId) => { _logWatched.delete(gameId); return true; });

// Settings
ipcMain.handle('get-setting', (_, key) => db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value ?? null);
ipcMain.handle('set-setting', (_, key, value) => { db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run(key, value); return true; });

const installLogPath = path.join(configDir, 'installLog.json');
ipcMain.handle('get-install-log', () => {
    try { return JSON.parse(fs.readFileSync(installLogPath, 'utf8')); } catch { return []; }
});
ipcMain.handle('save-install-log', (_, entries) => {
    try { fs.writeFileSync(installLogPath, JSON.stringify(entries), 'utf8'); return true; } catch { return false; }
});

// Read the active theme name from Clarity's settings DB so Installer can match its appearance
ipcMain.handle('get-clarity-theme', () => {
    const clarityDb = path.join(appImageDir, 'GameManagerConfig', 'games.db');
    if (!fs.existsSync(clarityDb)) return null;
    try {
        const db2 = new Database(clarityDb, { readonly: true });
        const row = db2.prepare("SELECT value FROM settings WHERE key='clarity_theme'").get();
        db2.close();
        return row?.value || null;
    } catch { return null; }
});

// Installer follows the Manager's interface font (games.db setting ui_font).
ipcMain.handle('get-ui-font', () => {
    const clarityDb = path.join(appImageDir, 'GameManagerConfig', 'games.db');
    if (!fs.existsSync(clarityDb)) return null;
    try {
        const db2 = new Database(clarityDb, { readonly: true });
        const row = db2.prepare("SELECT value FROM settings WHERE key='ui_font'").get();
        db2.close();
        return row?.value || null;
    } catch { return null; }
});

// Environment checks
ipcMain.handle('check-tools', () => {
    const leg   = findLegendary();
    const gogdl = findGogdl();
    // legendary and gogdl ship with the suite and are the same everywhere. The rest are the
    // host's runner stack; `runtimeTools` is the shape the panel should move to, while the
    // flat keys keep today's UI working untouched.
    const tools = host.runtime.tools();
    const byKey = Object.fromEntries(tools.map(t => [t.key, t.path]));
    return {
        legendary:         leg,
        legendary_bundled: leg === path.join(binDir, 'legendary'),
        gogdl:             gogdl,
        gogdl_bundled:     gogdl === path.join(binDir, 'gogdl'),
        runtimeTools:      tools,
        canInstallRunner:  host.runtime.canInstallRunner,
        ...byKey,
    };
});

ipcMain.handle('open-path', (_, p) => shell.openPath(p));

// Pre-install size info for GOG games
// Windows: use gogdl info (depot-based, returns precise sizes)
// Linux:   use GOG API directly (installer files; gogdl's linux manager doesn't expose size)
ipcMain.handle('gog-install-info', async (_, appId, platform) => {
    if (platform === 'linux') {
        // GOG API: sum all Linux installer file sizes
        try {
            const token = await getGogToken();
            if (!token) return null;
            const data = await gogFetch(
                `https://api.gog.com/products/${appId}?expand=downloads`, token
            );
            const installers = (data.downloads?.installers || []).filter(i => i.os === 'linux');
            let download_size = 0;
            for (const inst of installers) {
                for (const file of inst.files || []) download_size += file.size || 0;
            }
            return download_size > 0 ? { download_size, disk_size: download_size } : null;
        } catch { return null; }
    }

    // Windows: use gogdl info for depot-based size breakdown
    const gogdl = findGogdl();
    if (!gogdl) return null;
    try { fs.chmodSync(gogdl, '755'); } catch {}
    const authPath = writeGogAuthConfig();
    return new Promise(resolve => {
        let out = '';
        const proc = spawn(gogdl, [
            '--auth-config-path', authPath,
            'info', appId, '--platform', platform,
        ], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GOGDL_CONFIG_PATH: configDir } });
        proc.stdout.on('data', d => out += d);
        proc.stderr.on('data', d => out += d);
        proc.on('close', () => {
            try { fs.unlinkSync(authPath); } catch {}
            try {
                const jsonLine = out.split('\n').find(l => l.trim().startsWith('{'));
                const data = JSON.parse(jsonLine);
                let download_size = 0, disk_size = 0;
                for (const s of Object.values(data.size || {})) {
                    download_size += s.download_size || 0;
                    disk_size     += s.disk_size     || 0;
                }
                resolve({ download_size, disk_size, version: data.versionName });
            } catch { resolve(null); }
        });
        proc.on('error', () => { try { fs.unlinkSync(authPath); } catch {} resolve(null); });
    });
});

// Pre-install size info for Epic games via legendary info
ipcMain.handle('epic-install-info', async (_, appName) => {
    const leg = findLegendary();
    if (!leg) return null;
    return new Promise(resolve => {
        let out = '';
        const proc = spawn(leg, ['info', appName], { stdio: ['ignore', 'pipe', 'pipe'] });
        proc.stdout.on('data', d => out += d);
        proc.stderr.on('data', d => out += d);
        proc.on('close', () => {
            const toBytes = (n, u) => {
                const v = parseFloat(n);
                return u.toLowerCase().startsWith('g') ? v * 1024 ** 3
                     : u.toLowerCase().startsWith('m') ? v * 1024 ** 2
                     : v * 1024;
            };
            const dl   = out.match(/Download size[^:]*:\s*([\d.]+)\s*(\w+)/i);
            const disk = out.match(/Disk size[^:]*:\s*([\d.]+)\s*(\w+)/i);
            resolve(dl && disk ? {
                download_size: toBytes(dl[1], dl[2]),
                disk_size:     toBytes(disk[1], disk[2]),
            } : null);
        });
        proc.on('error', () => resolve(null));
    });
});

// Available disk space at the given path (walks up to find an existing parent)
ipcMain.handle('get-disk-space', async (_, dirPath) => {
    let check = expandTilde(dirPath) || HOME;
    while (!fs.existsSync(check) && path.dirname(check) !== check) check = path.dirname(check);
    try {
        const stats = await fs.promises.statfs(check);
        return stats.bavail * stats.bsize;
    } catch { return null; }
});

ipcMain.handle('verify-installs', async () => {
    const installed = db.prepare("SELECT id, title, store, app_id, install_path FROM games WHERE installed=1").all();
    let reset = 0;
    for (const g of installed) {
        const p = expandTilde(g.install_path || '');
        if (!p || !fs.existsSync(p)) {
            db.prepare("UPDATE games SET installed=0, install_path=NULL, executable=NULL, version=NULL WHERE id=?").run(g.id);
            // Also remove legendary's stale record for Epic games
            if (g.store === 'epic' && g.app_id) {
                const leg = findLegendary();
                if (leg) await new Promise(resolve => {
                    const proc = spawn(leg, ['uninstall', g.app_id, '-y'], { stdio: 'ignore' });
                    proc.on('close', resolve);
                    proc.on('error', resolve);
                });
            }
            reset++;
        }
    }
    return { reset };
});

ipcMain.handle('get-disk-size', (_, dirPath) => {
    const resolved = expandTilde(dirPath);
    if (!resolved || !fs.existsSync(resolved)) return null;
    return new Promise(resolve => {
        const { exec } = require('child_process');
        const size = host.dirSizeHumanCommand(resolved);
        exec(size.cmd, { timeout: 15000 }, (err, stdout) => {
            resolve(err ? null : size.parse(stdout));
        });
    });
});

// Single batch call, returns { id: size } for all installed games at once.
// Avoids N concurrent IPC round-trips which can cause race conditions.
ipcMain.handle('get-all-disk-sizes', () => {
    const { exec } = require('child_process');
    const installed = db.prepare(
        "SELECT id, install_path FROM games WHERE installed=1 AND install_path IS NOT NULL"
    ).all();
    return Promise.all(installed.map(g => {
        const p = expandTilde(g.install_path);
        if (!p || !fs.existsSync(p)) return Promise.resolve({ id: g.id, bytes: null });
        return new Promise(resolve => {
            // -sB1 = summarised disk usage (allocated blocks) in bytes → numeric, sortable.
            const size = host.dirSizeBytesCommand(p);
            exec(size.cmd, { timeout: 15000 }, (err, stdout) => {
                resolve({ id: g.id, bytes: err ? null : size.parse(stdout) });
            });
        });
    }));
});
ipcMain.handle('get-config-dir', () => configDir);
ipcMain.handle('open-config-dir', () => shell.openPath(configDir));

ipcMain.handle('reset-installer', () => {
    if (db) { try { db.close(); } catch(e) {} db = null; }
    try { fs.unlinkSync(dbPath); } catch(e) {}
    try { fs.rmSync(prefixesDir, { recursive: true, force: true }); } catch(e) {}
    try { fs.rmSync(logDir,      { recursive: true, force: true }); } catch(e) {}
    initDb();
    return { ok: true };
});

ipcMain.handle('delete-all-installer-data', () => {
    if (db) { try { db.close(); } catch(e) {} db = null; }
    try { fs.rmSync(configDir, { recursive: true, force: true }); } catch(e) {}
    app.quit();
    return { ok: true };
});

ipcMain.handle('get-game-log', (_, gameId) => {
    const game = db.prepare('SELECT title FROM games WHERE id = ?').get(gameId);
    if (!game) return { exists: false, content: '' };
    const logPath = path.join(logDir, sanitizeLogName(game.title) + '.md');
    if (!fs.existsSync(logPath)) return { exists: false, content: '' };
    return { exists: true, content: fs.readFileSync(logPath, 'utf8') };
});

ipcMain.handle('get-log-index', () => {
    if (!fs.existsSync(logDir)) return [];
    const files = new Set(fs.readdirSync(logDir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)));
    return db.prepare('SELECT id, title FROM games').all()
        .filter(g => files.has(sanitizeLogName(g.title)))
        .map(g => g.id);
});

// Scan an existing game folder to detect store/app_id markers
ipcMain.handle('scan-game-folder', (_, folderPath) => {
    const expanded = expandTilde(folderPath);
    if (!expanded || !fs.existsSync(expanded)) return { ok: false, error: 'Folder not found.' };

    const detected = [];
    let exes = [];

    try {
        const entries = fs.readdirSync(expanded);

        // Top-level executables the user might want to set
        exes = entries.filter(f => /\.(exe|sh|bat)$/i.test(f));

        // GOG: goggame-{numericId}.info files at folder root
        for (const f of entries) {
            const m = f.match(/^goggame-(\d+)\.info$/i);
            if (!m) continue;
            const appId = m[1];
            let title = appId;
            let executable = null;
            try {
                const info = JSON.parse(fs.readFileSync(path.join(expanded, f), 'utf8'));
                title = info.gameTitle || info.gameId || appId;
                const primary = (info.playTasks || []).find(t => t.isPrimary && t.type === 'FileTask');
                if (primary?.path) executable = primary.path.replace(/\\/g, '/');
            } catch {}
            detected.push({ store: 'gog', app_id: appId, title, executable });
        }

        // Epic: .egstore/ directory contains *.item JSON manifests
        const egstoreDir = path.join(expanded, '.egstore');
        if (fs.existsSync(egstoreDir)) {
            try {
                for (const f of fs.readdirSync(egstoreDir)) {
                    if (!f.endsWith('.item')) continue;
                    try {
                        const item = JSON.parse(fs.readFileSync(path.join(egstoreDir, f), 'utf8'));
                        if (item.AppName) {
                            detected.push({
                                store: 'epic',
                                app_id: item.AppName,
                                title: item.DisplayName || item.AppName,
                                executable: item.LaunchExecutable ? item.LaunchExecutable.replace(/\\/g, '/') : null,
                            });
                        }
                    } catch {}
                }
            } catch {}
        }
    } catch (e) {
        return { ok: false, error: e.message };
    }

    return { ok: true, detected, exes };
});

// Proton
ipcMain.handle('scan-proton', () => scanProtonVersions());

// Only ever removes something inside a directory the backend installs into.
ipcMain.handle('delete-proton', (_, dirPath) => host.runtime.management.remove(dirPath));

// ── Compatibility-runtime downloader ──────────────────────────────────────────
// The catalogue, the install location and the unpacking all live in the platform backend,
// so this face and the Manager can no longer drift apart on them. They had: this copy took
// the first .tar.gz in a release, and GE-Proton now ships an aarch64 tarball that sorts
// ahead of the x86-64 one, so it was downloading an ARM build onto an x86-64 machine.
ipcMain.handle('get-proton-releases', () => host.runtime.management.listReleases(15));

ipcMain.handle('download-proton', async (event, url, tag) => {
    const send = d => { try { event.sender.send('proton-dl-progress', d); } catch {} };
    return host.runtime.management.install({ release: { url, tag }, onProgress: send });
});

ipcMain.handle('cancel-proton-download', () => { host.runtime.management.cancel(); return { ok: true }; });

// ── Legendary / Epic ──────────────────────────────────────────────────────────


// Check if logged in
ipcMain.handle('legendary-status', async () => {
    const r = await runLegendary(['status']);
    if (!r.ok && r.error) return { ok: false, error: r.error };
    const text = r.stdout + r.stderr;
    const loggedIn = !text.includes('<not logged in>');
    const accountMatch = text.match(/Epic account:\s*(.+)/);
    const gamesMatch   = text.match(/Games available:\s*(\d+)/);
    return {
        ok: true,
        logged_in: loggedIn,
        account:   loggedIn ? (accountMatch?.[1]?.trim() || 'unknown') : null,
        games_available: parseInt(gamesMatch?.[1] || '0'),
    };
});

// Open Epic login window and authenticate legendary
ipcMain.handle('legendary-login', event => {
    // legendary.gl/epiclogin is maintained by the legendary team and always uses
    // the current valid Epic client ID, avoids hardcoding one that can be revoked.
    const AUTH_URL = 'https://legendary.gl/epiclogin';
    const leg = findLegendary();
    if (!leg) return Promise.resolve({ ok: false, error: 'legendary not found' });

    return new Promise(resolve => {
        let resolved = false;

        const authWin = new BrowserWindow({
            width: 560, height: 780, title: 'Login to Epic Games, close when done',
            webPreferences: { nodeIntegration: false, contextIsolation: true },
        });
        authWin.setMenu(null);
        // Force a fresh page load so we always get a new authorization code,
        // not a cached one with an already-expired code.
        authWin.loadURL(AUTH_URL, { extraHeaders: 'Cache-Control: no-cache\nPragma: no-cache\n' });

        const send = d => { try { event.sender.send('legendary-login-progress', String(d)); } catch {} };

        async function tryExtract() {
            if (resolved) return;
            try {
                const text = await authWin.webContents.executeJavaScript('document.body.innerText');

                // Epic returns the code in multiple places, try all of them:
                // 1. redirectUrl query param:  ...?code=<authCode>
                // 2. authorizationCode field (current flow)
                // 3. exchangeCode field (older flow)
                const m = text.match(/"redirectUrl"\s*:\s*"[^"]*[?&]code=([^"&\\s]+)/) ||
                          text.match(/"authorizationCode"\s*:\s*"([^"]+)"/) ||
                          text.match(/"exchangeCode"\s*:\s*"([^"]+)"/);
                if (!m) return;

                resolved = true;
                authWin.close();
                send(`Extracted auth code, running legendary auth...\n`);

                const proc = spawn(leg, ['auth', '--code', m[1]], { stdio: ['ignore', 'pipe', 'pipe'] });
                proc.stdout.on('data', send);
                proc.stderr.on('data', send);
                proc.on('close', exitCode => {
                    if (exitCode !== 0) {
                        // Show legendary's log file so the user can see what went wrong
                        try {
                            const logPath = path.join(host.legendaryConfigDir(), 'logs', 'legendary.log');
                            const log = fs.readFileSync(logPath, 'utf8');
                            const tail = log.split('\n').slice(-25).join('\n');
                            send(`\n--- legendary log (last 25 lines) ---\n${tail}\n`);
                        } catch { send('\n(Could not read legendary log)\n'); }
                    }
                    resolve({ ok: exitCode === 0 });
                });
                proc.on('error', e => resolve({ ok: false, error: e.message }));
            } catch {}
        }

        authWin.webContents.on('did-finish-load',     tryExtract);
        authWin.webContents.on('did-navigate',         tryExtract);
        authWin.webContents.on('did-navigate-in-page', tryExtract);
        setTimeout(tryExtract, 1500);
        authWin.on('closed', () => { if (!resolved) resolve({ ok: false, error: 'Window closed before login completed.' }); });
    });
});

// List all owned Epic games (installed or not via legendary)
ipcMain.handle('legendary-list-owned', async () => {
    const r = await runLegendary(['list', '--json']);
    if (!r.ok && r.error) return { ok: false, error: r.error };
    try {
        const all = JSON.parse(r.stdout);
        return {
            ok: true,
            games: all.map(g => ({
                app_name:     g.app_name,
                title:        g.app_title || g.metadata?.title || 'Unknown',
                is_dlc:       false,
                install_path: null,
                executable:   null,
                version:      null,
            }))
        };
    } catch { return { ok: false, error: 'Failed to parse legendary output.' }; }
});

// List games that legendary itself has installed (subset of owned)
ipcMain.handle('legendary-list-installed', async () => {
    const r = await runLegendary(['list-installed', '--json']);
    if (!r.ok && r.error) return { ok: false, error: r.error };
    try {
        const all = JSON.parse(r.stdout);
        return { ok: true, games: all.filter(g => !g.is_dlc) };
    } catch { return { ok: false, error: 'Failed to parse legendary output.' }; }
});

// ── Game installation ─────────────────────────────────────────────────────────
let activeInstallProc = null;

// Directory picker dialog
ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(win, {
        title: 'Choose Install Directory',
        properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
});

// File picker dialog (for custom exe selection)
ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog(win, {
        title: 'Select Executable',
        properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
});

// Start installing a game via legendary
ipcMain.handle('legendary-install', async (event, appName, installDir) => {
    if (activeInstallProc) return { ok: false, error: 'An installation is already in progress.' };
    const leg = findLegendary();
    if (!leg) return { ok: false, error: 'legendary not found.' };

    const dir = expandTilde(installDir) || path.join(HOME, 'Games', 'Clarity');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}

    // Validate write access before starting
    try { fs.accessSync(dir, fs.constants.W_OK); }
    catch { return { ok: false, error: `No write access to ${dir}` }; }

    const send = d => { try { event.sender.send('install-progress', String(d)); } catch {} };

    // Clear any stale legendary record for this game so it installs fresh
    send(`Clearing any existing legendary records for ${appName}...\n`);
    await new Promise(resolve => {
        const proc = spawn(leg, ['uninstall', appName, '-y'], { stdio: 'ignore' });
        proc.on('close', resolve);
        proc.on('error', resolve);
    });

    return new Promise(resolve => {
        // -y skips interactive prompts; --skip-sdl skips SDL check
        activeInstallProc = spawn(leg, ['install', appName, '--base-path', dir, '-y'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        activeInstallProc.stdout.on('data', send);
        activeInstallProc.stderr.on('data', send);

        activeInstallProc.on('close', async code => {
            activeInstallProc = null;
            if (code === 0) {
                // Get actual install path and executable from legendary
                const info = await getGameInstallInfo(appName);
                resolve({ ok: true, info });
            } else {
                resolve({ ok: false, exitCode: code });
            }
        });
        activeInstallProc.on('error', e => { activeInstallProc = null; resolve({ ok: false, error: e.message }); });
    });
});

// Cancel an in-progress installation
ipcMain.handle('legendary-cancel-install', () => {
    if (!activeInstallProc) return { ok: false };
    activeInstallProc.kill('SIGTERM');
    activeInstallProc = null;
    return { ok: true };
});

// Get install path/exe for a specific game from legendary
ipcMain.handle('legendary-install-info', (_, appName) => getGameInstallInfo(appName));

// Uninstall a game via legendary
ipcMain.handle('legendary-uninstall', (event, appName) => {
    const leg = findLegendary();
    if (!leg) return { ok: false, error: 'legendary not found.' };
    return new Promise(resolve => {
        const proc = spawn(leg, ['uninstall', appName, '-y'], { stdio: ['ignore', 'pipe', 'pipe'] });
        proc.on('close', code => resolve({ ok: code === 0 }));
        proc.on('error', e => resolve({ ok: false, error: e.message }));
    });
});

// Import selected games into Installer DB
ipcMain.handle('legendary-import', (_, games) => {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO games (id, title, store, app_id, install_path, executable, installed, version)
        VALUES (?, ?, 'epic', ?, ?, ?, 0, ?)
    `);
    const tx = db.transaction(list => {
        let n = 0;
        for (const g of list) {
            // installed=0 by default, will be updated when user installs via Installer
        stmt.run('epic_' + g.app_name, g.title, g.app_name,
                     g.install_path || null, g.executable || null, g.version || null);
            n++;
        }
        return n;
    });
    try { return { ok: true, count: tx(games) }; }
    catch (e) { return { ok: false, error: e.message }; }
});


// Returns the computed Wine prefix path for a game (same logic as launchGame)
ipcMain.handle('get-game-prefix', (_, gameId) => {
    const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
    if (!game) return null;
    // Single source of truth (installer-engine); requireExplicitExists keeps the GUI's
    // "return the prefix only if it actually exists" behaviour.
    return installerEngine.prefixPathForGame(game, { requireExplicitExists: true });
});

// Winetricks: detect and run
ipcMain.handle('check-winetricks', () => ({ found: !!which('winetricks') }));

ipcMain.handle('run-winetricks', (event, prefixPath, tricks) => {
    const wt = which('winetricks');
    if (!wt) return { ok: false, error: 'winetricks not found.' };
    const prefix = expandTilde(prefixPath);
    const args = tricks.trim().split(/\s+/).filter(Boolean);
    const sendLine = d => { try { event.sender.send('winetricks-progress', { line: String(d) }); } catch {} };
    const sendDone = (ok, msg) => { try { event.sender.send('winetricks-progress', { done: true, ok, msg }); } catch {} };
    return new Promise(resolve => {
        const proc = spawn(wt, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, WINEPREFIX: prefix, WINEARCH: 'win64' },
        });
        proc.stdout.on('data', sendLine);
        proc.stderr.on('data', sendLine);
        proc.on('close', code => {
            const ok = code === 0;
            sendDone(ok, ok ? 'Winetricks finished.' : `winetricks exited with code ${code}.`);
            resolve({ ok });
        });
        proc.on('error', e => { sendDone(false, e.message); resolve({ ok: false, error: e.message }); });
    });
});

// Standalone redist function, called by both the IPC handler and auto-install after gogdl-install

ipcMain.handle('gogdl-install-redist', async (event, appId, platform, _installPath, prefixPath, protonPath) => {
    return runRedist(event.sender, 'redist-progress', appId, platform, prefixPath, protonPath);
});

// Play tasks from goggame-<id>.info (GOG only), shared with the Manager face's picker.
ipcMain.handle('get-play-tasks', (_, gameId) => installerEngine.gogPlayTasks(gameId));

// Run any .exe / .msi inside the game's Wine prefix (mod installers, tools, etc.)
// Inject GOG game registry entries into a Wine prefix so DLC/tool .exe installers
// can detect the base game (they check HKLM\SOFTWARE\GOG.com\Games\<ID>\path).
// Wine maps Z:\ to the filesystem root, so Linux paths are reachable via Z:\.

// "Run something else in this game's prefix", a config tool, a patcher, a mod installer.
// Both entry points differ only in which folder the file picker opens at; the spawn spec is
// the same one redistributable installers use, so it comes from the platform backend.
async function runExeForGame(gameId, dialogOpts) {
    const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
    if (!game) return { ok: false, error: 'Game not found' };

    const result = await dialog.showOpenDialog(win, {
        filters: [{ name: 'Windows Executables', extensions: ['exe', 'msi', 'bat'] }],
        properties: ['openFile'],
        ...dialogOpts,
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

    const exe    = result.filePaths[0];
    const prefix = installerEngine.prefixPathForGame(game);
    const proton = expandTilde(game.proton_path)
        || db.prepare("SELECT value FROM settings WHERE key='default_proton_path'").get()?.value || '';
    fs.mkdirSync(prefix, { recursive: true });
    await injectGogRegistry(game, prefix, proton);

    if (!host.runtime.canRun(proton)) return { ok: false, error: host.runtime.redistUnavailableMessage };

    // Per-game custom variables sit over the runtime's own, same as a normal launch.
    const customEnv = {};
    for (const line of (game.custom_env || '').split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) customEnv[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }

    const spec = await host.runtime.buildRedistLaunch({ exePath: exe, exeArgs: [], prefix, runtimePath: proton });
    spawn(spec.cmd, spec.args, { env: { ...spec.env, ...customEnv }, detached: true, stdio: 'ignore' }).unref();
    return { ok: true, method: spec.method };
}

ipcMain.handle('run-exe-on-prefix', (_, gameId) =>
    runExeForGame(gameId, { title: 'Select executable to run in game prefix' }));

ipcMain.handle('run-exe-in-game-folder', (_, gameId) => {
    const game = db.prepare('SELECT install_path FROM games WHERE id=?').get(gameId);
    return runExeForGame(gameId, {
        title: 'Select executable in game folder',
        defaultPath: expandTilde(game?.install_path) || undefined,
    });
});

// ── GOG / gogdl ───────────────────────────────────────────────────────────────

const GOG_AUTH_URL      =
    `https://auth.gog.com/auth?client_id=${GOG_CLIENT_ID}` +
    `&layout=client2&redirect_uri=${encodeURIComponent(GOG_REDIRECT_URI)}&response_type=code`;




ipcMain.handle('gog-status', async () => {
    const token = await getGogToken();
    if (!token) return { logged_in: false, gogdl: !!findGogdl() };
    try {
        const user = await gogFetch('https://embed.gog.com/userData.json', token);
        return { logged_in: true, username: user.username, userId: user.userId, gogdl: !!findGogdl() };
    } catch { return { logged_in: false, gogdl: !!findGogdl() }; }
});

ipcMain.handle('gog-login', event => {
    const send = d => { try { event.sender.send('gog-login-progress', String(d)); } catch {} };
    return new Promise(resolve => {
        let resolved = false;
        const authWin = new BrowserWindow({
            width: 600, height: 780, title: 'Login to GOG, close when done',
            webPreferences: { nodeIntegration: false, contextIsolation: true },
        });
        authWin.setMenu(null);
        authWin.loadURL(GOG_AUTH_URL);

        async function tryExtract() {
            if (resolved) return;
            const url   = authWin.webContents.getURL();
            const match = url.match(/[?&]code=([^&\s]+)/);
            if (!match) return;
            resolved = true;
            authWin.close();
            send('Exchanging auth code...\n');
            try {
                const res = await fetch('https://auth.gog.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id:     GOG_CLIENT_ID,
                        client_secret: GOG_CLIENT_SECRET,
                        grant_type:    'authorization_code',
                        code:          match[1],
                        redirect_uri:  GOG_REDIRECT_URI,
                    }).toString(),
                });
                const data = await res.json();
                if (!data.access_token) { resolve({ ok: false, error: `No token: ${JSON.stringify(data)}` }); return; }
                const set = (k, v) => db.prepare("INSERT OR REPLACE INTO settings VALUES (?,?)").run(k, v);
                set('gog_access_token',  data.access_token);
                set('gog_refresh_token', data.refresh_token);
                set('gog_token_expiry',  String(Date.now() + data.expires_in * 1000));
                const user = await gogFetch('https://embed.gog.com/userData.json', data.access_token);
                if (user.userId) set('gog_user_id', String(user.userId));
                send(`✓ Logged in as ${user.username}\n`);
                resolve({ ok: true, username: user.username });
            } catch (e) { resolve({ ok: false, error: e.message }); }
        }

        authWin.webContents.on('did-navigate',         tryExtract);
        authWin.webContents.on('did-navigate-in-page', tryExtract);
        authWin.on('closed', () => { if (!resolved) resolve({ ok: false, error: 'Window closed before login.' }); });
    });
});

ipcMain.handle('gog-logout', () => {
    for (const k of ['gog_access_token', 'gog_refresh_token', 'gog_token_expiry', 'gog_user_id'])
        db.prepare("DELETE FROM settings WHERE key=?").run(k);
    return true;
});

ipcMain.handle('gog-list-owned', async () => {
    const token = await getGogToken();
    if (!token) return { ok: false, error: 'Not logged in to GOG.' };
    try {
        const owned = await gogFetch('https://embed.gog.com/user/data/games', token);
        const ids   = owned.owned || [];
        if (!ids.length) return { ok: true, games: [] };

        const games = [];
        for (let i = 0; i < ids.length; i += 50) {
            const batch = ids.slice(i, i + 50).join(',');
            const data  = await gogFetch(`https://api.gog.com/products?ids=${batch}&expand=downloads`, token);
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
                if (!item?.id) continue;
                const oses      = [...new Set((item.downloads?.installers || []).map(x => x.os).filter(Boolean))];
                const platform  = oses.includes('linux') ? 'linux' : 'windows';
                const platforms = oses.filter(o => o === 'linux' || o === 'windows').join(',') || platform;
                const is_dlc    = item.game_type && item.game_type !== 'game' ? 1 : 0;
                games.push({ id: String(item.id), title: item.title || 'Unknown', platform, platforms, is_dlc });
            }
        }
        return { ok: true, games };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('gog-import', (_, games) => {
    const stmtInsert = db.prepare(
        "INSERT OR IGNORE INTO games (id, title, store, app_id, platform, platforms, installed, is_dlc) VALUES (?, ?, 'gog', ?, ?, ?, 0, ?)"
    );
    // Always update platforms + is_dlc so re-importing refreshes metadata
    const stmtUpdate = db.prepare(
        "UPDATE games SET platforms = ?, is_dlc = ? WHERE app_id = ? AND store = 'gog'"
    );
    const tx = db.transaction(list => {
        let n = 0;
        for (const g of list) {
            const plats  = g.platforms || g.platform || 'windows';
            const is_dlc = g.is_dlc ? 1 : 0;
            stmtInsert.run('gog_' + g.id, g.title, g.id, g.platform || 'windows', plats, is_dlc);
            stmtUpdate.run(plats, is_dlc, g.id);
            n++;
        }
        return n;
    });
    try { return { ok: true, count: tx(games) }; }
    catch (e) { return { ok: false, error: e.message }; }
});

// Update platforms column for all existing GOG games from a fresh library fetch
ipcMain.handle('gog-sync-platforms', (_, games) => {
    const stmt = db.prepare("UPDATE games SET platforms = ? WHERE app_id = ? AND store = 'gog'");
    const tx = db.transaction(list => {
        for (const g of list) stmt.run(g.platforms || g.platform || 'windows', g.id);
    });
    try { tx(games); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
});

// ── GOG Achievements ──────────────────────────────────────────────────────────

ipcMain.handle('fetch-gog-achievements', async (_, appId) => {
    const token = await getGogToken();
    if (!token) return { ok: false, error: 'not_logged_in' };
    const userId = db.prepare("SELECT value FROM settings WHERE key='gog_user_id'").get()?.value;
    if (!userId) return { ok: false, error: 'no_user_id' };
    try {
        const data = await gogFetch(
            `https://gameplay.gog.com/clients/${appId}/users/${userId}/achievements`, token
        );
        const items = data.items || [];
        const upsert = db.prepare(`
            INSERT OR REPLACE INTO achievements
            (app_id, key, name, description, image_locked, image_unlocked, date_unlocked, visible)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const tx = db.transaction(list => {
            for (const a of list) {
                upsert.run(
                    appId,
                    a.achievement_key,
                    a.name,
                    a.description,
                    a.image_url_locked,
                    a.image_url_unlocked,
                    a.date_unlocked || null,
                    a.visible === false ? 0 : 1
                );
            }
        });
        tx(items);

        // Mirror to shared DB so Clarity / Couch can read without opening Installer's DB
        try {
            const sharedDbPath = path.join(appImageDir, 'GameManagerConfig', 'games.db');
            if (fs.existsSync(sharedDbPath)) {
                const sdb = new Database(sharedDbPath);
                sdb.exec(`CREATE TABLE IF NOT EXISTS achievements (
                    app_id TEXT NOT NULL, key TEXT NOT NULL, name TEXT,
                    description TEXT, image_locked TEXT, image_unlocked TEXT,
                    date_unlocked TEXT, visible INTEGER DEFAULT 1,
                    PRIMARY KEY (app_id, key)
                )`);
                const sup = sdb.prepare(`INSERT OR REPLACE INTO achievements
                    (app_id, key, name, description, image_locked, image_unlocked, date_unlocked, visible)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
                const stx = sdb.transaction(list => {
                    for (const a of list) sup.run(
                        appId, a.achievement_key, a.name, a.description,
                        a.image_url_locked, a.image_url_unlocked, a.date_unlocked || null,
                        a.visible === false ? 0 : 1
                    );
                });
                stx(items);
                sdb.close();
            }
        } catch {}

        return { ok: true, count: items.length };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('get-gog-achievements', (_, appId) => {
    try {
        const rows = db.prepare(
            "SELECT * FROM achievements WHERE app_id = ? ORDER BY date_unlocked DESC, name COLLATE NOCASE"
        ).all(appId);
        return { ok: true, achievements: rows };
    } catch (e) { return { ok: false, error: e.message }; }
});

// After gogdl installs, find the actual game subfolder and primary exe
// Detect a successful GOG install by reading the metadata gogdl leaves behind.
// Windows games: goggame-<id>.info  →  play tasks include the primary executable.
// Linux native:  .gogdl-linux-manifest  →  no .info file; scan dir for launcher.

// Heuristic: find the primary executable in a Linux GOG game directory.
// Prefers .sh launchers, then executable binaries matching the folder name,
// then any executable binary at the root.

let activeGogInstallProc = null;

ipcMain.handle('gogdl-install', (event, appId, platform, installDir, isDlc = false, baseAppId = null) => {
    if (activeGogInstallProc) return { ok: false, error: 'An installation is already in progress.' };
    const gogdl = findGogdl();
    if (!gogdl) return { ok: false, error: 'gogdl not found. Place the gogdl binary in the same folder as Installer.AppImage.' };

    const dir = expandTilde(installDir) || path.join(HOME, 'Games', 'Clarity');

    // For DLCs the user selects the base game's install folder.
    // gogdl --path expects the PARENT of the game folder; we pass dirname(dir).
    // We download using the base game's app_id and --dlcs <dlc_id> so gogdl
    // knows how to merge the DLC into the existing installation correctly.
    const gogdlPath  = isDlc ? path.dirname(dir) : dir;
    const downloadId = isDlc && baseAppId ? baseAppId : appId;
    if (!isDlc) { try { fs.mkdirSync(dir, { recursive: true }); } catch {} }

    // Snapshot subdirectories before gogdl runs so findGogInstallResult can
    // skip pre-existing Linux-native game folders (avoids metadata cross-contamination).
    let preExistingDirs;
    try {
        preExistingDirs = new Set(
            fs.readdirSync(dir, { withFileTypes: true })
              .filter(e => e.isDirectory()).map(e => e.name)
        );
    } catch { preExistingDirs = new Set(); }

    // Ensure the binary is executable
    try { fs.chmodSync(gogdl, '755'); } catch {}

    // Clear cached manifest so gogdl does a fresh file comparison
    const manifestPath = path.join(configDir, 'gogdl', 'manifests', downloadId);
    try { fs.rmSync(manifestPath, { force: true }); } catch {}

    const authPath = writeGogAuthConfig();
    const send = d => { try { event.sender.send('gog-install-progress', String(d)); } catch {} };

    return new Promise(resolve => {
        const args = [
            '--auth-config-path', authPath,
            'download', downloadId,
            '--platform', platform,
            '--path',     gogdlPath,
            '--lang',     'en-US',
        ];
        if (isDlc && baseAppId) { args.push('--dlcs', appId); args.push('--dlc-only'); }
        else if (isDlc)         args.push('--dlc-only');
        send(`Running: gogdl download ${downloadId} --platform ${platform} --path ${gogdlPath}${isDlc ? ` --dlcs ${appId} --dlc-only` : ''}\n`);

        activeGogInstallProc = spawn(gogdl, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            // Point gogdl to Installer's own config dir so manifests don't
            // collide with another GOG launcher's cached manifests causing false "Nothing to do"
            env: { ...process.env, GOGDL_CONFIG_PATH: configDir },
        });

        activeGogInstallProc.stdout.on('data', send);
        activeGogInstallProc.stderr.on('data', send);
        activeGogInstallProc.on('close', async code => {
            activeGogInstallProc = null;
            try { fs.unlinkSync(authPath); } catch {}

            if (isDlc) {
                // DLCs merge into the existing base game folder, no new subfolder to scan.
                // Success is determined solely by exit code.
                resolve({ ok: code === 0, exitCode: code, install_dir: dir,
                          gameInfo: code === 0 ? { install_path: dir, executable: null } : null });
                return;
            }

            const gameInfo = code === 0 ? findGogInstallResult(dir, appId, preExistingDirs) : null;
            const ok = code === 0 && gameInfo !== null;

            if (ok) {
                // Auto-install compatibility files right after a successful GOG install
                const game = db.prepare("SELECT * FROM games WHERE app_id=? AND store='gog'").get(appId);
                if (game) {
                    const prefixPath = installerEngine.prefixPathForGame(game);
                    const protonPath = game.proton_path
                        || db.prepare("SELECT value FROM settings WHERE key='default_proton_path'").get()?.value;
                    send('\n─── Auto-installing compatibility files ───\n');
                    await runRedist(event.sender, 'gog-install-progress', appId, platform, prefixPath, protonPath);
                }
            }

            resolve({ ok, exitCode: code, install_dir: dir, gameInfo,
                      error: code === 0 && !gameInfo
                          ? 'gogdl exited without downloading any files. The game may not support this platform or the manifest is cached incorrectly. Try verifying your GOG login.'
                          : undefined });
        });
        activeGogInstallProc.on('error', e => {
            activeGogInstallProc = null;
            send(`\nSpawn error: ${e.message}\n`);
            resolve({ ok: false, error: e.message });
        });
    });
});

ipcMain.handle('gogdl-cancel-install', () => {
    if (!activeGogInstallProc) return { ok: false };
    activeGogInstallProc.kill('SIGTERM');
    activeGogInstallProc = null;
    return { ok: true };
});

ipcMain.handle('gogdl-repair', (event, gameId) => {
    if (activeGogInstallProc) return { ok: false, error: 'An installation is already in progress.' };
    const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
    if (!game) return { ok: false, error: 'Game not found.' };
    const installPath = expandTilde(game.install_path || '');
    if (!installPath || !fs.existsSync(installPath))
        return { ok: false, error: 'Install path not found. Is the game installed?' };

    const gogdl = findGogdl();
    if (!gogdl) return { ok: false, error: 'gogdl not found.' };
    try { fs.chmodSync(gogdl, '755'); } catch {}

    // gogdl --path expects the parent of the game folder (same as at install time)
    const gogdlPath = path.dirname(installPath);
    const platform  = game.platform || 'windows';
    const authPath  = writeGogAuthConfig();
    const send = d => { try { event.sender.send('gog-install-progress', String(d)); } catch {} };

    return new Promise(resolve => {
        send(`Running: gogdl download ${game.app_id} --platform ${platform} --path ${gogdlPath}\n`);
        activeGogInstallProc = spawn(gogdl, [
            '--auth-config-path', authPath,
            'download', String(game.app_id),
            '--platform', platform,
            '--path', gogdlPath,
            '--lang', 'en-US',
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, GOGDL_CONFIG_PATH: configDir },
        });
        activeGogInstallProc.stdout.on('data', send);
        activeGogInstallProc.stderr.on('data', send);
        activeGogInstallProc.on('close', code => {
            activeGogInstallProc = null;
            try { fs.unlinkSync(authPath); } catch {}
            resolve({ ok: code === 0, exitCode: code });
        });
        activeGogInstallProc.on('error', e => {
            activeGogInstallProc = null;
            try { fs.unlinkSync(authPath); } catch {}
            send(`\nSpawn error: ${e.message}\n`);
            resolve({ ok: false, error: e.message });
        });
    });
});

ipcMain.handle('legendary-repair', (event, gameId) => {
    if (activeInstallProc) return { ok: false, error: 'An installation is already in progress.' };
    const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
    if (!game) return { ok: false, error: 'Game not found.' };

    const leg = findLegendary();
    if (!leg) return { ok: false, error: 'legendary not found.' };

    const send = d => { try { event.sender.send('install-progress', String(d)); } catch {} };

    return new Promise(resolve => {
        send(`Running: legendary install ${game.app_id} --repair\n`);
        activeInstallProc = spawn(leg, ['install', game.app_id, '--repair', '-y'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        activeInstallProc.stdout.on('data', send);
        activeInstallProc.stderr.on('data', send);
        activeInstallProc.on('close', code => {
            activeInstallProc = null;
            resolve({ ok: code === 0, exitCode: code });
        });
        activeInstallProc.on('error', e => {
            activeInstallProc = null;
            send(`\nSpawn error: ${e.message}\n`);
            resolve({ ok: false, error: e.message });
        });
    });
});

// Install the host's recommended compatibility runner.
ipcMain.handle('install-umu', (event) => {
    if (!host.runtime.canInstallRunner) return { ok: false, error: 'This system has no installable compatibility runner.' };
    return host.runtime.installRunner({
        onProgress: line => { try { event.sender.send('umu-install-progress', line); } catch {} },
    });
});
