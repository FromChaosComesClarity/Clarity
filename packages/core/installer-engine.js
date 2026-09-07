'use strict';
/*
 * @clarity/core, Installer engine (window-free).
 *
 * The GOG/Epic install/uninstall/launch machinery, lifted out of Installer's
 * window-bound main.js so it can run in-process from any face of the suite
 * (the installer GUI, and, Phase 2b, the Manager's in-process installer).
 *
 * All interactive UI (OAuth login windows, file/dir pickers) stays in
 * installer/main.js IPC handlers; nothing here imports electron. Progress is
 * reported through an injected `onProgress(data)` callback instead of writing
 * a file directly, so the caller decides where it goes (installer → progress
 * file; Manager → IPC event).
 *
 * Usage:
 *   const engine = require('../../packages/core/installer-engine.js');
 *   engine.init({ configDir, prefixesDir, logDir, binDir, appImageDir,
 *                 homeDir, db, onProgress });
 *   // then call engine.findGogdl(), engine.launchGame(id), etc.
 *
 * This is built up in slices; slice 1 is the pure path/binary helper layer.
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const host = require('./platform/index.js');

// ── Injected context (set by init) ────────────────────────────────────────────
let configDir, prefixesDir, logDir, binDir, appImageDir, HOME, db, _onProgress, _onLaunchIssue, _onLaunchProgress, _onGameSession;
let BUNDLED_LEGENDARY, BUNDLED_GOGDL, BUNDLED_COMET;

function init(ctx = {}) {
    configDir    = ctx.configDir;
    prefixesDir  = ctx.prefixesDir;
    logDir       = ctx.logDir;
    binDir       = ctx.binDir;
    appImageDir  = ctx.appImageDir;
    HOME         = ctx.homeDir || os.homedir();
    db           = ctx.db || db;
    _onProgress  = ctx.onProgress || _onProgress || (() => {});
    // Called when a launched game dies on the spot (see spawnGame's watchdog), so the face
    // can tell the user instead of leaving them staring at a library that did nothing.
    _onLaunchIssue = ctx.onLaunchIssue || _onLaunchIssue || (() => {});
    // Called with true when a game process starts and false when it exits. The engine has no
    // business knowing what a face does with that, holding off the screen lock, switching a
    // power profile, so it just reports the fact.
    _onGameSession = ctx.onGameSession || _onGameSession || (() => {});
    // Called while a game is still setting itself up, the compatibility runtime's one-time
    // download and the per-game prefix build both take minutes with nothing on screen otherwise.
    _onLaunchProgress = ctx.onLaunchProgress || _onLaunchProgress || (() => {});

    BUNDLED_LEGENDARY = path.join(binDir, 'legendary');
    BUNDLED_GOGDL     = path.join(binDir, 'gogdl');
    BUNDLED_COMET     = path.join(binDir, 'comet');

    // The backend shares this context rather than re-deriving it, so a face that re-inits
    // (or re-attaches its database through setDb) moves both in step.
    host.init({ homeDir: HOME, configDir, getDb: () => db, expandTilde });
}

// Allow the DB handle to be (re)attached after init (installer opens it in initDb).
function setDb(handle) { db = handle; }

// Create the library.db schema if it isn't there yet, so any face can bootstrap a
// fresh database (e.g. headless GOG/Epic sign-in on a clean install) without ever
// opening the Installer GUI. Mirrors Installer's own initDb schema + column migrations;
// every statement is IF-NOT-EXISTS / guarded, so it's safe to run on an existing db.
function ensureSchema(handle = db) {
    if (!handle) return;
    handle.exec(`
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
    for (const sql of [
        "ALTER TABLE games ADD COLUMN platform TEXT",
        "ALTER TABLE games ADD COLUMN platforms TEXT",
        "ALTER TABLE games ADD COLUMN custom_env TEXT",
        "ALTER TABLE games ADD COLUMN winetricks TEXT",
        "ALTER TABLE games ADD COLUMN use_esync INTEGER DEFAULT 1",
        "ALTER TABLE games ADD COLUMN use_fsync INTEGER DEFAULT 1",
        "ALTER TABLE games ADD COLUMN use_dxvk_nvapi INTEGER DEFAULT 0",
        "ALTER TABLE games ADD COLUMN use_battleye INTEGER DEFAULT 0",
        "ALTER TABLE games ADD COLUMN use_eac INTEGER DEFAULT 0",
        "ALTER TABLE games ADD COLUMN launch_target TEXT",
        // Which entry of goggame-<appId>.info playTasks launch_target came from. Needed
        // because a path does not identify a task: Quake's two mission packs are both
        // glquake.exe and differ only in their arguments (-game hipnotic / -game rogue).
        "ALTER TABLE games ADD COLUMN launch_task_index INTEGER",
        "ALTER TABLE games ADD COLUMN launch_args TEXT",
        "ALTER TABLE games ADD COLUMN is_dlc INTEGER DEFAULT 0",
        "ALTER TABLE games ADD COLUMN custom_exe TEXT",
    ]) { try { handle.prepare(sql).run(); } catch {} }
    try { handle.exec(`CREATE TABLE IF NOT EXISTS achievements (
        app_id         TEXT NOT NULL,
        key            TEXT NOT NULL,
        name           TEXT,
        description    TEXT,
        image_locked   TEXT,
        image_unlocked TEXT,
        date_unlocked  TEXT,
        visible        INTEGER DEFAULT 1,
        PRIMARY KEY (app_id, key)
    )`); } catch {}
}

// Progress sink, callers inject the real destination via init({ onProgress }).
function writeProgress(data) { _onProgress(data); }

// ── Pure helpers ───────────────────────────────────────────────────────────────
function sanitizeLogName(title) {
    return (title || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 80) || 'unknown';
}

// The `$ ...` line at the top of a launch log is read by a person working out why a game did
// not start, and it is the first thing they trust. Joining argv with spaces makes one argument
// that holds a space look like two, so `-file "mods/Brutal Doom/x.pk3"` prints as `-file
// mods/Brutal Doom/x.pk3` and reads as a quoting bug in the launcher. The spawn is an argv
// array and was always correct; this is about the line saying so, and staying pasteable into a
// shell when someone wants to run it by hand.
function quoteArg(value) {
    const s = String(value);
    return s !== '' && !/[\s"'\\$`!*?~<>|&;()#]/.test(s) ? s : `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
}

const commandLine = (cmd, args) => [cmd, ...(args || [])].map(quoteArg).join(' ');

function expandTilde(p) {
    if (!p) return p;
    if (p === '~') return HOME;
    if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
    return p;
}

// Resolves a file path case-insensitively, segment by segment.
// Needed because GOG manifests declare Windows-style casing (e.g. DOOM3.exe)
// while the installer writes different casing on disk (e.g. Doom3.exe).
function resolvePathCaseInsensitive(filePath) {
    if (!filePath) return filePath;
    if (fs.existsSync(filePath)) return filePath;
    // Split and filter empty strings, leading '/' on absolute paths produces an
    // empty first element that would cause path.join to build a relative path.
    const isAbs = path.isAbsolute(filePath);
    const parts  = filePath.split(path.sep).filter(p => p !== '');
    let resolved = isAbs ? path.sep : parts[0];
    const start  = isAbs ? 0 : 1;
    for (let i = start; i < parts.length; i++) {
        const segment = parts[i];
        const exact   = path.join(resolved, segment);
        if (fs.existsSync(exact)) { resolved = exact; continue; }
        try {
            const match = fs.readdirSync(resolved).find(e => e.toLowerCase() === segment.toLowerCase());
            if (match) { resolved = path.join(resolved, match); }
            else       { resolved = path.join(resolved, ...parts.slice(i)); break; }
        } catch     { resolved = path.join(resolved, ...parts.slice(i)); break; }
    }
    return resolved;
}

// ── External tool helpers ─────────────────────────────────────────────────────
// Host-specific: a macOS .app launched from Finder inherits a minimal PATH with no
// Homebrew in it, so "is this installed" is not the same question on every platform.
const which = (bin) => host.which(bin);

// Tool paths resolved once, avoids re-running a PATH lookup on every launch/IPC call
let _legendary = null, _gogdl = null, _comet = null;
let _activeInstallProc = null;   // the gogdl/legendary child currently downloading (for cancel)
let _activeKillTimer   = null;
let _installCancelled  = false;  // set by cancel → makes the failure message read "cancelled"
// Kill the in-flight headless download, if any. gogdl/legendary spawn parallel download workers, so a
// SIGTERM to just the main process often leaves it waiting on them (and the download running) → the
// close handler never fires and the UI hangs on "Cancelling…". We kill the whole PROCESS GROUP (the
// children are spawned detached = group leaders) and hard-kill with SIGKILL if it doesn't exit quickly.
// The spawn's close handler then resolves failure, headlessInstall emits an error event, and the
// caller's _installerBusy clears + the queue advances.
function cancelActiveInstall() {
    const proc = _activeInstallProc;
    if (!proc || !proc.pid) return false;
    _installCancelled = true;
    const killGroup = (sig) => {
        try { process.kill(-proc.pid, sig); }        // negative pid = the whole process group
        catch { try { proc.kill(sig); } catch {} }   // fallback: at least the main child
    };
    killGroup('SIGTERM');
    if (_activeKillTimer) clearTimeout(_activeKillTimer);
    _activeKillTimer = setTimeout(() => killGroup('SIGKILL'), 3000);  // uncatchable, guarantees exit
    return true;
}
function findLegendary() {
    if (_legendary !== null) return _legendary;
    _legendary = fs.existsSync(BUNDLED_LEGENDARY) ? BUNDLED_LEGENDARY : (which('legendary') || '');
    return _legendary || null;
}
function findGogdl() {
    if (_gogdl !== null) return _gogdl;
    _gogdl = fs.existsSync(BUNDLED_GOGDL) ? BUNDLED_GOGDL : (which('gogdl') || '');
    return _gogdl || null;
}
function findComet() {
    if (_comet !== null) return _comet;
    _comet = fs.existsSync(BUNDLED_COMET) ? BUNDLED_COMET : (which('comet') || '');
    return _comet || null;
}
// Still exported: the Installer face destructures both. The caching moved to the backend.
const findUmu        = () => host.runtime.findUmu();
const findWineCached = () => host.runtime.findWine();

// ── Compatibility runtime ────────────────────────────────────────────────────
// Discovering the runtime, choosing one for a given game, and reading a failure out of a
// dead game's log are all host business, on Linux that is Proton driven by umu-run, and
// packages/core/platform/linux.js records why we always hand umu an explicit PROTONPATH.
// These wrappers stay because the Installer face and the Manager both destructure them.
const scanProtonVersions    = () => host.runtime.scan();
const resolveProton         = (game) => host.runtime.resolve(game);
const isProtonDir           = (dir) => host.runtime.isRuntimeDir(dir);
const diagnoseLaunchFailure = (log, runtimePath) => host.runtime.diagnose(log, runtimePath);

// ── First-launch progress ────────────────────────────────────────────────────
// The first Windows game on a machine doesn't start for minutes while the compatibility
// runtime downloads itself and the game's prefix is built. None of that reaches the UI on
// its own, so the app looks hung. We already send the launch output to a log file (see
// spawnGame), tailing that file is a safe way to follow along, with no pipe that could
// EPIPE a detached game later.
//
// What the phases ARE is the host's business (they match one particular runtime's output);
// the tailing below is not.

// Follow a launching game's log until it is actually running (or gives up). Emits only while
// setup is genuinely happening; a game whose runtime and prefix already exist blows past every
// step in well under a second and the faces never show anything.
function watchStartup({ proc, gameId, title, logPath }) {
    if (!logPath) return;
    const MAX_MS = 15 * 60000;          // generous: a slow link downloading the runtime
    const started = Date.now();
    let offset = 0, percent = 0, phase = '', finished = false, bytesAtPhase = 0;
    const steps = host.runtime.startupSteps();

    const emit = (extra = {}) => _onLaunchProgress({ gameId, title, phase, percent, ...extra });

    const finish = (why) => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        _onLaunchProgress({ gameId, title, phase: why, percent: 100, message: '', done: true });
    };

    const tick = () => {
        if (finished) return;
        if (Date.now() - started > MAX_MS) { finish('timeout'); return; }
        let chunk = '';
        try {
            const fd = fs.openSync(logPath, 'r');
            const size = fs.fstatSync(fd).size;
            if (size > offset) {
                const buf = Buffer.alloc(size - offset);
                fs.readSync(fd, buf, 0, buf.length, offset);
                offset = size;
                chunk = buf.toString('utf8');
            }
            fs.closeSync(fd);
        } catch { return; }

        for (const line of chunk.split('\n')) {
            if (!line.trim()) continue;
            const step = steps.find(s => s.re.test(line));
            if (!step || step.percent < percent) continue;   // never walk backwards
            percent = step.percent; phase = step.phase; bytesAtPhase = 0;
            if (phase === 'running') { finish('running'); return; }
            emit({ message: step.message });
        }

        // Keep the big download visibly alive between log lines (the runtime prints none while fetching).
        if (phase === host.runtime.setupPhase) {
            const bytes = host.runtime.setupBytes();
            if (bytes > bytesAtPhase) {
                bytesAtPhase = bytes;
                emit({ message: `Downloading the compatibility runtime, ${(bytes / 1e6).toFixed(0)} MB so far. One-time setup.` });
            }
        }
    };

    const timer = setInterval(tick, 500);
    if (timer.unref) timer.unref();
    proc.once('exit', () => setTimeout(() => finish('exited'), 600));   // let the last lines land
}

// Locate the BattlEye / EasyAntiCheat runtime a game asks for.
const findRuntime = (name) => host.runtime.findAntiCheatRuntime(name);

// ── Moved from installer/main.js (slice 2): GOG creds + install/launch/auth engine ──
const GOG_CLIENT_ID     = '46899977096215655';

const GOG_CLIENT_SECRET = '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9';

const GOG_REDIRECT_URI  = 'https://embed.gog.com/on_login_success?origin=client';

// Which store an appId belongs to, for building a InstallerGameId. The row in library.db is
// authoritative; 'gog' is the fallback because every numeric GOG id reaches here that way.
function storeOfAppId(appId) {
    try { return db?.prepare("SELECT store FROM games WHERE app_id=?").get(appId)?.store || 'gog'; }
    catch { return 'gog'; }
}

function syncSharedDb(appId, installed) {
    const sharedDbPath = path.join(appImageDir, 'GameManagerConfig', 'games.db');
    if (!fs.existsSync(sharedDbPath)) return;
    try {
        const sdb = new Database(sharedDbPath);
        // ⚠️ games.db keys Installer games by InstallerGameId ('gog_<appId>'), and has no app_id
        // column at all. Asking for one threw on the first statement, so the whole function
        // failed inside its own try/catch and the LaunchCommand fallback below was never
        // reachable, the shared library's Installed flag was simply never written here.
        const byGid = sdb.prepare("UPDATE games SET Installed=? WHERE InstallerGameId=?")
                         .run(installed ? 1 : 0, `${storeOfAppId(appId)}_${appId}`);
        if (byGid.changes === 0) {
            sdb.prepare("UPDATE games SET Installed=? WHERE LaunchCommand LIKE ?").run(installed ? 1 : 0, `%${appId}%`);
        }
        sdb.close();
    } catch {}
}

// The library.db row for a game, creating it if the owned-library sync has not. Mirrors the
// columns and id convention syncOwnedLibrary uses ('<store>_<appId>'), so a row made here is
// indistinguishable from a synced one and a later sync's INSERT OR IGNORE leaves it alone.
function ensureGameRow(store, appId, title, platform) {
    if (!db) return null;
    const sel = () => db.prepare("SELECT * FROM games WHERE app_id=? AND store=?").get(appId, store);
    let game = sel();
    if (game) return game;
    try {
        const plat = platform || 'windows';
        db.prepare("INSERT OR IGNORE INTO games (id, title, store, app_id, platform, platforms, installed) VALUES (?, ?, ?, ?, ?, ?, 0)")
          .run(`${store}_${appId}`, title || appId, store, String(appId), plat, plat);
    } catch {}
    return sel();
}

async function headlessInstall(store, appId, platform, installDir, opts = {}) {
    // The shared library knows the name even when library.db has never been synced, and it is
    // what every progress message shows, without this the user watched "1207666353" download.
    const sharedTitle = () => {
        try {
            const sp = path.join(appImageDir, 'GameManagerConfig', 'games.db');
            if (!fs.existsSync(sp)) return null;
            const sdb = new Database(sp, { readonly: true });
            const row = sdb.prepare("SELECT Game FROM games WHERE InstallerGameId=?").get(`${store}_${appId}`);
            sdb.close();
            return row?.Game || null;
        } catch { return null; }
    };
    const title = (() => { try { return db?.prepare("SELECT title FROM games WHERE app_id=? AND store=?").get(appId, store)?.title; } catch { return null; } })()
        || sharedTitle() || appId;
    const base = { title, store, appId, done: false };
    _installCancelled = false;   // fresh run, cleared so a prior cancel doesn't mislabel this one
    // DLC directives (opts): withDlcs/dlcIds = add DLCs; skipDlcs = base only ("Reset DLCs").
    // `dlcOp` = any DLC-scoped operation.
    //
    // SAFETY (learned the hard way, this caused base-game deletion):
    //  • NEVER pass --dlc-only: it makes gogdl's target set ONLY the DLC files, so reconciliation
    //    DELETES every other tracked file, wiping the base game.
    //  • NEVER pass --dlcs <ids> to filter: that also narrows the target and deletes tracked files
    //    outside the list. Empirically, `--with-dlcs` (all owned, no filter) reconciles with
    //    Deleted: 0, it only ADDS missing DLC files and never removes the base. So every DLC-add
    //    installs the game's *complete* owned DLC set. Per-DLC selection is not safely possible.
    //  • --skip-dlcs keeps the base in the target (safe) and strips DLC files (the intended reset).
    const dlcOp = !!(opts.withDlcs || opts.dlcIds?.length || opts.skipDlcs);
    const dlcArgs = [];
    if (opts.skipDlcs)                          dlcArgs.push('--skip-dlcs');
    else if (opts.withDlcs || opts.dlcIds?.length) dlcArgs.push('--with-dlcs');

    if (store === 'gog') {
        const gogdl = findGogdl();
        if (!gogdl) { writeProgress({ ...base, step: 'error', message: 'gogdl not found.', done: true }); return; }
        // DLC changes / reinstalls target the base game's existing parent folder.
        let dir;
        if (dlcOp) {
            const cur = db?.prepare("SELECT install_path FROM games WHERE app_id=? AND store='gog'").get(appId)?.install_path;
            dir = cur ? path.dirname(expandTilde(cur)) : (expandTilde(installDir) || path.join(HOME, 'Games', 'Clarity'));
        } else {
            dir = expandTilde(installDir) || path.join(HOME, 'Games', 'Clarity');
        }
        try { fs.mkdirSync(dir, { recursive: true }); } catch {}
        try { fs.chmodSync(gogdl, '755'); } catch {}
        const manifestPath = path.join(configDir, 'gogdl', 'manifests', appId);
        // Keep the manifest for DLC operations (gogdl reconciles against the existing install); wipe it only for a fresh base install.
        if (!dlcOp) { try { fs.rmSync(manifestPath, { force: true }); } catch {} }

        // Refresh GOG token before writing auth config, avoids stale-token failures in headless mode
        writeProgress({ ...base, step: 'auth', percent: 0, message: 'Refreshing authentication...' });
        await getGogToken().catch(() => {});
        const authPath = writeGogAuthConfig();

        // ── Stall watchdog ───────────────────────────────────────────────────
        // A download can keep its process alive, its sockets open and its transfer rate up
        // while making no actual progress, a corrupt chunk on one of GOG's CDNs did exactly
        // that, and the only symptom was a percentage that never changed. Nothing in the app
        // noticed for over an hour; the user did.
        //
        // So watch the number itself. If the reported percentage has not moved in
        // STALL_WARN_MS, say so plainly and keep saying it, rather than presenting a frozen
        // figure as though it were fine. This is deliberately a reporter, not a healer: it
        // cannot know whether a stall is fatal, and killing someone's 9 GB download on a
        // guess would be worse than telling them the truth and letting them decide.
        const STALL_WARN_MS = 4 * 60 * 1000;
        const STALL_TICK_MS = 30 * 1000;

        const runGogdlDownload = async (plat) => {
            let lastLines = [];
            let lastPercent = -1;
            let lastMovedAt = Date.now();
            let stallTimer = null;
            const noteProgress = pct => {
                if (pct !== lastPercent) { lastPercent = pct; lastMovedAt = Date.now(); }
            };
            const ok = await new Promise(resolve => {
                const proc = spawn(gogdl, [
                    '--auth-config-path', authPath, 'download', appId,
                    '--platform', plat, '--path', dir, '--lang', 'en-US',
                    ...dlcArgs,
                ], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GOGDL_CONFIG_PATH: configDir }, detached: true });
                _activeInstallProc = proc;
                let buf = '';
                const onData = d => {
                    buf += String(d);
                    const lines = buf.split('\n'); buf = lines.pop();
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed) { lastLines.push(trimmed); if (lastLines.length > 5) lastLines.shift(); }
                        const pct = line.match(/(\d+(?:\.\d+)?)\s*%/)?.[1];
                        const sz  = line.match(/([\d.]+\s*(?:GiB|MiB|GB|MB))\s*\/\s*([\d.]+\s*(?:GiB|MiB|GB|MB))/i);
                        if (pct || sz) {
                            const pctNum = pct ? parseFloat(pct) : 0;
                            noteProgress(pctNum);
                            writeProgress({ ...base, step: 'downloading', percent: pctNum, message: `[${plat}] ${sz ? `${sz[1]} / ${sz[2]}` : `${pct || 0}%`}` });
                        }
                    }
                };
                proc.stdout.on('data', onData); proc.stderr.on('data', onData);

                // Re-sent on every tick while the stall lasts, so the message survives the
                // next ordinary progress line and the UI keeps showing it.
                stallTimer = setInterval(() => {
                    const stalledFor = Date.now() - lastMovedAt;
                    if (stalledFor < STALL_WARN_MS) return;
                    const mins = Math.floor(stalledFor / 60000);
                    writeProgress({
                        ...base, step: 'downloading', percent: lastPercent >= 0 ? lastPercent : 0,
                        stalled: true, stalledMinutes: mins,
                        message: `[${plat}] Stuck at ${lastPercent >= 0 ? lastPercent.toFixed(2) : '0'}% for ${mins} min, GOG may be serving a bad file. Cancelling and starting again usually clears it.`,
                    });
                }, STALL_TICK_MS);

                const done = ok => { if (stallTimer) { clearInterval(stallTimer); stallTimer = null; } if (_activeInstallProc === proc) _activeInstallProc = null; if (_activeKillTimer) { clearTimeout(_activeKillTimer); _activeKillTimer = null; } resolve(ok); };
                proc.on('close', code => done(code === 0));
                proc.on('error', () => done(false));
            });
            return { ok, lastLines };
        };

        // Snapshot subdirectories before gogdl runs (same guard as gogdl-install IPC).
        let preExistingDirsH;
        try {
            preExistingDirsH = new Set(
                fs.readdirSync(dir, { withFileTypes: true })
                  .filter(e => e.isDirectory()).map(e => e.name)
            );
        } catch { preExistingDirsH = new Set(); }

        const activePlat = platform || 'windows';
        writeProgress({ ...base, step: 'downloading', percent: 0, message: `Starting download (${activePlat})...` });
        const { ok: dlOk, lastLines } = await runGogdlDownload(activePlat);

        try { fs.unlinkSync(authPath); } catch {}
        if (!dlOk) { writeProgress({ ...base, step: 'error', message: _installCancelled ? 'Installation cancelled.' : (lastLines.slice(-2).join(' | ') || 'Download failed.'), done: true }); return; }

        // DLC operations reconcile the already-installed base folder (no NEW game dir is created, and the
        // base's install state / executable are unchanged) → skip new-install detection and finish.
        if (dlcOp) { writeProgress({ ...base, step: 'done', percent: 100, message: 'DLC changes complete!', done: true }); return; }

        const gameInfo = findGogInstallResult(dir, appId, preExistingDirsH);
        if (!gameInfo) { writeProgress({ ...base, step: 'error', message: 'Install verification failed.', done: true }); return; }
        writeProgress({ ...base, step: 'installing', percent: 100, message: 'Updating library...' });

        try {
            // ⚠️ Rows in library.db are created by the owned-library sync, NOT by installing.
            // On a machine where that sync has never run, a rebuilt library.db beside a
            // restored library, which is exactly what a host migration leaves behind, there
            // was nothing to update. This was `if (game)` with no else: the files downloaded,
            // the bookkeeping and the redistributables were skipped, "Installation complete!"
            // was still reported, and the game then refused to start with
            // 'Game "gog_<id>" not found in Installer database.'
            //
            // An install already knows everything the row needs, so it creates one rather than
            // depending on a sync having happened first.
            const game = ensureGameRow('gog', appId, title, activePlat);
            if (game) {
                db.prepare("UPDATE games SET installed=1, install_path=?, executable=? WHERE id=?").run(gameInfo.install_path, gameInfo.executable, game.id);
                writeProgress({ ...base, step: 'redist', percent: 0, message: 'Checking compatibility files...' });
                const prefixPath = prefixPathForGame(game);
                const protonPath = game.proton_path || db.prepare("SELECT value FROM settings WHERE key='default_proton_path'").get()?.value;
                const fakeSender = { send: (_ch, data) => { const line = typeof data === 'object' ? (data.line || '') : String(data); if (line.trim()) writeProgress({ ...base, step: 'redist', percent: 0, message: line.trim().slice(0, 120) }); } };
                await runRedist(fakeSender, 'x', appId, platform || 'windows', prefixPath, protonPath);
            }
        } catch {}
        syncSharedDb(appId, true);
        writeProgress({ ...base, step: 'done', percent: 100, message: 'Installation complete!', done: true });

    } else if (store === 'epic') {
        const leg = findLegendary();
        if (!leg) { writeProgress({ ...base, step: 'error', message: 'legendary not found.', done: true }); return; }
        const dir = expandTilde(installDir) || path.join(HOME, 'Games', 'Clarity');
        try { fs.mkdirSync(dir, { recursive: true }); } catch {}
        writeProgress({ ...base, step: 'downloading', percent: 0, message: 'Starting download...' });
        await new Promise(res => { const p = spawn(leg, ['uninstall', appId, '-y'], { stdio: 'ignore' }); p.on('close', res); p.on('error', res); });

        const dlOk = await new Promise(resolve => {
            const proc = spawn(leg, ['install', appId, '--base-path', dir, '-y'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
            _activeInstallProc = proc;
            let buf = '';
            const onData = d => {
                buf += String(d);
                const lines = buf.split('\n'); buf = lines.pop();
                for (const line of lines) {
                    const pct = line.match(/(\d+(?:\.\d+)?)\s*%/)?.[1];
                    const sz  = line.match(/([\d.]+\s*(?:GiB|MiB|GB|MB))\s*\/\s*([\d.]+\s*(?:GiB|MiB|GB|MB))/i);
                    if (pct || sz) writeProgress({ ...base, step: 'downloading', percent: pct ? parseFloat(pct) : 0, message: sz ? `${sz[1]} / ${sz[2]}` : `${pct || 0}%` });
                }
            };
            proc.stdout.on('data', onData); proc.stderr.on('data', onData);
            const done = ok => { if (_activeInstallProc === proc) _activeInstallProc = null; if (_activeKillTimer) { clearTimeout(_activeKillTimer); _activeKillTimer = null; } resolve(ok); };
            proc.on('close', code => done(code === 0));
            proc.on('error', () => done(false));
        });
        if (!dlOk) { writeProgress({ ...base, step: 'error', message: _installCancelled ? 'Installation cancelled.' : 'Download failed.', done: true }); return; }
        writeProgress({ ...base, step: 'installing', percent: 100, message: 'Finalizing...' });
        try {
            // Same as the GOG branch above: create the row if the library sync never has.
            const game = ensureGameRow('epic', appId, title, null);
            if (game) { const info = await getGameInstallInfo(appId); if (info) db.prepare("UPDATE games SET installed=1, install_path=?, executable=? WHERE id=?").run(info.install_path, info.executable, game.id); }
        } catch {}
        syncSharedDb(appId, true);
        writeProgress({ ...base, step: 'done', percent: 100, message: 'Installation complete!', done: true });
    }
}

async function headlessUninstall(store, appId) {
    const game = (() => { try { return db?.prepare("SELECT * FROM games WHERE app_id=? AND store=?").get(appId, store); } catch { return null; } })();
    const title = game?.title || appId;
    const base = { title, store, appId, done: false };
    writeProgress({ ...base, step: 'uninstalling', percent: 0, message: 'Removing game files...' });
    if (!game) { writeProgress({ ...base, step: 'error', message: 'Game not found.', done: true }); return; }

    const installPath = expandTilde(game.install_path || '');
    // Safe bases: the configured install folder AND the built-in default. Both, because the
    // folder is user-changeable, a game installed under the old base must still be removable
    // after the setting is pointed somewhere else.
    const bases = [
        db?.prepare("SELECT value FROM settings WHERE key='default_install_dir'").get()?.value,
        path.join(HOME, 'Games', 'Clarity'),
    ].filter(Boolean).map(expandTilde);
    if (installPath && fs.existsSync(installPath)) {
        const safe = installPath !== HOME && installPath !== '/' &&
                     bases.some(b => installPath !== b && installPath.startsWith(b + path.sep));
        if (safe) { try { fs.rmSync(installPath, { recursive: true, force: true }); } catch {} }
    }
    writeProgress({ ...base, step: 'uninstalling', percent: 50, message: 'Removing Wine prefix...' });
    const prefixPath = prefixPathForGame(game);
    if (fs.existsSync(prefixPath)) { try { fs.rmSync(prefixPath, { recursive: true, force: true }); } catch {} }

    if (store === 'epic') {
        const leg = findLegendary();
        if (leg) {
            writeProgress({ ...base, step: 'uninstalling', percent: 75, message: 'Removing Epic record...' });
            await new Promise(res => { const p = spawn(leg, ['uninstall', appId, '-y'], { stdio: 'ignore' }); p.on('close', res); p.on('error', res); });
        }
    }
    try { db?.prepare("UPDATE games SET installed=0, install_path=NULL, executable=NULL, version=NULL WHERE id=?").run(game.id); } catch {}
    syncSharedDb(appId, false);
    writeProgress({ ...base, step: 'done', percent: 100, message: 'Game uninstalled.', done: true });
}

// Single source of truth for a game's Wine prefix path (used by launch, install
// redist, uninstall, the Installer GUI, and the Manager's save-game resolver).
// An explicit prefix_path wins; else a legacy dir named by the installer row id if
// one exists; else a sanitized dir under prefixesDir. The fallback base is app_id
// (what install-time creation uses when a title is missing), so lookup matches
// creation. Pass { requireExplicitExists: true } to make a set-but-missing
// prefix_path fall through instead of being returned (GUI "where is it?" semantics).
function prefixPathForGame(game, opts = {}) {
    const explicit = expandTilde(game.prefix_path);
    if (explicit && (!opts.requireExplicitExists || fs.existsSync(explicit))) return explicit;
    const id = String(game.id || '');
    const legacy = id && path.join(prefixesDir, id);
    if (legacy && fs.existsSync(legacy)) return legacy;
    const base = String(game.title || game.app_id || id);
    const safeName = base.replace(/[/\\:*?"<>|]/g, '').trim().slice(0, 64) || String(game.app_id || id);
    return path.join(prefixesDir, safeName);
}

// The wrapper DLLs a game ships beside its executable. On Windows the application
// directory is searched first, so these are what the game would load; Wine reverses that
// for DLLs it implements itself, and the bundled one never runs.
//
// Two proven cases, both of which looked like the game simply not starting:
//   • GOG's Quake ships 3dfx's "Voodoo Quake Driver" as opengl32.dll. Against Wine's
//     builtin, GLQuake dies on a stack overflow before a window appears.
//   • Resident Evil 2's Classic REbirth patch is a ddraw.dll. Shadowed by Wine's builtin
//     it never loads, so the game runs untranslated and stops at a Japanese dialog,
//     confirmed by WINEDEBUG=+loaddll reporting "builtin" for a file that is right there.
//
// Deliberately a short list of *wrappers*. d3d9, dxgi and d3d11 are excluded on purpose:
// a game shipping one of those is usually shipping something DXVK does better.
//
// dinput8 earns its place for a third reason: it is what almost every modern ASI loader
// installs itself as, so a game folder containing one is nearly always a game someone has
// patched. OutRun2006Tweaks is the case in hand, and its own documentation tells Linux
// players to set exactly this override by hand, which is a thing a library ought to do
// for them.
const SHIPPED_WRAPPERS = ['opengl32.dll', 'ddraw.dll', 'dsound.dll', 'dinput.dll', 'dinput8.dll'];

function findShippedWrappers(resolvedExe, installPath) {
    const dirs = [resolvedExe && path.dirname(resolvedExe), installPath].filter(Boolean);
    const found = [];
    for (const dir of [...new Set(dirs)]) {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
            if (!e.isFile()) continue;
            const name = e.name.toLowerCase();
            if (SHIPPED_WRAPPERS.includes(name) && !found.includes(name)) found.push(name);
        }
        if (found.length) break;   // the executable's own directory wins
    }
    return found;
}

// ── GOG play tasks ───────────────────────────────────────────────────────────
// A GOG release often ships more than one way to start. Quake: The Offering has three,
// GLQuake (the primary, and the one with no music, being redbook-CD-only), WinQuake, and
// the DOS build that actually plays the soundtrack. Which one you get is not a detail the
// store makes visible, and picking the wrong default is not something we can fix for the
// user; we can only let them choose.
//
// goggame-<appId>.info lists them; games.launch_target names the chosen one and is what
// launchGame resolves the executable, the arguments and the working directory from.
//
// A path alone does not identify a task, which is why launch_task_index exists. Quake ships
// seven, and three of them are the same executable: the primary Glquake.exe, plus both
// mission packs as glquake.exe with -game hipnotic and -game rogue. Keyed on the path, the
// two packs are indistinguishable and the first one listed wins, so choosing Dissolution
// of Eternity would quietly start Scourge of Armagon.
//
// The index is a disambiguator, never the source of truth: a game update can reorder
// playTasks, so it is only honoured when the entry it points at still has the stored path.
function gogPlayTaskList(game) {
    if (!game || game.store !== 'gog' || !game.install_path || !game.app_id) return [];
    const installPath = expandTilde(game.install_path);
    // On macOS install_path IS the .app bundle (see platform/darwin.js), and GOG nests the
    // .info file inside it rather than at the install root the way Windows/Linux get it.
    const infoRel = /\.app$/i.test(installPath)
        ? path.join('Contents', 'Resources', `goggame-${game.app_id}.info`)
        : `goggame-${game.app_id}.info`;
    const infoFile = resolvePathCaseInsensitive(path.join(installPath, infoRel));
    let info;
    try { info = JSON.parse(fs.readFileSync(infoFile, 'utf8')); } catch { return []; }

    return (info.playTasks || [])
        .map((t, index) => ({ t, index }))
        .filter(({ t }) => t.type === 'FileTask' && t.path)
        .map(({ t, index }) => ({
            index,
            // GOG leaves the primary task unnamed. It is "the game". The title beats
            // repeating the filename, which the picker already shows underneath.
            name: t.name || (t.isPrimary ? (game.title || t.path) : t.path.replace(/\\/g, '/')),
            path: t.path.replace(/\\/g, '/'),
            arguments: t.arguments || '',
            workingDir: (t.workingDir || '').replace(/\\/g, '/'),
            isPrimary: !!t.isPrimary,
        }));
}

// The task launchGame will actually run, by one rule both it and the pickers follow.
function activeGogPlayTask(game, tasks) {
    if (!tasks.length) return null;
    const rel = String(game.launch_target || game.executable || '').replace(/\\/g, '/');
    if (!rel) return tasks.find(t => t.isPrimary) || null;
    const byIndex = tasks.find(t => t.index === game.launch_task_index && t.path === rel);
    return byIndex || tasks.find(t => t.path === rel) || null;
}

function gogPlayTasks(gameId) {
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
    const tasks = gogPlayTaskList(game);
    const active = activeGogPlayTask(game, tasks);
    return tasks.map(t => ({ ...t, isActive: active ? t.index === active.index : false }));
}

// Empty path clears the override and hands the choice back to GOG's primary task, so a
// game left on the default follows it if a later update moves what the default is.
function setGogLaunchTarget(gameId, relPath, taskIndex) {
    const target = String(relPath || '').replace(/\\/g, '/').trim() || null;
    const index = (target && Number.isInteger(taskIndex)) ? taskIndex : null;
    db.prepare('UPDATE games SET launch_target = ?, launch_task_index = ? WHERE id = ?')
      .run(target, index, gameId);
    return { ok: true, launchTarget: target, launchTaskIndex: index };
}

async function launchGame(gameId, opts = {}) {
    // opts.onOutput(line) → "Play with Log": pipe the game's stdout/stderr live (for troubleshooting
    // problematic titles) instead of the normal detached/ignored spawn.
    const onOutput = typeof opts.onOutput === 'function' ? opts.onOutput : null;
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
    if (!game)           throw new Error(`Game "${gameId}" not found in Installer database.`);
    if (!game.installed) throw new Error(`"${game.title}" is not marked as installed.`);

    // Parse per-game custom environment variables (KEY=VALUE, one per line)
    const customEnv = {};
    for (const line of (game.custom_env || '').split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) customEnv[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }

    const prefix = prefixPathForGame(game);
    const proton = resolveProton(game);

    fs.mkdirSync(prefix, { recursive: true });

    const installPath = expandTilde(game.install_path || '');
    // launch_target overrides the stored executable (e.g. alternate exe from playTasks)
    // resolvePathCaseInsensitive handles GOG manifests declaring wrong casing (e.g. DOOM3.exe → Doom3.exe)
    const resolvedExe = resolvePathCaseInsensitive((() => {
        if (game.custom_exe) return expandTilde(game.custom_exe);
        if (!installPath) return '';
        // opts.executable is a one-off override chosen at the moment of pressing Play,
        // which engine to run a game on, when its folder holds more than one.
        const rel = opts.executable || game.launch_target || game.executable;
        return rel ? path.join(installPath, ...rel.replace(/\\/g, '/').split('/')) : '';
    })());

    // The active playTask from goggame-*.info (GOG only), it carries both the launch
    // arguments and the working directory the game expects to be started from. Resolved
    // through the same helper the pickers use, so what the gamepage says will start is
    // exactly what starts, mission packs included.
    const gogTask = activeGogPlayTask(game, gogPlayTaskList(game));

    // Put back the config files GOG's installer would have copied out of gog-support/.
    // Early, because everything below, the arguments, the working directory, the DOSBox
    // decision, assumes those files are where the game expects them.
    if (game.store === 'gog' && installPath && game.app_id) {
        try { applyGogSupportFiles(installPath, game.app_id); }
        catch (e) { console.error('[launch] gog-support restore failed:', e.message); }
    }

    // GOG's workingDir is not decoration: DOS games are started from their DOSBOX folder and
    // their config mounts the drive with `mount C ".."`, which only points at the game when
    // the process really is one level down. Launching from the install root instead mounted
    // the *parent* of the game folder as C:, so DOSBox came up, found no game and quit,
    // indistinguishable from a crash.
    const launchCwd = (() => {
        const rel = (gogTask?.workingDir || '').replace(/\\/g, '/').trim();
        if (!rel || !installPath) return installPath || undefined;
        const dir = resolvePathCaseInsensitive(path.join(installPath, ...rel.split('/')));
        return fs.existsSync(dir) ? dir : installPath;
    })();

    // GOG stores launch arguments in playTasks, without them mods/configs don't load.
    const gogTaskArgs = (() => {
        try {
            const task = gogTask;
            if (!task?.arguments) return [];
            // Simple shell-split that respects quoted tokens
            const args = []; let cur = ''; let inQ = false; let q = '';
            for (const ch of task.arguments.trim()) {
                if (inQ) { if (ch === q) inQ = false; else cur += ch; }
                else if (ch === '"' || ch === "'") { inQ = true; q = ch; }
                else if (ch === ' ' || ch === '\t') { if (cur) { args.push(cur); cur = ''; } }
                else cur += ch;
            }
            if (cur) args.push(cur);
            return args;
        } catch { return []; }
    })();

    // User-defined additional arguments, appended after auto-detected playTask args.
    // opts.launchArgs overrides the stored line for this launch only, which is how a
    // choice made at the moment of pressing Play (which Doom to run a mod on) reaches the
    // command line without being written back to the database.
    const argSource = opts.launchArgs !== undefined ? opts.launchArgs : game.launch_args;
    const userArgs = (() => {
        if (!argSource?.trim()) return [];
        const args = []; let cur = ''; let inQ = false; let q = '';
        for (const ch of argSource.trim()) {
            if (inQ) { if (ch === q) inQ = false; else cur += ch; }
            else if (ch === '"' || ch === "'") { inQ = true; q = ch; }
            else if (ch === ' ' || ch === '\t') { if (cur) { args.push(cur); cur = ''; } }
            else cur += ch;
        }
        if (cur) args.push(cur);
        return args;
    })();
    let allArgs = [...gogTaskArgs, ...userArgs];

    // Whether a translation layer is involved at all decides both the compat environment
    // and, below, whether a game's own shipped wrapper DLLs would be shadowed by the
    // runtime's builtins.
    const usingProton = host.runtime.inUse(proton);
    const compatEnv   = host.runtime.compatEnv(game, proton);

    // A game that ships its own opengl32.dll beside the executable gets that file on Windows,
    // where the application directory is searched first. Wine reverses this for DLLs it
    // implements itself, so the bundled one is shadowed by a modern OpenGL, and the games
    // that bundle one are 3dfx MiniGL wrappers from the nineties that cannot survive talking
    // to a modern driver. GOG's Quake ships 3dfx's "Voodoo Quake Driver" as opengl32.dll and
    // nGlide as glide2x/glide3x; GLQuake against Wine's builtin dies on a stack overflow
    // before a window ever appears, which reads to the player as "the game closed
    // immediately". Restoring Windows' own resolution order is the whole fix, and it hands
    // the game the driver stack GOG shipped it with (MiniGL → nGlide → D3D → DXVK).
    const wrappers = usingProton ? findShippedWrappers(resolvedExe, installPath) : [];
    if (wrappers.length) {
        // Entries are separated by ';', ',' separates load orders for one DLL, so a
        // comma-joined list silently sets only the first and mangles the rest.
        const already = (customEnv.WINEDLLOVERRIDES || '');
        const add = wrappers
            .map(w => w.replace(/\.dll$/, ''))
            .filter(n => !new RegExp(`\\b${n}\\b`, 'i').test(already))
            // "n,b", native first, builtin as fallback, not bare "n". These DLLs are
            // wrappers: Classic REbirth's ddraw forwards the calls it does not implement on
            // to the real one, and with only "native" allowed there is nothing to forward
            // to, so the game called through a null pointer and crashed at address zero.
            // Verified: bare n crashes in ~5s, n,b runs.
            .map(n => `${n}=n,b`);
        if (add.length) {
            const existing = already.trim().replace(/;$/, '');
            compatEnv.WINEDLLOVERRIDES = existing ? `${existing};${add.join(';')}` : add.join(';');
            console.log(`[launch] using the ${add.map(a => a.split('=')[0]).join(', ')} shipped with this game rather than Wine's`);
        }
    }

    // Fixes for one named game rather than a class of them. Settings are written once and
    // then respected; the environment is applied every launch. Both are no-ops for a game
    // with no entry, which is nearly all of them. See packages/core/game-fixes.js.
    try {
        const named = gameFixes.fixFor(resolvedExe);
        if (named) {
            const { applied } = gameFixes.applySettings(resolvedExe, installPath);
            for (const line of applied) console.log(`[launch] ${named.title}: set ${line}`);
            // Never over the user's own custom_env, someone who set a variable by hand
            // has already overruled us on purpose.
            for (const [k, v] of Object.entries(named.env || {})) {
                if (k === 'WINEDLLOVERRIDES') {
                    const have = `${customEnv.WINEDLLOVERRIDES || ''};${compatEnv.WINEDLLOVERRIDES || ''}`;
                    const missing = v.split(';').filter(e => !new RegExp(`\\b${e.split('=')[0]}\\b`, 'i').test(have));
                    if (missing.length) {
                        const base = (compatEnv.WINEDLLOVERRIDES || '').trim().replace(/;$/, '');
                        compatEnv.WINEDLLOVERRIDES = base ? `${base};${missing.join(';')}` : missing.join(';');
                    }
                } else if (!(k in customEnv)) {
                    compatEnv[k] = v;
                }
            }
        }
    } catch (e) { console.log(`[launch] per-game fix skipped: ${e.message}`); }

    // Base env: system → custom user vars → compat flags → Installer's required vars (highest
    // priority). Every spawn below builds its environment from this.
    const baseEnv = (extra = {}) => ({ ...process.env, ...customEnv, ...compatEnv, ...extra });

    // Launch Comet sidecar for GOG games (enables achievement unlocking via Galaxy SDK proxy)
    let cometProc = null;
    if (game.store === 'gog') {
        const cometBin = findComet();
        if (cometBin) {
            const userId = db.prepare("SELECT value FROM settings WHERE key='gog_user_id'").get()?.value;
            if (userId) {
                try { fs.chmodSync(cometBin, '755'); } catch {}
                const authPath = writeGogAuthConfig();
                const cometArgs = ['--from-heroic', '--credentials-path', authPath, '--user-id', userId];
                // Include per-game Galaxy client_id if available in goggame-*.info
                if (installPath && game.app_id) {
                    try {
                        const infoPath = path.join(installPath, `goggame-${game.app_id}.info`);
                        if (fs.existsSync(infoPath)) {
                            const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
                            if (info.clientId) cometArgs.push('--game-id', info.clientId);
                        }
                    } catch {}
                }
                try { cometProc = spawn(cometBin, cometArgs, { stdio: 'ignore' }); } catch {}
            }
        }
    }

    // Verbose mode: pipe the child's output to onOutput line by line. The child still gets
    // `detached: true` + unref() exactly like a normal launch, so the game keeps running (and
    // survives quitting Clarity) whether or not anyone is watching the log, piping only
    // changes where its output goes, never its lifetime.
    const streamOutput = (proc, header) => {
        onOutput(header);
        let tail = '';   // carry the partial last line across chunk boundaries
        const feed = d => {
            const parts = (tail + d).split(/\r?\n/);
            tail = parts.pop() ?? '';
            for (const l of parts) if (l) onOutput(l);
        };
        proc.stdout?.on('data', feed); proc.stderr?.on('data', feed);
        proc.on('close', c => { if (tail) onOutput(tail); onOutput(`\n[process exited, code ${c}]`); });
        proc.on('error', e => onOutput(`[spawn error] ${e.message}`));
    };

    // A normal launch is detached with its output thrown away, so a game that dies on the spot
    // (bad Proton, missing prefix, broken exe) used to be completely silent, the library just
    // sat there. Send output to a per-game file instead of /dev/null: a real fd, not a pipe, so
    // nothing can fill a buffer and the game is never hit with EPIPE once the app exits. If it
    // then exits non-zero within a few seconds we read the tail back and tell the user.
    const EARLY_EXIT_MS = 15000;
    const launchLogPath = (() => {
        try {
            const dir = path.join(configDir, 'launch_logs');
            fs.mkdirSync(dir, { recursive: true });
            return path.join(dir, sanitizeLogName(game.title || String(gameId)) + '.log');
        } catch { return ''; }
    })();

    const spawnGame = (cmd, args, o) => {
        let logFd = null;
        if (!onOutput && launchLogPath) {
            try {
                logFd = fs.openSync(launchLogPath, 'w');
                fs.writeSync(logFd, `$ ${commandLine(cmd, args)}\n\n`);
            } catch { logFd = null; }
        }
        const spawnOpts = onOutput
            ? { ...o, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }
            : (logFd !== null ? { ...o, stdio: ['ignore', logFd, logFd] } : o);
        const proc = spawn(cmd, args, spawnOpts);
        if (logFd !== null) { try { fs.closeSync(logFd); } catch {} }   // the child holds its own copy

        // ⚠️ Every launch funnels through here, which is why the session signal lives here and
        // not at the call sites. There are several of those and they drift. Both edges are
        // reported, and 'exit' fires for a crash as well as a clean quit, so nothing the face
        // holds on the strength of it can be left held forever.
        try { _onGameSession(true, { gameId, title: game.title || '' }); } catch {}
        proc.once('exit', () => { try { _onGameSession(false, { gameId, title: game.title || '' }); } catch {} });
        proc.once('error', () => { try { _onGameSession(false, { gameId, title: game.title || '' }); } catch {} });
        if (onOutput) streamOutput(proc, `$ ${commandLine(cmd, args)}\n`);
        if (cometProc) proc.once('exit', () => { try { cometProc.kill('SIGTERM'); } catch {} });

        if (!onOutput) {
            watchStartup({ proc, gameId, title: game.title || '', logPath: launchLogPath });
            const startedAt = Date.now();
            proc.once('exit', (code) => {
                if (code === 0 || code === null) return;                    // clean exit, or signalled
                if (Date.now() - startedAt > EARLY_EXIT_MS) return;         // played then quit, not our business
                let log = '';
                try { log = fs.readFileSync(launchLogPath, 'utf8').slice(-4000); } catch {}
                _onLaunchIssue({
                    gameId, title: game.title || '', code,
                    reason: diagnoseLaunchFailure(log, proton),
                    log, logPath: launchLogPath, protonPath: proton,
                });
            });
            proc.once('error', (e) => _onLaunchIssue({
                gameId, title: game.title || '', code: -1,
                reason: { code: 'SPAWN_FAILED', message: `Could not start ${path.basename(cmd)}: ${e.message}` },
                log: '', logPath: launchLogPath, protonPath: proton,
            }));
        }
        proc.unref();
        if (cometProc) cometProc.unref();
        return proc;
    };

    if (!resolvedExe || !fs.existsSync(resolvedExe)) {
        if (game.store === 'epic') {
            const legendary = findLegendary();
            if (legendary) {
                if (onOutput) {
                    const p = spawn(legendary, ['launch', game.app_id], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
                    streamOutput(p, `$ ${legendary} launch ${game.app_id}\n`);
                    p.unref();
                } else {
                    spawn(legendary, ['launch', game.app_id], { detached: true, stdio: 'ignore' }).unref();
                }
                return { ok: true, method: 'legendary' };
            }
            throw new Error('Cannot launch: exe not found, no compatibility runtime available, and legendary not found.');
        }
        throw new Error(`Executable not found: ${resolvedExe || '(not set)'}`);
    }

    // .bat files must be launched via Wine's Z: drive Windows path, Proton/wine
    // can't run .bat from a raw Linux path. Z: maps to the filesystem root.
    const isBat = resolvedExe.toLowerCase().endsWith('.bat');
    const launchExe = isBat ? host.runtime.toWindowsPath(resolvedExe) : resolvedExe;

    // A DOS game can skip Proton entirely when a native DOSBox is installed: it reads the
    // very same GOG config, so the game's own tweaks are kept and only the emulator changes.
    // Checked before the Proton gate, a DOS game handled natively must not be refused for
    // want of a Proton it is never going to use.
    //   dosbox_mode: 'auto' (default, native when present) · 'native' · 'bundled'
    const dosboxMode = String(engineSetting('dosbox_mode', 'auto') || 'auto').toLowerCase();

    // Give the game its CD back before either DOSBox route is chosen: the extra -conf goes
    // ahead of GOG's own so the disc is mounted by the time GOG's autoexec starts the game,
    // and prepending it to allArgs covers the native spawn and the bundled-under-Proton
    // fallthrough alike. A no-op for every game that has no CD image, or whose config
    // already mounts one.
    const isDosGame = isGogDosGame(game, resolvedExe);
    if (isDosGame) {
        const cdArgs = gogCdAudioConfArgs(installPath, launchCwd, allArgs);
        if (cdArgs.length) allArgs = [...cdArgs, ...allArgs];
    }

    if (dosboxMode !== 'bundled' && isDosGame) {
        const nativeDosbox = findNativeDosbox();
        if (nativeDosbox) {
            spawnGame(nativeDosbox.cmd, [...nativeDosbox.args, ...nativeDosboxArgs(allArgs)], {
                cwd: launchCwd, env: baseEnv(), detached: true, stdio: 'ignore',
            });
            return { ok: true, method: `dosbox-native (${nativeDosbox.label})` };
        }
        if (dosboxMode === 'native') {
            const hint = dosboxInstallHint();
            throw new Error(
                'No native DOSBox found. Install one' + (hint.native ? ` (\`${hint.native}\`)` : '') + ', ' +
                'or set DOSBox mode back to Automatic to use the copy GOG ships.'
            );
        }
        // 'auto' with nothing installed → fall through to GOG's bundled DOSBox via Proton.
    }

    // A build native to THIS host needs no compatibility layer at all, checked BEFORE the
    // runtime gate, or a native title would be blocked on a Proton it never uses.
    if (game.platform === host.nativeOsKey) {
        const native = host.launchNative({ exe: resolvedExe, args: userArgs });
        spawnGame(native.cmd, native.args, { cwd: launchCwd, env: baseEnv(native.env), detached: true, stdio: 'ignore' });
        return { ok: true, method: 'native' };
    }

    // Everything below runs a Windows build. A runtime that would fail invisibly is refused
    // here rather than spawned, so the face can offer to install one instead.
    host.runtime.assertAvailable(proton);

    // Per-game fix (see applyFalloutNewCaliforniaFix). Runs before the spawn so the game
    // finds its config and registry on this launch rather than the next one, and is
    // self-healing: a prefix that gets rebuilt is re-seeded automatically. It must never
    // be the reason a launch fails, hence the catch.
    if (isFalloutNewCalifornia(game) && installPath) {
        try { await applyFalloutNewCaliforniaFix(installPath, prefix, proton); }
        catch (e) { console.error('[launch] New California fix failed:', e.message); }
    }

    // Awaited so a host whose runtime needs a real async step before it can launch anything
    // (CrossOver: creating the game's bottle, first time only) isn't forced into blocking the
    // whole process synchronously to do it. A no-op for Linux, whose buildLaunch is plain sync.
    const spec = await host.runtime.buildLaunch({
        game, gameId, launchExe, isBat, userArgs, allArgs, runtimePath: proton, prefix,
    });
    spawnGame(spec.cmd, spec.args, { cwd: launchCwd, env: baseEnv(spec.env), detached: true, stdio: 'ignore' });
    return { ok: true, method: spec.method };
}

function runLegendary(args) {
    const leg = findLegendary();
    if (!leg) return Promise.resolve({ ok: false, error: 'legendary not found' });
    return new Promise(resolve => {
        let out = '', err = '';
        const proc = spawn(leg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        proc.stdout.on('data', d => out += d);
        proc.stderr.on('data', d => err += d);
        proc.on('close', code => resolve({ ok: code === 0, stdout: out, stderr: err, code }));
        proc.on('error', e => resolve({ ok: false, error: e.message }));
    });
}

async function getGameInstallInfo(appName) {
    const r = await runLegendary(['list-installed', '--json']);
    if (!r.ok) return null;
    try {
        const all = JSON.parse(r.stdout);
        return all.find(g => g.app_name === appName) || null;
    } catch { return null; }
}

async function runRedist(sender, channel, appId, platform, prefixPath, protonPath) {
    const gogdl = findGogdl();
    if (!gogdl) return { ok: false, error: 'gogdl not found.' };
    try { fs.chmodSync(gogdl, '755'); } catch {}
    const sendLine = d => { try { sender.send(channel, { line: String(d) }); } catch {} };
    const sendDone = (ok, msg) => { try { sender.send(channel, { done: true, ok, msg }); } catch {} };
    const send = sendLine;
    const authPath = writeGogAuthConfig();

    send('Checking game dependencies...\n');
    let depIds = '';
    try {
        const infoOut = await new Promise((res, rej) => {
            let out = '';
            const p = spawn(gogdl, ['--auth-config-path', authPath, 'info', appId, '--platform', platform],
                { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GOGDL_CONFIG_PATH: configDir } });
            p.stdout.on('data', d => out += d);
            p.stderr.on('data', d => out += d);
            p.on('close', () => res(out));
            p.on('error', rej);
        });
        const jsonLine = infoOut.split('\n').find(l => l.trim().startsWith('{'));
        const info = JSON.parse(jsonLine);
        const deps = (info.dependencies || []).filter(Boolean);
        depIds = deps.join(',');
    } catch {}

    if (!depIds) {
        try { fs.unlinkSync(authPath); } catch {}
        sendDone(true, 'No compatibility files required for this game.');
        return { ok: true, installed: 0 };
    }

    send(`Dependencies: ${depIds}\nDownloading compatibility files...\n`);

    const redistDir = path.join(configDir, 'redist');
    try { fs.mkdirSync(redistDir, { recursive: true }); } catch {}

    const dlCode = await new Promise(resolve => {
        const p = spawn(gogdl, ['--auth-config-path', authPath, 'redist', '--ids', depIds, '--path', redistDir],
            { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GOGDL_CONFIG_PATH: configDir } });
        p.stdout.on('data', send);
        p.stderr.on('data', send);
        p.on('close', resolve);
        p.on('error', () => resolve(1));
    });
    try { fs.unlinkSync(authPath); } catch {}
    if (dlCode !== 0) { sendDone(false, `Download failed (exit ${dlCode})`); return { ok: false }; }

    const manifestPath = path.join(redistDir, '.gogdl-redist-manifest');
    let depots = [];
    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const idSet = new Set(depIds.split(',').map(s => s.trim()));
        depots = (manifest.depots || []).filter(d => idSet.has(d.dependencyId) && d.executable?.path);
    } catch (e) {
        sendDone(false, 'Could not read redist manifest: ' + e.message);
        return { ok: false };
    }

    if (!depots.length) {
        sendDone(true, 'No installers found in manifest.');
        return { ok: true, installed: 0 };
    }

    // Same resolution as launching, so redists install on a machine where Proton was never
    // configured by hand but a build is present on disk.
    const resolvedProton = resolveProton({ proton_path: protonPath });
    const prefix = expandTilde(prefixPath);

    if (!host.runtime.canRun(resolvedProton)) {
        sendDone(false, host.runtime.redistUnavailableMessage);
        return { ok: false };
    }

    let installed = 0;
    for (const depot of depots) {
        const exeRel = depot.executable.path.split('/').join(path.sep);
        const exePath = path.join(redistDir, exeRel);
        const exeArgs = (depot.executable.arguments || '').trim().split(/\s+/).filter(Boolean);
        if (!fs.existsSync(exePath)) { send(`⚠ Missing installer: ${exeRel}\n`); continue; }
        send(`Installing ${path.basename(exePath)} (${depot.dependencyId})...\n`);
        const { cmd, args, env: runEnv } = await host.runtime.buildRedistLaunch({
            exePath, exeArgs, prefix, runtimePath: resolvedProton,
        });
        await new Promise(res => {
            const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: runEnv, cwd: redistDir });
            p.stdout.on('data', send);
            p.stderr.on('data', send);
            p.on('close', () => res());
            p.on('error', e => { send(`Error: ${e.message}\n`); res(); });
        });
        installed++;
    }
    sendDone(true, `Installed ${installed} compatibility package(s).`);
    return { ok: true, installed };
}

async function injectGogRegistry(game, prefix, proton) {
    const installPath = expandTilde(game.install_path || '');
    if (!installPath || !game.app_id) return;
    if (!(game.store || '').toLowerCase().includes('gog')) return;

    const appId   = String(game.app_id);
    const winPath = host.runtime.toWindowsPath(installPath);
    const escaped = winPath.replace(/\\/g, '\\\\');

    const regContent =
        'Windows Registry Editor Version 5.00\r\n\r\n' +
        `[HKEY_LOCAL_MACHINE\\SOFTWARE\\GOG.com\\Games\\${appId}]\r\n` +
        `"path"="${escaped}"\r\n` +
        `"gameID"="${appId}"\r\n` +
        `"productID"="${appId}"\r\n\r\n` +
        `[HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\${appId}]\r\n` +
        `"path"="${escaped}"\r\n` +
        `"gameID"="${appId}"\r\n` +
        `"productID"="${appId}"\r\n`;

    const regFile = path.join(os.tmpdir(), `gog_reg_${appId}.reg`);
    fs.writeFileSync(regFile, regContent, 'utf8');

    const reg = await host.runtime.regeditCommand({ prefix, runtimePath: proton, regFile });

    await new Promise(resolve => {
        const proc = spawn(reg.cmd, reg.args, { env: reg.env, stdio: 'ignore' });
        proc.on('close', () => { try { fs.unlinkSync(regFile); } catch {} resolve(); });
        proc.on('error', () => { try { fs.unlinkSync(regFile); } catch {} resolve(); });
    });
}

// ── Per-game fix: Fallout: New California (GOG 1168267909) ───────────────────
// ── GOG bonus manuals ────────────────────────────────────────────────────────
// GOG sells the extras alongside the game, manuals, cluebooks, reference cards, and
// exposes them through the same authenticated API Installer already uses for installs. They
// are the scanned originals, so a game whose folder ships nothing can still get its manual.
//
// Two categories are worth offering. "manuals" is the obvious one; "guides & reference" is
// where GOG files cluebooks and the reference cards RPGs of that era shipped in the box.
// Everything else it serves (wallpapers, soundtracks, avatars) is not reading material.
const GOG_MANUAL_TYPES = ['manuals', 'guides & reference'];

async function gogListManuals(appId) {
    const token = await getGogToken();
    if (!token) return { ok: false, error: 'Not signed in to GOG.' };
    try {
        const data = await gogFetch(`https://api.gog.com/products/${appId}?expand=downloads`, token);
        const bonus = data?.downloads?.bonus_content || [];
        const items = bonus
            .filter(b => GOG_MANUAL_TYPES.includes(String(b.type || '').toLowerCase()))
            .map(b => ({
                id: b.id,
                name: b.name || b.type,
                type: b.type,
                size: b.total_size || 0,
                downlink: (b.files || [])[0]?.downlink || '',
            }))
            .filter(b => b.downlink);
        return { ok: true, items };
    } catch (e) { return { ok: false, error: e.message }; }
}

// Download one bonus item and hand back the documents inside it. GOG serves these as ZIPs
// even when the payload is a single PDF, so the archive is unpacked and thrown away,
// what the library ends up pointing at is a plain readable file.
async function gogDownloadManual(appId, bonusId, destDir, onProgress) {
    const token = await getGogToken();
    if (!token) return { ok: false, error: 'Not signed in to GOG.' };

    let url;
    try {
        const list = await gogListManuals(appId);
        if (!list.ok) return list;
        const item = list.items.find(i => String(i.id) === String(bonusId));
        if (!item) return { ok: false, error: 'That download is no longer offered for this game.' };
        const res = await gogFetch(item.downlink, token);
        url = res?.downlink;
    } catch (e) { return { ok: false, error: e.message }; }
    if (!url) return { ok: false, error: 'GOG did not return a download link.' };

    fs.mkdirSync(destDir, { recursive: true });
    const tmp = path.join(destDir, `.download-${bonusId}.tmp`);
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
        const total = Number(res.headers.get('content-length') || 0);
        const chunks = []; let got = 0;
        for await (const c of res.body) {
            chunks.push(c); got += c.length;
            if (onProgress) { try { onProgress(got, total); } catch {} }
        }
        fs.writeFileSync(tmp, Buffer.concat(chunks));
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch {}
        return { ok: false, error: e.message };
    }

    // Zip or not is decided by the file's own magic bytes, never by whether the unpacker
    // threw: a failing unpacker on a real archive would otherwise be "handled" by saving
    // the archive under a .pdf name, which looks like success and opens as garbage.
    let isZip = false;
    try {
        const fd = fs.openSync(tmp, 'r');
        const head = Buffer.alloc(2);
        fs.readSync(fd, head, 0, 2, 0);
        fs.closeSync(fd);
        isZip = head[0] === 0x50 && head[1] === 0x4B;   // "PK"
    } catch {}

    const out = [];
    if (isZip) {
        try {
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(tmp);
            for (const entry of zip.getEntries()) {
                if (entry.isDirectory) continue;
                const base = path.basename(entry.entryName);
                if (!/\.(pdf|html?|txt)$/i.test(base)) continue;
                const dst = path.join(destDir, base);
                fs.writeFileSync(dst, entry.getData());
                out.push({ path: dst, label: path.basename(base, path.extname(base)) });
            }
        } catch (e) {
            try { fs.unlinkSync(tmp); } catch {}
            return { ok: false, error: `Could not unpack GOG's archive: ${e.message}` };
        }
    } else {
        // GOG occasionally serves the document directly rather than zipped.
        try {
            const dst = path.join(destDir, `manual-${bonusId}.pdf`);
            fs.renameSync(tmp, dst);
            return { ok: true, files: [{ path: dst, label: 'Manual' }] };
        } catch (e) { return { ok: false, error: e.message }; }
    }
    try { fs.unlinkSync(tmp); } catch {}

    if (!out.length) return { ok: false, error: 'That download contained no readable document.' };
    return { ok: true, files: out };
}

// ── Native DOSBox for GOG's DOS games ────────────────────────────────────────
// GOG ships a Windows DOSBox 0.74 from 2010 and runs it through Proton: an emulator inside
// a translation layer, when the host can run the emulator directly. A native build is
// faster, gets working sound and fullscreen without Proton's help, and is still maintained.
//
// The reason this is even possible is that GOG's per-game .conf files are ordinary DOSBox
// configuration, the same format a native build reads, and their paths are relative:
//
//     [autoexec]
//     mount C ".."
//     c:
//     intro
//     bladem
//
// So every tweak GOG made for the game (cycles, machine type, sound cards, the autoexec
// that actually starts it) is preserved exactly. We change what runs the config, not the
// config. Nothing is rewritten on disk.
//
// WHICH native DOSBox, and how a person installs one, is the host's business, see the
// platform backend. Everything above is about GOG's own files and is true everywhere.

// Installer's own settings table, read the same way the GOG credentials are.
function engineSetting(key, fallback = null) {
    try { return db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value ?? fallback; }
    catch { return fallback; }
}

// { cmd, args, label } or null, args is non-empty only for a sandboxed form (Flatpak).
const findNativeDosbox  = () => host.dosbox.find();
const dosboxInstallHint = () => host.dosbox.installHint();

// A GOG DOS game is one whose launch target is the bundled DOSBox.
function isGogDosGame(game, resolvedExe) {
    if ((game?.store || '').toLowerCase() !== 'gog') return false;
    const rel = String(game.launch_target || game.executable || '').replace(/\\/g, '/').toLowerCase();
    if (/(^|\/)dosbox\/dosbox\.exe$/.test(rel)) return true;
    return /(^|\/)dosbox\.exe$/i.test(String(resolvedExe || '').replace(/\\/g, '/'));
}

// GOG's Windows DOSBox invocation, translated for whatever native build this host has.
const nativeDosboxArgs = (gogArgs) => host.dosbox.translateArgs(gogArgs);

// ── CD audio for GOG's DOS games ─────────────────────────────────────────────
// A lot of GOG's classic releases ship the original disc as a CD image beside the game,
// a cue sheet plus its binary, where the binary is renamed .gog so nobody burns it. When
// the disc carried redbook audio, that image is the only copy of the soundtrack in the
// release, and the game plays its music from the CD or not at all.
//
// GOG usually mounts it themselves. Albion's config does it once, at the top:
//
//     imgmount d "..\game.ins" -t iso -fs iso
//
// Quake's does it per campaign, inside the launcher menu in dosbox_quake_single.conf
// (:quake → game.cue, :mp1 → gamea.cue, :mp2 → gamed.cue). Both are detected and both
// are left completely alone. This exists for the releases where they did not bother, and
// as of today it fires for nothing in the tested library. That is the intended resting
// state, not a bug. Verify against the real .conf before concluding a game needs it:
// they are ISO-8859 with CRLF, so plain grep calls them binary and prints nothing (use
// grep -a), and GOG passes a second -conf that plain dosbox_<game>.conf gives no hint of.
//
// Nothing of GOG's is edited. DOSBox accepts repeated -conf and concatenates the
// [autoexec] blocks in the order given, so a generated overlay config passed *before*
// GOG's own runs its imgmount first and GOG's autoexec still starts the game. Every
// setting in GOG's config wins, because a later -conf overrides an earlier one.
//
// Paths inside are relative and backslashed, the same convention GOG's own configs use,
// DOSBox rewrites those separators for the host, so one file serves both the native
// binary and the bundled Windows DOSBox under Proton.
const CD_AUDIO_CONF = 'dosbox_clarity_cdaudio.conf';

// Cue sheets are plain text. All we need is whether any track is audio: a data-only image
// (Albion's is a lone MODE2/2352 track) has no soundtrack to recover and is left alone.
function cueAudioTrackCount(text) {
    return (String(text).match(/^\s*TRACK\s+\d+\s+AUDIO\s*$/gim) || []).length;
}

// Depth-1 scan of the install root for cue sheets carrying audio, newest convention first.
// .ins is GOG's older name for the same thing; .cue is what current releases use. Both are
// verified against the binary they name, so a stray sheet without its image is skipped.
// Alphabetical order happens to be disc order for the releases that ship several
// (game.cue, gamea.cue, gamed.cue → Quake, Mission Pack 1, Mission Pack 2).
function findGogCdAudioImages(installPath) {
    let entries = [];
    try { entries = fs.readdirSync(installPath, { withFileTypes: true }); } catch { return []; }

    const out = [];
    for (const e of entries) {
        if (!e.isFile() || !/\.(cue|ins)$/i.test(e.name)) continue;
        const full = path.join(installPath, e.name);
        let text = '';
        try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }

        const tracks = cueAudioTrackCount(text);
        if (!tracks) continue;

        // The sheet is useless without the binary it points at, and GOG's casing is not
        // dependable (FILE "GAME.GOG" against game.gog on disk).
        const named = (text.match(/^\s*FILE\s+"([^"]+)"/im) || [, ''])[1];
        if (named && !fs.existsSync(resolvePathCaseInsensitive(path.join(installPath, named)))) continue;

        out.push({ name: e.name, path: full, audioTracks: tracks });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

// The .conf files GOG's launch command names, resolved against the working directory the
// game actually starts from, the paths in those arguments are relative to it.
function gogConfPaths(gogArgs, launchCwd) {
    const out = [];
    for (let i = 0; i < gogArgs.length; i++) {
        if (gogArgs[i] !== '-conf' || gogArgs[i + 1] === undefined) continue;
        const rel = gogArgs[++i].replace(/\\/g, '/');
        const p = resolvePathCaseInsensitive(path.resolve(launchCwd, rel));
        if (fs.existsSync(p)) out.push(p);
    }
    return out;
}

// Drive letters the game's own configs already claim, so the CD lands somewhere free.
// Both commands take the letter as their first argument: `mount c ".."`, `imgmount d …`.
function driveLettersInUse(confTexts) {
    const used = new Set();
    for (const t of confTexts) {
        for (const m of String(t).matchAll(/^\s*(?:img)?mount\s+([a-z])\b/gim)) used.add(m[1].toLowerCase());
    }
    return used;
}

// Build the overlay and return the -conf arguments to prepend, or [] when there is
// nothing to do. Never throws: a game that would have launched without music must not
// fail to launch because of this.
function gogCdAudioConfArgs(installPath, launchCwd, gogArgs) {
    try {
        if (!installPath || !launchCwd) return [];

        const images = findGogCdAudioImages(installPath);
        if (!images.length) return [];

        const confs = gogConfPaths(gogArgs, launchCwd);
        const texts = confs.map(p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } });

        // GOG already mounts a disc for this game (Albion, and every release where they
        // bothered), leave it entirely alone. Mounting a second copy would only shift
        // the drive letters the game was configured against.
        if (texts.some(t => /^\s*imgmount\s/im.test(t))) return [];

        // D upwards. X and Y are skipped: dosbox-staging auto-mounts its own drives there,
        // and Z is DOSBox's internal drive on every build.
        const used = driveLettersInUse(texts);
        const letter = 'defghijklmnopqrstuvw'.split('').find(l => !used.has(l));
        if (!letter) return [];

        // Relative to the working directory, exactly like GOG writes its own paths, so the
        // same file works under a native DOSBox and under the Windows one via Proton.
        const rel = p => path.relative(launchCwd, p).replace(/\//g, '\\');
        const discs = images.map(i => `"${rel(i.path)}"`).join(' ');
        const body =
            `# Generated by Clarity, regenerated on every launch, edits will be lost.\n` +
            `# Mounts the CD image(s) GOG ships with this game so its soundtrack plays.\n` +
            (images.length > 1 ? `# Several discs on one letter: press Ctrl+F4 in DOSBox to swap.\n` : '') +
            `\n[autoexec]\n` +
            `imgmount ${letter} ${discs} -t iso -fs iso\n`;

        const confPath = path.join(installPath, CD_AUDIO_CONF);
        let existing = null;
        try { existing = fs.readFileSync(confPath, 'utf8'); } catch {}
        if (existing !== body) fs.writeFileSync(confPath, body, 'utf8');

        console.log(
            `[launch] CD audio: mounting ${images.map(i => `${i.name} (${i.audioTracks} audio tracks)`).join(', ')} ` +
            `on ${letter.toUpperCase()}:`
        );
        return ['-conf', rel(confPath)];
    } catch (e) {
        console.error('[launch] CD audio setup failed:', e.message);
        return [];
    }
}

// ── gog-support/<appId>/app → the install root ───────────────────────────────
// The generic half of the .script problem. GOG stages a game's shipped config files under
// gog-support/<appId>/app/ and its installer copies them into the game folder; gogdl
// downloads the depot and stops there, so those files are simply absent afterwards.
//
// DOS games are where this bites hardest, because their whole launch depends on it:
// Realms of Arkania is started as `dosbox.exe -conf "..\dosbox_realms1.conf" …` and that
// conf only ever existed under gog-support, so DOSBox opened with no configuration and
// exited on the spot. Blade of Destiny, Star Trail and Albion all fail this way.
//
// Only plain files, only one level, and only where nothing of that name is already in
// place, after the first run these hold the player's own settings (screen mode, sound,
// cycles), and re-copying them on every launch would quietly undo their choices. Unlike
// running .script itself, which can execute bundled .exe files, copying a config is safe
// to do for every GOG game rather than one title at a time.
function applyGogSupportFiles(installPath, appId) {
    if (!installPath || !appId) return 0;
    const appDir = path.join(installPath, 'gog-support', String(appId), 'app');
    let entries = [];
    try { entries = fs.readdirSync(appDir, { withFileTypes: true }); } catch { return 0; }

    let copied = 0;
    for (const e of entries) {
        if (!e.isFile()) continue;
        const src = path.join(appDir, e.name);
        const dst = path.join(installPath, e.name);
        if (fs.existsSync(resolvePathCaseInsensitive(dst))) continue;
        try {
            fs.copyFileSync(src, dst);
            fs.chmodSync(dst, 0o644);   // the game and GOGDOSConfig rewrite these
            copied++;
        } catch {}
    }
    if (copied) console.log(`[launch] restored ${copied} GOG support file(s) into ${installPath}`);
    return copied;
}

// GOG ships post-install steps in goggame-<id>.script, registry values, plus config
// files copied out of the game's own gog-support/ folder, that only Galaxy's installer
// performs. gogdl downloads the depot and nothing else, so a title that depends on those
// steps installs perfectly and then misbehaves. We deliberately don't run .script
// generically (its actions include executing bundled .exe files), so affected titles are
// fixed here one at a time. So far that is exactly one.
//
// New California is a standalone total conversion that bundles Fallout: New Vegas.
// Without the .script steps three things go wrong, in sequence:
//   • No FalloutPrefs.ini in My Games\FalloutNV → FalloutNV.exe hands off to
//     FalloutNVLauncher.exe instead of starting the game.
//   • No "Installed Path" under HKLM\Software\Bethesda Softworks\FalloutNV → that
//     launcher decides New Vegas isn't installed and offers to install it from a
//     DVD-ROM drive that doesn't exist. This is the dead end the player actually hits.
//   • No plugins.txt in AppData\Local\FalloutNV → New California's plugins never load,
//     so even a game that did start would be plain New Vegas.
const FNC_APP_ID = '1168267909';

// gog-support/<appId>/<source> → <windows user dir>/<destination>, mirroring the
// supportData actions in goggame-1168267909.script.
const FNC_SUPPORT_FILES = [
    ['docs/Fallout.ini',      'Documents/My Games/FalloutNV/Fallout.ini'],
    ['docs/FalloutPrefs.ini', 'Documents/My Games/FalloutNV/FalloutPrefs.ini'],
    ['appdata/plugins.txt',   'AppData/Local/FalloutNV/plugins.txt'],
];

function isFalloutNewCalifornia(game) {
    return (game?.store || '').toLowerCase() === 'gog' && String(game?.app_id) === FNC_APP_ID;
}

async function applyFalloutNewCaliforniaFix(installPath, prefix, proton) {
    const support = path.join(installPath, 'gog-support', FNC_APP_ID);
    if (!fs.existsSync(support)) return;   // not the GOG build these fixes describe

    // Seed config into every real user directory in the prefix: Proton runs games as
    // `steamuser`, while a prefix built by bare wine uses the unix login name. Only files
    // that are genuinely absent get written, after the first run these hold the player's
    // own settings, and re-copying them every launch would reset the game each time.
    const usersRoot = path.join(prefix, 'drive_c', 'users');
    let userDirs = [];
    try {
        userDirs = fs.readdirSync(usersRoot, { withFileTypes: true })
            .filter(e => e.isDirectory() && e.name !== 'Public')
            .map(e => path.join(usersRoot, e.name));
    } catch {}
    if (!userDirs.length) userDirs = [path.join(usersRoot, 'steamuser')];

    for (const userDir of userDirs) {
        for (const [from, to] of FNC_SUPPORT_FILES) {
            const src = path.join(support, ...from.split('/'));
            const dst = path.join(userDir, ...to.split('/'));
            // Case-insensitive check: the game writes FALLOUT.INI, which on a
            // case-sensitive filesystem is a different name from the Fallout.ini we would
            // copy, leaving wine two files to pick between.
            if (!fs.existsSync(src) || fs.existsSync(resolvePathCaseInsensitive(dst))) continue;
            try {
                fs.mkdirSync(path.dirname(dst), { recursive: true });
                fs.copyFileSync(src, dst);
                fs.chmodSync(dst, 0o644);   // the game rewrites these as it runs
            } catch {}
        }
    }

    // Reading system.reg directly keeps the common case free: once the value is in the
    // prefix we never spawn wine for this again. A missing system.reg means the prefix was
    // never built, runRedist returns early for a game GOG lists no dependencies for, so
    // this is reachable on a first launch, and we go ahead and let wine create it rather
    // than skip, or the player meets the launcher's dead end exactly once before it heals.
    const systemReg = path.join(prefix, 'system.reg');
    const prefixBuilt = fs.existsSync(systemReg);
    if (prefixBuilt) {
        try {
            if (fs.readFileSync(systemReg, 'utf8').includes('Bethesda Softworks\\\\FalloutNV')) return;
        } catch { return; }
    }

    // Trailing backslash matches the {app}\ GOG writes. FalloutNV.exe and its launcher are
    // both 32-bit, so on a win64 prefix they read HKLM\Software through the WoW64 view,
    // the Wow6432Node copy is the one they actually see.
    const winPath = host.runtime.toWindowsPath(installPath) + '\\';
    const escaped = winPath.replace(/\\/g, '\\\\');

    const regContent =
        'Windows Registry Editor Version 5.00\r\n\r\n' +
        '[HKEY_LOCAL_MACHINE\\SOFTWARE\\Bethesda Softworks\\FalloutNV]\r\n' +
        `"Installed Path"="${escaped}"\r\n\r\n` +
        '[HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Bethesda Softworks\\FalloutNV]\r\n' +
        `"Installed Path"="${escaped}"\r\n`;

    const regFile = path.join(os.tmpdir(), `fnc_reg_${FNC_APP_ID}.reg`);
    try { fs.writeFileSync(regFile, regContent, 'utf8'); } catch { return; }

    // The runtime's own wine, same as injectGogRegistry. It runs outside umu's container,
    // which is what lets regedit read a file from the host's /tmp at all.
    const reg = await host.runtime.regeditCommand({ prefix, runtimePath: proton, regFile });

    await new Promise(resolve => {
        const finish = () => { try { fs.unlinkSync(regFile); } catch {} resolve(); };
        const proc = spawn(reg.cmd, reg.args, { env: reg.env, stdio: 'ignore' });
        // A wedged wine must never hold the game hostage, give up and launch anyway. Merging
        // into a built prefix takes seconds; building one from scratch is a wineboot, so don't
        // pull the plug on that half way through.
        const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} finish(); },
                                 prefixBuilt ? 30000 : 180000);
        proc.on('close', () => { clearTimeout(timer); finish(); });
        proc.on('error', () => { clearTimeout(timer); finish(); });
    });
}

async function gogFetch(url, token) {
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'Installer/1.0' },
    });
    if (!res.ok) throw new Error(`GOG API ${res.status}: ${url}`);
    return res.json();
}

async function getGogToken() {
    const get = k => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
    const access  = get('gog_access_token');
    const refresh = get('gog_refresh_token');
    const expiry  = parseInt(get('gog_token_expiry') || '0');

    if (!refresh) return null;
    if (access && Date.now() < expiry - 60000) return access;

    try {
        const res = await fetch('https://auth.gog.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id:     GOG_CLIENT_ID,
                client_secret: GOG_CLIENT_SECRET,
                grant_type:    'refresh_token',
                refresh_token: refresh,
            }).toString(),
        });
        const data = await res.json();
        if (!data.access_token) return null;
        const set = (k, v) => db.prepare("INSERT OR REPLACE INTO settings VALUES (?,?)").run(k, v);
        set('gog_access_token', data.access_token);
        set('gog_token_expiry', String(Date.now() + data.expires_in * 1000));
        if (data.refresh_token) set('gog_refresh_token', data.refresh_token);
        return data.access_token;
    } catch { return null; }
}

function writeGogAuthConfig() {
    const get    = k => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value || '';
    const expiry = parseInt(get('gog_token_expiry') || '0');
    // gogdl expects the Heroic auth format: keyed by client_id
    const authPath = path.join(configDir, 'gogdl_auth.json');
    fs.writeFileSync(authPath, JSON.stringify({
        [GOG_CLIENT_ID]: {
            access_token:  get('gog_access_token'),
            refresh_token: get('gog_refresh_token'),
            user_id:       get('gog_user_id'),
            token_type:    'Bearer',
            expires_in:    Math.max(0, Math.floor((expiry - Date.now()) / 1000)),
            loginTime:     Math.floor((expiry - 3600000) / 1000),
        }
    }));
    return authPath;
}

// ── Headless sign-in ────────────────────────────────────────────────────────────
// The interactive OAuth window is owned by the calling face's main process; these
// functions take the extracted auth code and do the token exchange / CLI auth. That
// lets GOG and Epic sign-in work identically whether it happens inside Installer or
// headlessly from the Manager / Couch, so the average user never has to open the
// Installer GUI to connect their stores.

// Exchange a GOG OAuth `code` for tokens, persist them in library.db and return the
// signed-in account name. Mirrors Installer's gog-login handler.
async function gogExchangeCode(code) {
    if (!db) return { ok: false, error: 'Installer database not available.' };
    try {
        const res = await fetch('https://auth.gog.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id:     GOG_CLIENT_ID,
                client_secret: GOG_CLIENT_SECRET,
                grant_type:    'authorization_code',
                code,
                redirect_uri:  GOG_REDIRECT_URI,
            }).toString(),
        });
        const data = await res.json();
        if (!data.access_token) return { ok: false, error: `No token returned: ${JSON.stringify(data)}` };
        const set = (k, v) => db.prepare("INSERT OR REPLACE INTO settings VALUES (?,?)").run(k, v);
        set('gog_access_token',  data.access_token);
        set('gog_refresh_token', data.refresh_token);
        set('gog_token_expiry',  String(Date.now() + data.expires_in * 1000));
        let username = null;
        try {
            const user = await gogFetch('https://embed.gog.com/userData.json', data.access_token);
            if (user.userId) set('gog_user_id', String(user.userId));
            username = user.username || null;
        } catch {}
        return { ok: true, username };
    } catch (e) { return { ok: false, error: e.message }; }
}

// Current GOG sign-in state (refreshes the access token if it has expired).
async function gogStatus() {
    const token = await getGogToken();
    if (!token) return { loggedIn: false };
    try {
        const user = await gogFetch('https://embed.gog.com/userData.json', token);
        return { loggedIn: true, username: user.username || null };
    } catch { return { loggedIn: false }; }
}

// Drop stored GOG tokens (sign out).
function gogLogout() {
    if (!db) return { ok: false };
    try {
        for (const k of ['gog_access_token', 'gog_refresh_token', 'gog_token_expiry', 'gog_user_id'])
            db.prepare("DELETE FROM settings WHERE key=?").run(k);
        return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
}

// Hand an Epic OAuth `code` to legendary so it stores its own credentials.
async function epicAuthCode(code) {
    const leg = findLegendary();
    if (!leg) return { ok: false, error: 'legendary not found.' };
    const r = await runLegendary(['auth', '--code', code]);
    return { ok: r.ok, error: r.ok ? null : (r.stderr || r.error || 'legendary auth failed.') };
}

// Current Epic sign-in state (via legendary status). Mirrors Installer's legendary-status.
async function epicStatus() {
    const r = await runLegendary(['status']);
    if (!r.ok && r.error) return { loggedIn: false, error: r.error };
    const text     = (r.stdout || '') + (r.stderr || '');
    const loggedIn = !text.includes('<not logged in>');
    const account  = text.match(/Epic account:\s*(.+)/)?.[1]?.trim() || null;
    const games    = parseInt(text.match(/Games available:\s*(\d+)/)?.[1] || '0');
    return { loggedIn, account: loggedIn ? account : null, games };
}

// Headless owned-library refresh. Pulls the full owned-games list from the GOG
// and Epic store APIs into library.db (installed=0 = imported, NOT installed), so
// any face can pick up newly-purchased titles without opening the Installer GUI.
// Mirrors Installer's legendary-list-owned/legendary-import + gog-list-owned/gog-import,
// but does list+import in one pass (no interactive picker). Returns per-store
// { loggedIn, total, added, error }.
async function syncOwnedLibrary() {
    const result = {
        epic: { loggedIn: false, total: 0, added: 0, removed: 0, removedIds: [], error: null },
        gog:  { loggedIn: false, total: 0, added: 0, removed: 0, removedIds: [], error: null },
    };
    if (!db) return result;

    // Drop store rows the user no longer owns (refunds/removals). Only NOT-installed rows
    // are pruned, a still-installed title is left alone so its on-disk files are never
    // orphaned. Guarded by the caller on a non-empty owned list. Returns the removed installer
    // ids (store_appid) so the caller can drop the matching Clarity library rows too.
    const pruneUnowned = (store, ownedSet) => {
        const removedIds = [];
        const rows = db.prepare("SELECT id, app_id FROM games WHERE store=? AND installed=0").all(store);
        const del  = db.prepare("DELETE FROM games WHERE store=? AND app_id=? AND installed=0");
        db.transaction(() => {
            for (const r of rows) if (!ownedSet.has(String(r.app_id))) { del.run(store, r.app_id); removedIds.push(r.id); }
        })();
        return removedIds;
    };

    // ── Epic (legendary) ──────────────────────────────────────────────────────
    if (findLegendary()) {
        const r = await runLegendary(['list', '--json']);
        if (r.ok) {
            try {
                const all = JSON.parse(r.stdout || '[]');
                result.epic.loggedIn = true;
                result.epic.total = all.length;
                const stmt = db.prepare(`
                    INSERT OR IGNORE INTO games (id, title, store, app_id, install_path, executable, installed, version)
                    VALUES (?, ?, 'epic', ?, ?, ?, 0, ?)
                `);
                const tx = db.transaction(list => {
                    let n = 0;
                    for (const g of list) {
                        const title = g.app_title || g.metadata?.title || 'Unknown';
                        const info = stmt.run('epic_' + g.app_name, title, g.app_name, null, null, null);
                        if (info.changes) n++;
                    }
                    return n;
                });
                result.epic.added = tx(all);
                // legendary always lists the FULL owned set → a non-empty list means we can
                // safely prune Epic titles that dropped out of it (refunds/revoked keys).
                if (all.length) {
                    result.epic.removedIds = pruneUnowned('epic', new Set(all.map(g => String(g.app_name))));
                    result.epic.removed = result.epic.removedIds.length;
                }
            } catch { result.epic.error = 'Failed to parse legendary output.'; }
        } else {
            // Not logged in / legendary error, surface quietly (loggedIn stays false).
            result.epic.error = (r.error || r.stderr || '').trim() || 'Not logged in to Epic.';
        }
    }

    // ── GOG ────────────────────────────────────────────────────────────────────
    const token = await getGogToken();
    if (token) {
        result.gog.loggedIn = true;
        try {
            const owned = await gogFetch('https://embed.gog.com/user/data/games', token);
            const ids   = owned.owned || [];
            result.gog.total = ids.length;
            const games = [];
            for (let i = 0; i < ids.length; i += 50) {
                const batch = ids.slice(i, i + 50).join(',');
                const data  = await gogFetch(`https://api.gog.com/products?ids=${batch}&expand=downloads`, token);
                const items = Array.isArray(data) ? data : [data];
                for (const item of items) {
                    if (!item?.id) continue;
                    // GOG's public catalog API calls a macOS installer's os "mac"; gogdl's own
                    // --platform flag (and therefore host.nativeOsKey / games.platform / every
                    // launch-time comparison against it) calls the same host "osx". Two GOG
                    // APIs, two vocabularies for the same OS, translate before matching, or
                    // every Mac-native game in the library silently looks Windows-only.
                    const GOG_CATALOG_OS_ALIAS = { mac: 'osx' };
                    const oses      = [...new Set((item.downloads?.installers || [])
                        .map(x => GOG_CATALOG_OS_ALIAS[x.os] || x.os).filter(Boolean))];
                    // `platform` is what we would run here; `platforms` is everything GOG
                    // offers that this host could ever use. Keyed off the backend so a
                    // library synced on one OS is not mislabelled for the other.
                    const nativeOs  = host.nativeOsKey;
                    const runsAs    = oses.includes(nativeOs) ? nativeOs : 'windows';
                    const platforms = oses.filter(o => o === nativeOs || o === 'windows').join(',') || runsAs;
                    const is_dlc    = item.game_type && item.game_type !== 'game' ? 1 : 0;
                    games.push({ id: String(item.id), title: item.title || 'Unknown', platform: runsAs, platforms, is_dlc });
                }
            }
            const stmtInsert = db.prepare(
                "INSERT OR IGNORE INTO games (id, title, store, app_id, platform, platforms, installed, is_dlc) VALUES (?, ?, 'gog', ?, ?, ?, 0, ?)"
            );
            const stmtUpdate = db.prepare(
                "UPDATE games SET platforms = ?, is_dlc = ? WHERE app_id = ? AND store = 'gog'"
            );
            const tx = db.transaction(list => {
                let n = 0;
                for (const g of list) {
                    const plats  = g.platforms || g.platform || 'windows';
                    const is_dlc = g.is_dlc ? 1 : 0;
                    const info = stmtInsert.run('gog_' + g.id, g.title, g.id, g.platform || 'windows', plats, is_dlc);
                    if (info.changes) n++;
                    stmtUpdate.run(plats, is_dlc, g.id);   // refresh platforms/is_dlc on existing rows too
                }
                return n;
            });
            result.gog.added = tx(games);
            // `ids` is GOG's full owned-product list (games + DLCs). A non-empty list lets us
            // prune GOG rows the user no longer owns (refunds) without risking a purge on a
            // transient/empty API response.
            if (ids.length) {
                result.gog.removedIds = pruneUnowned('gog', new Set(ids.map(String)));
                result.gog.removed = result.gog.removedIds.length;
            }
        } catch (e) { result.gog.error = e.message; }
    }

    return result;
}

function findGogInstallResult(baseDir, appId, preExistingDirs = null) {
    try {
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const gameDir = path.join(baseDir, entry.name);

            // ── Windows path ──────────────────────────────────────────────────
            const infoFile = path.join(gameDir, `goggame-${appId}.info`);
            if (fs.existsSync(infoFile)) {
                try {
                    const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
                    const task = (info.playTasks || []).find(t => t.isPrimary && t.type === 'FileTask');
                    return { install_path: gameDir, executable: task?.path || null };
                } catch { return { install_path: gameDir, executable: null }; }
            }

            // ── Native path ───────────────────────────────────────────────────
            // How a build native to THIS host announces itself is the backend's business
            // (on Linux, gogdl's .gogdl-linux-manifest). null → not this game, keep looking.
            const native = host.findNativeInstallResult(gameDir, appId, preExistingDirs);
            if (native) return native;
        }
    } catch {}
    return null;
}

// Still exported under its old name: the Installer face destructures it.
const findLinuxGameExe = (gameDir) => host.findNativeGameExe(gameDir);

// ── Pre-install size info + free disk space (shared by Manager & Couch) ──────
// Available bytes at a path (walks up to the first existing parent).
async function getDiskSpace(dirPath) {
    let check = expandTilde(dirPath) || HOME;
    while (!fs.existsSync(check) && path.dirname(check) !== check) check = path.dirname(check);
    try { const st = await fs.promises.statfs(check); return st.bavail * st.bsize; }
    catch { return null; }
}

// GOG download/disk size. Linux uses the GOG API (installer files); Windows uses gogdl info.
async function gogInstallInfo(appId, platform) {
    if (platform === 'linux') {
        try {
            const token = await getGogToken(); if (!token) return null;
            const data = await gogFetch(`https://api.gog.com/products/${appId}?expand=downloads`, token);
            const installers = (data.downloads?.installers || []).filter(i => i.os === 'linux');
            let download_size = 0;
            for (const inst of installers) for (const f of inst.files || []) download_size += f.size || 0;
            return download_size > 0 ? { download_size, disk_size: download_size } : null;
        } catch { return null; }
    }
    const gogdl = findGogdl(); if (!gogdl) return null;
    try { fs.chmodSync(gogdl, '755'); } catch {}
    const authPath = writeGogAuthConfig();
    return new Promise(resolve => {
        let out = '';
        const proc = spawn(gogdl, ['--auth-config-path', authPath, 'info', appId, '--platform', platform || 'windows'],
            { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GOGDL_CONFIG_PATH: configDir } });
        proc.stdout.on('data', d => out += d);
        proc.stderr.on('data', d => out += d);
        proc.on('close', () => {
            try { fs.unlinkSync(authPath); } catch {}
            try {
                const data = JSON.parse(out.split('\n').find(l => l.trim().startsWith('{')));
                let download_size = 0, disk_size = 0;
                for (const s of Object.values(data.size || {})) { download_size += s.download_size || 0; disk_size += s.disk_size || 0; }
                resolve({ download_size, disk_size, version: data.versionName });
            } catch { resolve(null); }
        });
        proc.on('error', () => { try { fs.unlinkSync(authPath); } catch {} resolve(null); });
    });
}

// Owned DLCs for a GOG game via `gogdl info --with-dlcs`. Returns { ok, dlcs:[{id,title,download_size,disk_size}] }.
async function gogListDlcs(baseAppId, platform) {
    const gogdl = findGogdl(); if (!gogdl) return { ok: false, error: 'gogdl not found.', dlcs: [] };
    try { fs.chmodSync(gogdl, '755'); } catch {}
    await getGogToken().catch(() => {});
    const authPath = writeGogAuthConfig();
    return new Promise(resolve => {
        let out = '';
        const proc = spawn(gogdl, ['--auth-config-path', authPath, 'info', String(baseAppId),
            '--platform', platform || 'windows', '--with-dlcs'],
            { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GOGDL_CONFIG_PATH: configDir } });
        proc.stdout.on('data', d => out += d);
        proc.stderr.on('data', d => out += d);
        proc.on('close', () => {
            try { fs.unlinkSync(authPath); } catch {}
            try {
                const data = JSON.parse(out.split('\n').find(l => l.trim().startsWith('{')));
                const dlcs = (data.dlcs || []).map(x => {
                    const sz = (x.size && (x.size['en-US'] || x.size['*'])) || {};
                    return { id: String(x.id), title: x.title || 'DLC', download_size: sz.download_size || 0, disk_size: sz.disk_size || 0 };
                });
                resolve({ ok: true, dlcs });
            } catch { resolve({ ok: false, error: 'Could not read the DLC list. Make sure you are signed into GOG in Installer.', dlcs: [] }); }
        });
        proc.on('error', () => { try { fs.unlinkSync(authPath); } catch {} resolve({ ok: false, error: 'gogdl failed to run.', dlcs: [] }); });
    });
}

// Which owned DLCs are ACTUALLY installed, from gogdl's manifest HGLdlcs field, the only reliable
// signal. A completed --with-dlcs install records each installed DLC there (verified). We deliberately
// do NOT fall back to products[]/depots[]: those hold the full OWNED/planned set whenever --with-dlcs
// is passed, so they list DLCs that were only planned, not downloaded → false "installed" badges.
function gogInstalledDlcs(baseAppId) {
    try {
        const j = JSON.parse(fs.readFileSync(path.join(configDir, 'gogdl', 'manifests', String(baseAppId)), 'utf8'));
        return Array.isArray(j.HGLdlcs) ? j.HGLdlcs.map(d => String((d && d.id) ?? d)).filter(Boolean) : [];
    } catch { return []; }
}

// Epic update check via `legendary list-installed --check-updates --json`. legendary compares
// each installed game's local version against the store manifest and sets `update_available`.
// Returns a Map of app_name → { current, latest, update } (empty on failure).
async function epicListUpdates() {
    const r = await runLegendary(['list-installed', '--check-updates', '--json']);
    const out = new Map();
    if (!r.ok) return out;
    try {
        for (const g of JSON.parse(r.stdout) || []) {
            out.set(g.app_name, {
                current: g.version || '',
                latest: g.latest_version || g.version || '',
                update: !!g.update_available,
            });
        }
    } catch {}
    return out;
}

// Epic download/disk size via legendary info.
async function epicInstallInfo(appName) {
    const leg = findLegendary(); if (!leg) return null;
    return new Promise(resolve => {
        let out = '';
        const proc = spawn(leg, ['info', appName], { stdio: ['ignore', 'pipe', 'pipe'] });
        proc.stdout.on('data', d => out += d);
        proc.stderr.on('data', d => out += d);
        proc.on('close', () => {
            const toBytes = (n, u) => { const v = parseFloat(n); return u.toLowerCase().startsWith('g') ? v*1024**3 : u.toLowerCase().startsWith('m') ? v*1024**2 : v*1024; };
            const dl   = out.match(/Download size[^:]*:\s*([\d.]+)\s*(\w+)/i);
            const disk = out.match(/Disk size[^:]*:\s*([\d.]+)\s*(\w+)/i);
            resolve(dl && disk ? { download_size: toBytes(dl[1], dl[2]), disk_size: toBytes(disk[1], disk[2]) } : null);
        });
        proc.on('error', () => resolve(null));
    });
}

module.exports = {
    init, setDb, ensureSchema, writeProgress,
    sanitizeLogName, expandTilde, resolvePathCaseInsensitive,
    which, findLegendary, findGogdl, findComet, findUmu, findWineCached, findRuntime,
    scanProtonVersions, resolveProton, isProtonDir, diagnoseLaunchFailure,
    GOG_CLIENT_ID, GOG_CLIENT_SECRET, GOG_REDIRECT_URI,
    syncSharedDb, headlessInstall, headlessUninstall, launchGame, runLegendary, prefixPathForGame,
    getGameInstallInfo, runRedist, injectGogRegistry, gogFetch, getGogToken,
    writeGogAuthConfig, findGogInstallResult, findLinuxGameExe,
    getDiskSpace, gogInstallInfo, epicInstallInfo, epicListUpdates, syncOwnedLibrary, cancelActiveInstall,
    gogListDlcs, gogInstalledDlcs,
    gogExchangeCode, gogStatus, gogLogout, epicAuthCode, epicStatus,
    findNativeDosbox, dosboxInstallHint, isGogDosGame, applyGogSupportFiles, engineSetting,
    findShippedWrappers,
    gogPlayTasks, setGogLaunchTarget,
    findGogCdAudioImages, gogCdAudioConfArgs,
    gogListManuals, gogDownloadManual,
};
