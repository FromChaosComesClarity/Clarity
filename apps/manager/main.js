const { app, BrowserWindow, ipcMain, dialog, net, session, shell, Menu, Notification, nativeImage, screen, powerSaveBlocker } = require('electron');
app.setName('clarity');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { registerSharedHandlers } = require('../../packages/core/shared-ipc.js');
const host = require('../../packages/core/platform/index.js');
const desktopDescriptor = require('../../packages/core/desktop-descriptor.js');
const fs = require('fs');
const { exec, execFile, spawn } = require('child_process');

const https = require('https');

// Embedded SVG icons for the menu installer
const Clarity_SVG_B64 = 'PHN2ZyB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHJ4PSIxMTIiIGZpbGw9IiMwZTExMTMiLz48cGF0aCBkPSJNMzQ4LjMgMTM3LjggQTE1MCAxNTAgMCAxIDAgMzQ4LjMgMzc0LjIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzJmZTBkNiIgc3Ryb2tlLXdpZHRoPSI1NiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PGNpcmNsZSBjeD0iMjU2IiBjeT0iMjU2IiByPSIzNCIgZmlsbD0iIzRhNWY1ZSIvPjwvc3ZnPg==';
const Installer_SVG_B64 = 'PHN2ZyB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHJ4PSIxMTIiIGZpbGw9IiMwZTExMTMiLz48cGF0aCBkPSJNMzQ4LjMgMTM3LjggQTE1MCAxNTAgMCAxIDAgMzQ4LjMgMzc0LjIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzJmZTBkNiIgc3Ryb2tlLXdpZHRoPSI1NiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PHBhdGggZD0iTTI1NiAyMDggVjI5MiBNMjE0IDI1NCBMMjU2IDI5NiBMMjk4IDI1NCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNGE1ZjVlIiBzdHJva2Utd2lkdGg9IjMwIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48L3N2Zz4=';
const Couch_SVG_B64    = 'PHN2ZyB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHJ4PSIxMTIiIGZpbGw9IiMwZTExMTMiLz48cGF0aCBkPSJNMzQ4LjMgMTM3LjggQTE1MCAxNTAgMCAxIDAgMzQ4LjMgMzc0LjIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzJmZTBkNiIgc3Ryb2tlLXdpZHRoPSI1NiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PGNpcmNsZSBjeD0iMjU2IiBjeT0iMjU2IiByPSI0MiIgZmlsbD0iIzJmZTBkNiIvPjwvc3ZnPg==';
const EMULATTE_SVG_B64 = 'PHN2ZyB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPCEtLSBCYXNlIGJhY2tncm91bmQgLS0+CiAgPHJlY3Qgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHJ4PSIxMTIiIGZpbGw9IiMyQzFFMTYiLz4KICA8IS0tIE91dGVyIGJvcmRlciAtLT4KICA8cmVjdCB4PSIyNCIgeT0iMjQiIHdpZHRoPSI0NjQiIGhlaWdodD0iNDY0IiByeD0iODgiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzhCNUEyQiIgc3Ryb2tlLXdpZHRoPSIxMiIvPgoKICA8IS0tIENvZmZlZSBjdXAgYm9keSAtLT4KICA8cGF0aCBkPSJNIDE0MCAxODAgTCAzNzIgMTgwIEwgMzQwIDM5MCBDIDMzNiA0MTAgMzE4IDQyNCAyOTggNDI0IEwgMjE0IDQyNCBDIDE5NCA0MjQgMTc2IDQxMCAxNzIgMzkwIFoiCiAgICAgICAgZmlsbD0iIzQzMjgxOCIgc3Ryb2tlPSIjRDRBMzczIiBzdHJva2Utd2lkdGg9IjE2IiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CgogIDwhLS0gQ3VwIGhhbmRsZSAtLT4KICA8cGF0aCBkPSJNIDM3MiAyMzAgQyA0NDAgMjMwIDQ0MCAzMTAgMzcyIDMxMCIKICAgICAgICBmaWxsPSJub25lIiBzdHJva2U9IiNENEEzNzMiIHN0cm9rZS13aWR0aD0iMjAiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgoKICA8IS0tIENhcnRyaWRnZSB0b3AgKGdhbWUgc2xvdCkgLS0+CiAgPHJlY3QgeD0iMTYwIiB5PSIxNDAiIHdpZHRoPSIxOTIiIGhlaWdodD0iNTAiIHJ4PSIxMCIKICAgICAgICBmaWxsPSIjNDMyODE4IiBzdHJva2U9IiNENEEzNzMiIHN0cm9rZS13aWR0aD0iMTQiLz4KICA8IS0tIENhcnRyaWRnZSBub3RjaCAtLT4KICA8cmVjdCB4PSIyMjAiIHk9IjE0NSIgd2lkdGg9IjcyIiBoZWlnaHQ9IjIwIiByeD0iNCIgZmlsbD0iIzJDMUUxNiIvPgoKICA8IS0tIFN0ZWFtIHdpc3BzIC0tPgogIDxwYXRoIGQ9Ik0gMjIwIDE0MCBDIDIxMCAxMTAgMjMwIDkwIDIyMCA2NSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZFNkE3IiBzdHJva2Utd2lkdGg9IjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC42Ii8+CiAgPHBhdGggZD0iTSAyNTYgMTQwIEMgMjQ2IDEwNSAyNjYgODAgMjU2IDUwIiAgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZFNkE3IiBzdHJva2Utd2lkdGg9IjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC42Ii8+CiAgPHBhdGggZD0iTSAyOTIgMTQwIEMgMjgyIDExMCAzMDIgOTAgMjkyIDY1IiBmaWxsPSJub25lIiBzdHJva2U9IiNGRkU2QTciIHN0cm9rZS13aWR0aD0iOCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBvcGFjaXR5PSIwLjYiLz4KPC9zdmc+Cg==';

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

// Where user data lives is the host's call: portable beside the AppImage on Linux, an
// absolute Library path on systems where an app bundle cannot hold its own data.
const baseDir = host.portableBaseDir({ isPackaged: app.isPackaged, execPath: process.execPath, devDir: __dirname });

const configDir = path.join(baseDir, 'GameManagerConfig');

// Write a minimal game entry to Installer's DB (called before opening Installer for setup)

// Open Installer focused on a specific game's setup (called by "Setup with Installer" button)
const imagesDir = path.join(configDir, 'images');
const trailersDir = path.join(configDir, 'videos');
const dbPath = path.join(configDir, 'games.db');

// YT-DLP Paths
const baseAssetPath = app.isPackaged ? process.resourcesPath : __dirname;
const binDir = path.join(baseAssetPath, 'assets', 'bin', host.binDirName);
const ytDlpPath = path.join(binDir, 'yt-dlp');
const ffmpegPath = path.join(binDir, 'ffmpeg');
const ytDlpConfigPath = path.join(binDir, 'yt-dlp.conf');

let db;

function getSavedBounds() {
    try {
        const raw = db.prepare("SELECT value FROM settings WHERE key='window_bounds'").get()?.value;
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return null;
}

// Which monitor should the window open on? NOT getPrimaryDisplay(): on a multi-monitor Wayland
// desk Electron reports the first-enumerated output as "primary" regardless of the compositor's
// real primary, so a small side panel (e.g. a 640x480 HDMI screen) wins and the clamp below
// shrinks the window to a useless 600x440. Prefer the display that already holds the saved
// window, else the largest one. The cursor is no help, Wayland makes getCursorScreenPoint()
// return {0,0}, and neither is waiting: getAllDisplays() returns 1, 2 or 3 outputs at random
// on this session and then never corrects itself (display-added never fires), which is why
// the size floor in createWindow is deliberately NOT capped by the reported work area.
function pickDisplay(saved) {
    const all = screen.getAllDisplays();
    if (!all.length) return screen.getPrimaryDisplay();
    // Only trust the saved position when the whole window still fits on that display,
    // a partial match means the monitor layout changed under us (new machine, unplugged
    // screen), and the saved coordinates are meaningless.
    if (saved && saved.x != null && saved.y != null) {
        const on = all.find(d => {
            const w = d.workArea;
            return saved.x >= w.x && saved.y >= w.y &&
                   saved.x + (saved.width  || 0) <= w.x + w.width &&
                   saved.y + (saved.height || 0) <= w.y + w.height;
        });
        if (on) return on;
    }
    return all.reduce((best, d) =>
        d.workArea.width * d.workArea.height > best.workArea.width * best.workArea.height ? d : best);
}

function createWindow () {
    const saved = getSavedBounds();
    // Clamp to the display's work area so it never opens larger than the screen (e.g. 1080p with
    // a saved size from a bigger monitor, or panels/taskbars eating vertical space), which pushed
    // the welcome screen partly off-screen. Fall back to a centered window when it wouldn't fit.
    const wa = pickDisplay(saved).workArea;
    // ...but only when the reported work area is believable. Electron under-reports the outputs
    // here (see pickDisplay), and a work area smaller than the smallest usable window means we
    // are looking at a side panel it mistook for the whole desk, not a genuinely tiny screen.
    // In that case don't clamp at all, an oversized window the user can resize beats a
    // miniscule one they can't read, and a restored size was one this machine already had.
    const MIN_W = 1024, MIN_H = 700;
    const trustWorkArea = wa.width >= MIN_W && wa.height >= MIN_H;
    const wantW = saved?.width  || 1360, wantH = saved?.height || 900;
    const width  = trustWorkArea ? Math.max(Math.min(wantW, wa.width  - 40), MIN_W) : wantW;
    const height = trustWorkArea ? Math.max(Math.min(wantH, wa.height - 40), MIN_H) : wantH;
    let x = saved?.x, y = saved?.y;
    const onScreen = x != null && y != null && x >= wa.x && y >= wa.y &&
                     x + width <= wa.x + wa.width && y + height <= wa.y + wa.height;
    if (!onScreen) {
        // Centre on the chosen display by hand, passing undefined would let Electron centre it
        // on *its* idea of the primary, i.e. the wrong screen. If the window doesn't even fit
        // there (under-reported display), hand placement back to Electron rather than pushing
        // it off-screen.
        const fits = width <= wa.width && height <= wa.height;
        x = fits ? Math.round(wa.x + (wa.width  - width)  / 2) : undefined;
        y = fits ? Math.round(wa.y + (wa.height - height) / 2) : undefined;
    }
    // macOS: keep the real traffic lights instead of the custom-drawn win-btn row, inset to
    // sit inside our own #titlebar rather than Electron's default top-left corner. Every other
    // host stays frame:false with the custom row, unchanged.
    const chrome = process.platform === 'darwin'
        ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 10 } }
        : { frame: false };
    const win = new BrowserWindow({
        width, height, x, y,
        ...chrome,
        show: false,
        backgroundColor: '#1a1210',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
                                  contextIsolation: true,
                                  nodeIntegration: false,
                                  webSecurity: false
        }
    });

    win.setMenu(null);
    win.loadFile(path.join(__dirname, 'index.html'));

    // When the Manager regains focus (e.g. after using the Installer window to
    // install/uninstall), tell the renderer to re-sync install states from the
    // shared DB so the Play/Install buttons reflect external changes.
    win.on('focus', () => { try { win.webContents.send('window-refocused'); } catch {} });

    // Save window size/position when closing
    win.on('close', () => {
        if (!win.isMaximized() && !win.isMinimized()) {
            const b = win.getBounds();
            db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('window_bounds',?)").run(JSON.stringify(b));
        }
    });

    // Show only after the renderer has applied the theme, eliminates blank screen and color flash.
    // Fallback: if renderer never signals within 3s, show anyway.
    const showWin = () => { if (!win.isVisible()) win.show(); };
    ipcMain.once('renderer-ready', showWin);
    win.once('ready-to-show', () => setTimeout(showWin, 3000));
    win.webContents.once('did-finish-load', () => startSteamInstallWatcher(win));
}

// Three ways in from the outside, all the same shape: find the request in argv, hand it
// to the renderer, let the renderer do exactly what the equivalent click would do.
//
//   --game=<id>     open that game's page   (the Clock links its artwork back here)
//   --play=<id>     play it, as if Play had been pressed
//   --action=<id>   run one of the command palette's actions
//
// ⚠️ play and action exist for the Omarchy launcher overlay, and they deliberately do
// their work *in here*. The alternative, the plugin spawning games itself, would mean
// a second launcher that re-implements the engine and IWAD pickers, the install-state
// verification and the last-played write, and it would drift the day one of them changed.
// The overlay finds the row; the app performs it.
//
// Read from argv on first launch, and from the *second* instance's argv when we are
// already running, otherwise the request is dropped on the floor and the user just
// sees the library.
const REQUEST_ARGS = [
    { flag: '--game=',   channel: 'open-game',  valid: v => /^\d+$/.test(v) },
    { flag: '--play=',   channel: 'play-game',  valid: v => /^\d+$/.test(v) },
    { flag: '--action=', channel: 'run-action', valid: v => /^[a-z0-9][a-z0-9-]{0,39}$/.test(v) },
];

const requestFromArgv = (argv) => {
    for (const { flag, channel, valid } of REQUEST_ARGS) {
        const hit = (argv || []).find(a => a.startsWith(flag));
        if (!hit) continue;
        const value = hit.slice(flag.length).trim();
        if (valid(value)) return { channel, value };
    }
    return null;
};
let pendingRequest = requestFromArgv(process.argv);

function sendRequestToWindow(req) {
    if (!req) return;
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return;
    if (w.isMinimized()) w.restore();
    w.focus();
    w.webContents.send(req.channel, req.value);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', (_e, argv) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
        sendRequestToWindow(requestFromArgv(argv));
    });
}

// The renderer tells us when it can accept it; before that the game list isn't loaded.
ipcMain.on('renderer-ready', () => {
    if (!pendingRequest) return;
    const req = pendingRequest;
    pendingRequest = null;
    setTimeout(() => sendRequestToWindow(req), 400);
});

// The command palette's actions, published for the desktop (see desktop-descriptor.js).
// The renderer owns the list, every action is a closure over the UI, so it reports the
// ids and names once the palette is wired, and this only writes them down.
ipcMain.on('publish-palette-actions', (_e, actions) => { desktopDescriptor.publishActions(actions); });

app.whenReady().then(() => {
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    if (!fs.existsSync(trailersDir)) fs.mkdirSync(trailersDir, { recursive: true });

    // Tell the desktop where this installation lives, so a bar widget or an overlay can
    // read our paths instead of hardcoding someone else's. Rewritten every start: the
    // AppImage moves, and the installer database appears the first time a store is linked.
    desktopDescriptor.publish({
        version: app.getVersion(),
        baseDir,
        libraryDb: dbPath,
        installerDb: host.findInstallerDb(baseDir),
        selfExecutable: host.selfExecutable(),
    });

    try {
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
    // Shared IPC handlers live in packages/core/shared-ipc.js (single source of truth).
    registerSharedHandlers({ db, baseDir, trailersDir, ytDlpPath, ytDlpConfigPath, ffmpegPath, getBeautifulName, getOldCrushedName });
    applyHyprlandRules();   // needs `db`, see the note on the function
        db.prepare(`
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT, Store TEXT, FAV TEXT, WANT_TO_PLAY TEXT,
            PLAYING TEXT, FINISHED TEXT, Game TEXT, METACRITIC TEXT, RELEASED TEXT, GENRE TEXT,
            DEV TEXT, PUB TEXT, Acquired TEXT, HLTB_Main TEXT, HLTB_Main_Side TEXT, HLTB_Comp TEXT,
            CoverArt TEXT, Screenshot TEXT, Description TEXT, Tags TEXT,
            SteamAppID TEXT, SteamRating TEXT, Price TEXT, LowestPrice TEXT,
            Coop TEXT, NumPlayers TEXT, SimilarGames TEXT, LaunchCommand TEXT
        )
        `).run();

        try { db.prepare("ALTER TABLE games ADD COLUMN ProtonTier TEXT").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN LastPlayed INTEGER DEFAULT 0").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN Playtime INTEGER DEFAULT 0").run(); } catch(e) {}       // minutes (Steam playtime_forever)
        try { db.prepare("ALTER TABLE games ADD COLUMN Playtime2wk INTEGER DEFAULT 0").run(); } catch(e) {}    // minutes (Steam playtime_2weeks)
        try { db.prepare("ALTER TABLE games ADD COLUMN DiskSize INTEGER DEFAULT 0").run(); } catch(e) {}       // bytes (on-disk install size)
        try { db.prepare("ALTER TABLE games ADD COLUMN AchUnlocked INTEGER DEFAULT 0").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN AchTotal INTEGER DEFAULT 0").run(); } catch(e) {}

        try { db.prepare("ALTER TABLE games ADD COLUMN HeroArt TEXT").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN Logo TEXT").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN Icon TEXT").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN SteamDesc TEXT").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN SteamTrailer TEXT").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN Description_i18n TEXT DEFAULT ''").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN Franchise TEXT DEFAULT ''").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN IGDBTrailer TEXT DEFAULT ''").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN Installed INTEGER DEFAULT 1").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN InstallerGameId TEXT").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN LaunchCommands TEXT DEFAULT NULL").run(); } catch(e) {}
        // One-time migration: rename the legacy launch scheme heroic://launch/… → installer://launch/… (Heroic-era leftover)
        try { db.prepare("UPDATE games SET LaunchCommand = REPLACE(LaunchCommand, 'heroic://launch/', 'installer://launch/') WHERE LaunchCommand LIKE '%heroic://launch/%'").run(); } catch(e) {}
        try { db.prepare("UPDATE games SET LaunchCommands = REPLACE(LaunchCommands, 'heroic://launch/', 'installer://launch/') WHERE LaunchCommands LIKE '%heroic://launch/%'").run(); } catch(e) {}
        // …and unwrap the external Heroic flatpak that used to carry that URL. The rename above
        // left `flatpak run com.heroicgameslauncher.hgl "installer://launch/…"`, which the in-process
        // launcher can't recognise (its match is anchored) and which needs a Heroic install we no
        // longer depend on, so those rows launched nothing. The bare URL is what Installer handles.
        try {
            const unwrap = c => {
                const m = String(c || '').match(/com\.heroicgameslauncher\.hgl\s+"?(installer:\/\/launch\/[^"\s]+)"?/i);
                return m ? m[1] : c;
            };
            const rows = db.prepare(
                "SELECT id, LaunchCommand, LaunchCommands FROM games " +
                "WHERE LaunchCommand LIKE '%com.heroicgameslauncher.hgl%installer://launch/%' " +
                "   OR LaunchCommands LIKE '%com.heroicgameslauncher.hgl%installer://launch/%'"
            ).all();
            for (const r of rows) {
                const cmd = unwrap(r.LaunchCommand);
                let cmds = r.LaunchCommands;
                try {
                    const parsed = JSON.parse(r.LaunchCommands || 'null');
                    if (Array.isArray(parsed)) cmds = JSON.stringify(parsed.map(l => ({ ...l, cmd: unwrap(l && l.cmd) })));
                } catch(e) {}
                if (cmd !== r.LaunchCommand || cmds !== r.LaunchCommands) {
                    db.prepare("UPDATE games SET LaunchCommand=?, LaunchCommands=? WHERE id=?").run(cmd, cmds, r.id);
                }
            }
        } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN date_added INTEGER DEFAULT 0").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN kb_played INTEGER DEFAULT 0").run(); } catch(e) {}
        try { db.prepare("ALTER TABLE games ADD COLUMN FreeToPlay INTEGER DEFAULT 0").run(); } catch(e) {} // 1 = Steam free-to-play (played-free-games)
        try { db.prepare("ALTER TABLE games ADD COLUMN Hidden INTEGER DEFAULT 0").run(); } catch(e) {}      // 1 = user-hidden from all library views
        try { db.prepare("ALTER TABLE games ADD COLUMN SaveDirOverride TEXT").run(); } catch(e) {}          // GOG save-game manager: user-picked save folder ("Locate saves…")
        try { db.prepare("ALTER TABLE games ADD COLUMN MacNative INTEGER DEFAULT 0").run(); } catch(e) {}    // 1 = has a native macOS build (Steam platforms.mac, or GOG/Epic via library.db)
        try { db.prepare("ALTER TABLE games ADD COLUMN MacNativeChecked INTEGER DEFAULT 0").run(); } catch(e) {} // 1 = already checked (Steam lookup is a live API call, never re-ask once answered)
        try { db.prepare(`CREATE TABLE IF NOT EXISTS save_backups (
            id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER, path TEXT, created INTEGER, bytes INTEGER, source TEXT
        )`).run(); } catch(e) {}                                                                            // log of GOG save-zip backups (incl. pre-restore snapshots)
        try {
            db.prepare(`CREATE TRIGGER IF NOT EXISTS auto_date_added
                AFTER INSERT ON games
                WHEN NEW.date_added IS NULL OR NEW.date_added = 0
                BEGIN UPDATE games SET date_added = CAST(strftime('%s','now') AS INTEGER) WHERE id = NEW.id; END`).run();
        } catch(e) {}
        // One-time migration: strip legacy float-formatted Steam appids ("286690.0" → "286690").
        // These came from an old CSV-era import; the trailing ".0" made sync-steam's SteamAppID
        // match fail, so every Steam re-sync inserted a bare duplicate row. Normalising keeps
        // future syncs matching the existing entry. Idempotent (no ".0" left after first run).
        try { db.prepare("UPDATE games SET SteamAppID = substr(SteamAppID, 1, length(SteamAppID) - 2) WHERE SteamAppID LIKE '%.0'").run(); } catch(e) {}
        // A blank Store leaves a game uncategorizable; file it under "Others" (same bucket Installer games use).
        try { db.prepare("UPDATE games SET Store = 'Others' WHERE Store IS NULL OR TRIM(Store) = ''").run(); } catch(e) {}
        // One-time migration: OpenBOR games were filed as "OpenBOR, Others" while the gallery
        // had no filter of their own and the tag alone would have hidden them from every view.
        // It has one now, so the crutch comes off and they stop appearing under Others too.
        try { db.prepare("UPDATE games SET Store = 'OpenBOR' WHERE Store = 'OpenBOR, Others'").run(); } catch(e) {}
        try {
            db.prepare(`CREATE TRIGGER IF NOT EXISTS auto_store_others
                AFTER INSERT ON games
                WHEN NEW.Store IS NULL OR TRIM(NEW.Store) = ''
                BEGIN UPDATE games SET Store = 'Others' WHERE id = NEW.id; END`).run();
        } catch(e) {}

        db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`).run();
        db.prepare(`CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`).run();
        db.prepare(`CREATE TABLE IF NOT EXISTS playlist_games (playlist_id INTEGER NOT NULL, game_id INTEGER NOT NULL, sort_order INTEGER DEFAULT 0, PRIMARY KEY (playlist_id, game_id), FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE, FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE)`).run();
    } catch (err) {
        console.error("Could not connect to database:", err);
    }
    createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// In the unified suite Installer is THIS binary invoked with a leading 'installer' arg,
// there is no separate Installer.AppImage to locate, so this always resolves.
function findInstallerPath() {
    return host.selfExecutable();
}

// Spawn the Installer face as a detached process ('installer' identity, own lock + GUI).
// Packaged:   <Clarity.AppImage> installer <subArgs...>
// Dev:        <electron> <repoRoot> installer <subArgs...>
function spawnInstaller(subArgs) {
    const bin  = host.selfExecutable();
    const args = host.selfSpawnArgs(['installer', ...subArgs], path.join(__dirname, '..', '..'));
    const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return child;
}

// Returns a Map<appId, installerId> from Installer's DB for installer:// launch routing
function getInstallerMap() {
    const gdbPath = host.findInstallerDb(baseDir);
    if (!gdbPath) return new Map();
    try {
        const gdb = new Database(gdbPath, { timeout: 5000, readonly: true });
        const rows = gdb.prepare('SELECT id, app_id FROM games WHERE app_id IS NOT NULL').all();
        gdb.close();
        return new Map(rows.map(r => [String(r.app_id), String(r.id)]));
    } catch (e) { console.error('[getInstallerMap]', e); return new Map(); }
}

// In-process Installer engine for launching GOG/Epic games WITHOUT spawning a
// second AppImage process (Electron AppImages relaunching themselves is flaky).
// Points at Installer's own data dir (~/.config/installer) so it reads the same DB,
// prefixes and Proton settings the installer face uses.
const installerEngine = require('../../packages/core/installer-engine.js');
let _installerEngineDb = null;
let _installerProgressCb = null;   // set per install/uninstall to route progress to the renderer
let _installerBusy = false;        // serialize install/uninstall (one at a time)
// createIfMissing: when true (headless sign-in), bootstrap a fresh library.db so
// GOG/Epic can be connected without ever opening the Installer GUI. Read-only callers
// (status checks, install/refresh) leave it false and simply no-op if there's no db.
function ensureInstallerEngine(createIfMissing = false) {
    if (_installerEngineDb) return true;
    const home = os.homedir();
    let gdbPath = host.findInstallerDb(baseDir);
    // No library.db yet (fresh install, Installer GUI never opened). Create one so
    // GOG/Epic sign-in and library import can happen headlessly, Installer stays a
    // power-user tool the average user never has to open. Schema is created below.
    let created = false;
    if (!gdbPath) {
        if (!createIfMissing) return false;
        gdbPath = host.installerDbCreatePath(baseDir, app.isPackaged);
        try { fs.mkdirSync(path.dirname(gdbPath), { recursive: true }); }
        catch (e) { console.error('[installer-engine] could not create Installer data dir:', e); return false; }
        created = true;
    }
    const gConfigDir  = path.dirname(gdbPath);
    const engineBinDir = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'assets', 'bin', host.binDirName);
    try {
        _installerEngineDb = new Database(gdbPath, { timeout: 5000 });
        if (created) _installerEngineDb.pragma('journal_mode = WAL');   // match Installer's own initDb
    } catch (e) { console.error('[installer-engine] DB open failed:', e); _installerEngineDb = null; return false; }
    installerEngine.init({
        configDir:   gConfigDir,
        prefixesDir: path.join(gConfigDir, 'prefixes'),
        logDir:      path.join(gConfigDir, 'game_logs'),
        binDir:      engineBinDir,
        appImageDir: baseDir,
        homeDir:     home,
        db:          _installerEngineDb,
        onProgress:  (data) => { try { _installerProgressCb && _installerProgressCb(data); } catch {} },
        onLaunchIssue: (info) => reportLaunchFailure(info),
        onLaunchProgress: (info) => broadcast('game-launch-progress', info),
        onGameSession: (active) => onGameSession(active),
    });
    if (created) installerEngine.ensureSchema(_installerEngineDb);   // fresh db → create tables (no-op otherwise)
    return true;
}

// ── While a game is running ──────────────────────────────────────────────────
// Two things are worth doing for the duration of a game and undoing afterwards.
//
// The screen lock is the important one. A gamepad-only Couch session, a long cutscene or a
// turn spent staring at a map produces no keyboard or mouse input at all, so the desktop's
// idea of idle and the player's are completely different, and on Omarchy the lock screen
// wins. Electron's powerSaveBlocker speaks the Wayland idle-inhibit protocol, which hypridle
// honours.
//
// ⚠️ An inhibitor, deliberately, rather than flipping the user's idle setting: an inhibitor
// dies with the process holding it, whereas a toggle left flipped by a crash would disable
// someone's lock screen indefinitely. A game launcher must not leave that behind.
//
// ⚠️ Counted, not boolean. Two games at once and a single flag would release everything when
// the first one exits.
let _gamesRunning = 0;
function onGameSession(active) {
    const omarchy = host.desktop?.omarchy;
    // ⚠️ Re-applied on every launch, not just at startup. Rules set through `hyprctl eval` are
    // runtime state, and ANY Hyprland config reload discards them, which `omarchy theme set`
    // does every time. Change your theme once and games silently go back to tiling, with
    // nothing to indicate why. Re-applying costs four IPC calls and happens at the moment the
    // float rule actually matters: just before the game's window maps.
    if (active) { try { applyHyprlandRules(); } catch {} }
    _gamesRunning = Math.max(0, _gamesRunning + (active ? 1 : -1));
    const busy = _gamesRunning > 0;
    try { omarchy?.inhibitIdle?.(busy, powerSaveBlocker); } catch {}
    try { omarchy?.setGamingPower?.(busy); } catch {}
}

// ── Launch failures ───────────────────────────────────────────────────────────
// A GOG/Epic game is spawned detached, so when it dies on the spot nothing used to reach the
// user, the library just sat there while umu had already exited 1 (the classic case: no Proton
// installed, see the engine's PROTON_SEARCH_DIRS note). Everything that can go wrong at launch
// funnels through here and pops the Proton/launch-problem dialog in the renderer.
function broadcast(channel, payload) {
    for (const w of BrowserWindow.getAllWindows()) {
        try { w.webContents.send(channel, payload); } catch {}
    }
}

function reportLaunchFailure(info) {
    try {
        broadcast('game-launch-failed', {
            // Needed so the dialog can offer to FIX the failure rather than only describe it,
            // a per-game environment variable has to know which game.
            installerGameId: info?.gameId ?? null,
            title:  info?.title || '',
            code:   info?.reason?.code || 'UNKNOWN',
            message: info?.reason?.message || 'The game could not be started.',
            log:    info?.log || '',
            logPath: info?.logPath || '',
            protonPath: info?.protonPath || '',
            exitCode: info?.code,
        });
    } catch {}
}

// launchGame refused before spawning anything (e.g. no Proton for a Windows title). The engine
// tags those errors with a `code`; anything untagged is still worth showing rather than hiding
// in the console, which is where these used to die.
// Set (or replace) a single variable in a game's own environment block. Used by the launch
// dialog to apply a fix it just suggested, instead of reading the variable out to the user and
// leaving them to type it into the right box.
//
// ⚠️ Merges rather than overwrites: custom_env is the user's, and a game may already carry
// variables that matter. Only the named one is touched.
// ── Per-game compatibility, in the Manager ────────────────────────────────────
// These three handlers are what let Installer go headless: everything its per-game
// setup modal offered is reachable here, against the same library.db row.
//
// ⚠️ The writable column list is a hard allowlist. The row is keyed by an id the
// renderer supplies, so accepting arbitrary column names would let a bad payload
// rewrite `id`, `store` or `installed` and orphan the game from its library entry,
// the same class of break as the two-library.db split.
const COMPAT_COLUMNS = new Set([
    'prefix_path', 'proton_path', 'launch_args', 'custom_exe', 'custom_env',
    'winetricks', 'use_esync', 'use_fsync', 'use_dxvk_nvapi', 'use_battleye',
    'use_eac', 'notes',
]);

ipcMain.handle('installer-compat-get', async (_, installerGameId) => {
    if (!ensureInstallerEngine() || !installerGameId) return { ok: false, error: 'Installer data not available.' };
    try {
        const row = _installerEngineDb.prepare(
            `SELECT id, title, store, app_id, install_path, executable, platform,
                    prefix_path, proton_path, launch_args, custom_exe, custom_env,
                    winetricks, use_esync, use_fsync, use_dxvk_nvapi, use_battleye,
                    use_eac, launch_target, notes
             FROM games WHERE id=?`).get(installerGameId);
        if (!row) return { ok: false, error: 'Game not found in Installer data.' };
        let protons = [];
        try { protons = installerEngine.scanProtonVersions() || []; } catch {}
        // GOG titles can ship several play tasks (Quake's mission packs are all
        // glquake.exe and differ only by arguments), so they are keyed by index.
        let tasks = [];
        if (row.store === 'gog') { try { tasks = installerEngine.gogPlayTasks(installerGameId) || []; } catch {} }
        return { ok: true, game: row, protons, tasks };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('installer-compat-set', (_, { installerGameId, patch } = {}) => {
    if (!ensureInstallerEngine() || !installerGameId || !patch) return { ok: false, error: 'Nothing to save.' };
    const cols = Object.keys(patch).filter(k => COMPAT_COLUMNS.has(k));
    if (!cols.length) return { ok: false, error: 'No writable fields in that change.' };
    try {
        _installerEngineDb.prepare(`UPDATE games SET ${cols.map(c => `${c}=?`).join(', ')} WHERE id=?`)
            .run(...cols.map(c => patch[c]), installerGameId);
        return { ok: true, saved: cols };
    } catch (e) { return { ok: false, error: e.message }; }
});

// GOG launch target is not a plain column, the engine rewrites the stored task.
ipcMain.handle('installer-set-launch-target', (_, { installerGameId, taskIndex } = {}) => {
    if (!ensureInstallerEngine() || !installerGameId) return { ok: false, error: 'Installer data not available.' };
    try {
        const tasks = installerEngine.gogPlayTasks(installerGameId) || [];
        const t = tasks.find(x => String(x.index) === String(taskIndex));
        installerEngine.setGogLaunchTarget(installerGameId, t ? t.path : '', t ? t.index : null);
        return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
});

// Manage Storage: installed games with their size on disk, biggest first.
ipcMain.handle('installer-storage-list', async () => {
    if (!ensureInstallerEngine()) return { ok: false, error: 'Installer data not available.' };
    try {
        const rows = _installerEngineDb.prepare(
            'SELECT id, title, store, install_path FROM games WHERE installed=1 AND install_path IS NOT NULL').all();
        const out = [];
        for (const r of rows) {
            let bytes = 0;
            try { bytes = dirSizeBytes(r.install_path); } catch {}
            out.push({ ...r, bytes });
        }
        out.sort((a, b) => b.bytes - a.bytes);
        return { ok: true, games: out, total: out.reduce((n, g) => n + g.bytes, 0) };
    } catch (e) { return { ok: false, error: e.message }; }
});

// Walks a tree once, following no symlinks, a game directory can contain a link
// back into the prefix, and following it would count the same bytes repeatedly.
function dirSizeBytes(dir) {
    let total = 0;
    const stack = [dir];
    while (stack.length) {
        const cur = stack.pop();
        let entries = [];
        try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
            const full = path.join(cur, e.name);
            if (e.isSymbolicLink()) continue;
            if (e.isDirectory()) stack.push(full);
            else { try { total += fs.statSync(full).size; } catch {} }
        }
    }
    return total;
}

ipcMain.handle('installer-set-env-var', (_, { installerGameId, name, value } = {}) => {
    if (!_installerEngineDb || !installerGameId || !name) return { ok: false, error: 'Nothing to set.' };
    try {
        const row = _installerEngineDb.prepare('SELECT custom_env FROM games WHERE id=?').get(installerGameId);
        if (!row) return { ok: false, error: 'Game not found.' };
        const lines = String(row.custom_env || '').split('\n').map(l => l.trim()).filter(Boolean)
            .filter(l => l.split('=')[0].trim() !== name);
        lines.push(`${name}=${value}`);
        const merged = lines.join('\n');
        _installerEngineDb.prepare('UPDATE games SET custom_env=? WHERE id=?').run(merged, installerGameId);
        return { ok: true, env: merged };
    } catch (e) { return { ok: false, error: e.message }; }
});

function reportLaunchThrow(installerGameId, err) {
    let title = '';
    try { title = _installerEngineDb?.prepare('SELECT title FROM games WHERE id=?').get(installerGameId)?.title || ''; } catch {}
    reportLaunchFailure({
        title,
        reason: { code: err?.code || 'LAUNCH_ERROR', message: err?.message || 'The game could not be started.' },
    });
}

// Proton builds installed on this machine, newest/best first (shared engine scanner, so this
// list matches what a launch would actually pick).
ipcMain.handle('proton-list', () => {
    ensureInstallerEngine();
    try {
        const list = installerEngine.scanProtonVersions();
        let current = '';
        try { current = _installerEngineDb?.prepare("SELECT value FROM settings WHERE key='default_proton_path'").get()?.value || ''; } catch {}
        return { ok: true, protons: list, current };
    } catch (e) { return { ok: false, error: e.message, protons: [], current: '' }; }
});

ipcMain.handle('proton-set-default', (_, protonPath) => {
    if (!ensureInstallerEngine(true)) return { ok: false, error: 'Installer data not available.' };
    try {
        if (protonPath) _installerEngineDb.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('default_proton_path',?)").run(protonPath);
        else            _installerEngineDb.prepare("DELETE FROM settings WHERE key='default_proton_path'").run();
        return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
});

// Download + install the newest runtime the host knows how to fetch. What that IS, where it
// goes and how it unpacks all belong to the platform backend; this handler only relays
// progress and then confirms the engine can see the result.
ipcMain.handle('proton-install-latest', async (event) => {
    const send = d => { try { event.sender.send('proton-install-progress', d); } catch {} };
    const mgmt = host.runtime.management;
    if (!mgmt.supported) return { ok: false, error: 'This system has no downloadable compatibility runtime.' };

    send({ phase: 'looking', percent: 0, message: `Looking up the latest ${mgmt.label}…` });
    const latest = await mgmt.latestRelease();
    if (!latest.ok) return { ok: false, error: latest.error };

    const r = await mgmt.install({ release: latest.release, onProgress: send });
    if (!r.ok) return r;

    // Confirm the engine can now actually see it, the whole point of the exercise.
    ensureInstallerEngine();
    const found = installerEngine.scanProtonVersions()[0];
    if (!found) return { ok: false, error: 'Installed, but no compatibility runtime was found afterwards.' };
    send({ phase: 'done', percent: 100, message: `${found.label} ready.` });
    return { ok: true, proton: found, installBase: r.installBase };
});

ipcMain.handle('proton-install-cancel', () => { host.runtime.management.cancel(); return { ok: true }; });

// Split a InstallerGameId like "gog_2049187585" / "epic_<hex>" into { store, appId }.
function parseInstallerId(gid) {
    if (!gid) return null;
    const m = String(gid).match(/^(gog|epic)_(.+)$/i);
    if (!m) return null;            // custom (mp...) ids aren't gogdl/legendary-installable
    return { store: m[1].toLowerCase(), appId: m[2] };
}

// Where GOG/Epic games get installed. `default_install_dir` in library.db is the single source
// of truth (the Installer face reads the same key); when it's unset, fresh machine, Installer GUI
// never opened, fall back to the same built-in base the engine itself installs into, so the
// install dialog shows a real path instead of an empty box.
const INSTALLER_DEFAULT_DIR = path.join(os.homedir(), 'Games', 'Clarity');
function installerDefaultDir() {
    try { return _installerEngineDb?.prepare("SELECT value FROM settings WHERE key='default_install_dir'").get()?.value || INSTALLER_DEFAULT_DIR; }
    catch { return INSTALLER_DEFAULT_DIR; }
}

// Pre-install: free disk space at a path + download/disk size for a GOG/Epic title (shared engine).
ipcMain.handle('get-disk-space', (_, p) => installerEngine.getDiskSpace(p));
ipcMain.handle('get-install-size', async (_, installerGameId, reqPlatform) => {
    if (!ensureInstallerEngine()) return null;
    const parsed = parseInstallerId(installerGameId); if (!parsed) return null;
    if (parsed.store === 'gog') {
        let platform = reqPlatform || null;
        if (!platform) { try { platform = _installerEngineDb.prepare("SELECT platform FROM games WHERE app_id=? AND store=?").get(parsed.appId, parsed.store)?.platform; } catch {} }
        return installerEngine.gogInstallInfo(parsed.appId, platform || 'linux');
    }
    if (parsed.store === 'epic') return installerEngine.epicInstallInfo(parsed.appId);
    return null;
});

// Available install platforms for a GOG/Epic game (from library.db) → lets CN offer the same
// Linux-native / Windows choice Installer has. Returns { platform (current default), platforms: [...] }.
ipcMain.handle('installer-platforms', (_, installerGameId) => {
    if (!ensureInstallerEngine()) return { platform: 'windows', platforms: [] };
    const parsed = parseInstallerId(installerGameId);
    if (!parsed) return { platform: 'windows', platforms: [] };
    try {
        const row = _installerEngineDb.prepare("SELECT platform, platforms FROM games WHERE app_id=? AND store=?").get(parsed.appId, parsed.store);
        const platforms = (row?.platforms || row?.platform || '').split(',').map(s => s.trim()).filter(Boolean);
        return { platform: row?.platform || 'windows', platforms };
    } catch { return { platform: 'windows', platforms: [] }; }
});

// Headless owned-library refresh: pull newly-purchased GOG/Epic titles from the
// store APIs into library.db (import-only, installed=0). The refresh-library flow
// runs this before sync-all-installer-games so the new titles enter Clarity's library.
ipcMain.handle('installer-refresh-owned', async () => {
    if (!ensureInstallerEngine()) return { available: false };
    try {
        const r = await installerEngine.syncOwnedLibrary();
        // Propagate refunds/removals into Clarity's library: syncOwnedLibrary just pruned these ids
        // from library.db, so drop the matching Clarity rows too, or, for a title also on Steam,
        // strip only the GOG/Epic side. Scoped to THIS run's removed ids (never a broad
        // library.db diff), so pre-existing games.db↔library.db drift is never wrongly deleted.
        const removedIds = [...(r.gog?.removedIds || []), ...(r.epic?.removedIds || [])];
        if (db && removedIds.length) {
            const sel = db.prepare("SELECT id, Store, SteamAppID, LaunchCommand, LaunchCommands, InstallerGameId FROM games WHERE InstallerGameId=?");
            db.transaction(() => {
                for (const gid of removedIds) {
                    const row = sel.get(gid);
                    if (row) pruneStoreEntry(row, String(gid).startsWith('epic_') ? 'epic' : 'gog');
                }
            })();
        }
        return { available: true, ...r };
    } catch (e) {
        return { available: true, error: e.message };
    }
});

// ── Headless store sign-in ──────────────────────────────────────────────────────
// Open the GOG/Epic OAuth window ourselves, capture the auth code and let the shared
// engine finish the exchange (tokens stored in library.db). No Installer window ever
// appears, the average user connects their stores without meeting Installer at all.

ipcMain.handle('gog-login', () => {
    if (!ensureInstallerEngine(true)) return { ok: false, error: 'Installer data not available.' };
    const AUTH_URL = `https://auth.gog.com/auth?client_id=${installerEngine.GOG_CLIENT_ID}` +
        `&layout=client2&redirect_uri=${encodeURIComponent(installerEngine.GOG_REDIRECT_URI)}&response_type=code`;
    const parentWin = BrowserWindow.getFocusedWindow();
    return new Promise(resolve => {
        let resolved = false;
        const authWin = new BrowserWindow({
            parent: parentWin || undefined, modal: !!parentWin,
            width: 600, height: 800, title: 'Sign in to GOG',
            webPreferences: { nodeIntegration: false, contextIsolation: true },
        });
        authWin.setMenu(null);
        authWin.loadURL(AUTH_URL);
        async function tryExtract() {
            if (resolved) return;
            const m = authWin.webContents.getURL().match(/[?&]code=([^&\s]+)/);
            if (!m) return;
            resolved = true;
            try { authWin.close(); } catch {}
            resolve(await installerEngine.gogExchangeCode(m[1]));
        }
        authWin.webContents.on('did-navigate',         tryExtract);
        authWin.webContents.on('did-navigate-in-page', tryExtract);
        authWin.on('closed', () => { if (!resolved) resolve({ ok: false, error: 'cancelled' }); });
    });
});

ipcMain.handle('gog-auth-status', () => {
    if (!ensureInstallerEngine()) return { loggedIn: false };
    return installerEngine.gogStatus();
});

ipcMain.handle('gog-logout', () => {
    if (!ensureInstallerEngine()) return { ok: false };
    return installerEngine.gogLogout();
});

ipcMain.handle('epic-login', () => {
    if (!ensureInstallerEngine(true)) return { ok: false, error: 'Installer data not available.' };
    // legendary.gl/epiclogin is maintained by the legendary team and always uses the
    // current valid Epic client ID, avoids hardcoding one that can be revoked.
    const AUTH_URL = 'https://legendary.gl/epiclogin';
    const parentWin = BrowserWindow.getFocusedWindow();
    return new Promise(resolve => {
        let resolved = false;
        const authWin = new BrowserWindow({
            parent: parentWin || undefined, modal: !!parentWin,
            width: 560, height: 800, title: 'Sign in to Epic Games',
            webPreferences: { nodeIntegration: false, contextIsolation: true },
        });
        authWin.setMenu(null);
        // Force a fresh load so we always get a new (unexpired) authorization code.
        authWin.loadURL(AUTH_URL, { extraHeaders: 'Cache-Control: no-cache\nPragma: no-cache\n' });
        async function tryExtract() {
            if (resolved) return;
            try {
                const text = await authWin.webContents.executeJavaScript('document.body.innerText');
                // Epic exposes the code in several shapes depending on the flow, try each.
                const m = text.match(/"redirectUrl"\s*:\s*"[^"]*[?&]code=([^"&\s]+)/) ||
                          text.match(/"authorizationCode"\s*:\s*"([^"]+)"/) ||
                          text.match(/"exchangeCode"\s*:\s*"([^"]+)"/);
                if (!m) return;
                resolved = true;
                try { authWin.close(); } catch {}
                resolve(await installerEngine.epicAuthCode(m[1]));
            } catch {}
        }
        authWin.webContents.on('did-finish-load',     tryExtract);
        authWin.webContents.on('did-navigate',         tryExtract);
        authWin.webContents.on('did-navigate-in-page', tryExtract);
        setTimeout(tryExtract, 1500);
        authWin.on('closed', () => { if (!resolved) resolve({ ok: false, error: 'cancelled' }); });
    });
});

ipcMain.handle('epic-auth-status', () => {
    if (!ensureInstallerEngine()) return { loggedIn: false };
    return installerEngine.epicStatus();
});

// In-process install of a GOG/Epic game via the shared engine; progress streams
// to the calling renderer over 'installer-install-progress'.
ipcMain.handle('installer-install', async (event, { gameId, installerGameId, installDir, dlc, platform: reqPlatform } = {}) => {
    if (_installerBusy) return { ok: false, error: 'Another install/uninstall is in progress.' };
    if (!ensureInstallerEngine()) return { ok: false, error: 'Installer data not found.' };
    const parsed = parseInstallerId(installerGameId);
    if (!parsed) return { ok: false, error: 'This game cannot be installed in-process (not a GOG/Epic title).' };
    // User picked Linux-native vs Windows: persist it in library.db so the install AND future
    // launches (native vs Proton) both use it, matching Installer's own behaviour.
    if (reqPlatform && parsed.store === 'gog') {
        try { _installerEngineDb.prepare("UPDATE games SET platform=? WHERE app_id=? AND store=?").run(reqPlatform, parsed.appId, parsed.store); } catch {}
    }
    const platform = reqPlatform || (() => {
        try { return _installerEngineDb.prepare("SELECT platform FROM games WHERE app_id=? AND store=?").get(parsed.appId, parsed.store)?.platform; }
        catch { return null; }
    })();
    // DLC directives (from the gamepage DLC panel): mode 'all'|'ids' merge DLCs into the installed
    // base; mode 'reset' reinstalls the base with no DLCs. Plain installs pass no `dlc`.
    const opts = {};
    if (dlc) {
        if (dlc.mode === 'reset') opts.skipDlcs = true;
        else if (dlc.mode === 'all') opts.withDlcs = true;
        else if (Array.isArray(dlc.ids) && dlc.ids.length) opts.dlcIds = dlc.ids.map(String);
    }
    const dir = installDir || installerDefaultDir() || undefined;
    _installerBusy = true;
    // Watch for an error/cancel event so we don't mark a failed or cancelled download as installed.
    let installErr = null;
    _installerProgressCb = (data) => {
        if (data && data.step === 'error') installErr = data.message || 'Install failed.';
        try { event.sender.send('installer-install-progress', data); } catch {}
    };
    try {
        await installerEngine.headlessInstall(parsed.store, parsed.appId, platform, dir, opts);
        if (installErr) return { ok: false, error: installErr };
        // Before the games.db write, so nothing that reads install state in between can
        // answer from a Set that predates this install and undo it.
        invalidateInstallerInstalledCache();
        if (gameId && db) { try { db.prepare("UPDATE games SET Installed=1 WHERE id=?").run(gameId); } catch {} }
        try { event.sender.send('install-status-updated'); } catch {}
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    } finally {
        _installerBusy = false; _installerProgressCb = null;
    }
});

// List a GOG game's owned DLCs (via gogdl info --with-dlcs) with per-DLC installed state
// (read from gogdl's local manifest). Powers the gamepage DLC panel.
ipcMain.handle('dlc-list', async (_, installerGameId, platform) => {
    if (!ensureInstallerEngine()) return { ok: false, error: 'Installer data not found.', dlcs: [] };
    const parsed = parseInstallerId(installerGameId);
    if (!parsed || parsed.store !== 'gog') return { ok: false, error: 'DLCs are only supported for GOG games.', dlcs: [] };
    const plat = platform || (() => {
        try { return _installerEngineDb.prepare("SELECT platform FROM games WHERE app_id=? AND store='gog'").get(parsed.appId)?.platform; } catch { return null; }
    })() || 'windows';
    const res = await installerEngine.gogListDlcs(parsed.appId, plat);
    const installed = new Set(installerEngine.gogInstalledDlcs(parsed.appId));
    res.dlcs = (res.dlcs || []).map(d => ({ ...d, installed: installed.has(String(d.id)) }));
    return res;
});

// Install a GOG game's declared redistributables (OpenAL, VC++ runtimes, DirectX and the
// like) into its Proton prefix, without re-downloading the game.
//
// GOG ships these alongside a title and expects them installed INTO the prefix. A game that
// is missing one usually installs cleanly and then dies the moment it starts, with nothing in
// the log naming the cause, Baldur's Gate: Enhanced Edition needs openAL and does exactly
// that. Installer has always had this action; the Manager did not, so the only repair was a
// full reinstall. Every install made before installs created their own library.db row skipped
// runRedist along with the bookkeeping, so those games all need this.
ipcMain.handle('installer-run-redist', async (event, installerGameId) => {
    if (!ensureInstallerEngine()) return { ok: false, error: 'Installer data not found.' };
    const parsed = parseInstallerId(installerGameId);
    if (!parsed || parsed.store !== 'gog')
        return { ok: false, error: 'Compatibility files are only shipped for GOG games.' };
    let game = null;
    try { game = _installerEngineDb.prepare("SELECT * FROM games WHERE app_id=? AND store='gog'").get(parsed.appId); } catch {}
    if (!game) return { ok: false, error: 'This game is not in the Installer database yet, reinstall it to add it.' };
    const prefixPath = installerEngine.prefixPathForGame(game);
    const protonPath = game.proton_path || (() => {
        try { return _installerEngineDb.prepare("SELECT value FROM settings WHERE key='default_proton_path'").get()?.value; }
        catch { return null; }
    })();
    return installerEngine.runRedist(event.sender, 'redist-progress', parsed.appId,
                                   game.platform || 'windows', prefixPath, protonPath);
});

// The alternate ways a GOG release can be started (goggame-<appId>.info playTasks), and
// the picker's write-back. library.db's games.id *is* the InstallerGameId, so the engine's
// reader takes it unchanged, no lookup by app_id needed here.
ipcMain.handle('play-tasks', (_, installerGameId) => {
    if (!installerGameId || !ensureInstallerEngine()) return [];
    try { return installerEngine.gogPlayTasks(installerGameId); } catch { return []; }
});

ipcMain.handle('set-launch-target', (_, installerGameId, relPath, taskIndex) => {
    if (!installerGameId || !ensureInstallerEngine()) return { ok: false, error: 'Installer data not found.' };
    try { return installerEngine.setGogLaunchTarget(installerGameId, relPath, taskIndex); }
    catch (e) { return { ok: false, error: e.message }; }
});

// ── Custom installers (fan games, source ports, custom engines) ──────────────
// The user brings the download; we identify it, unpack it, and wire it to game data they
// already own. See packages/core/custom-installers.js for why this is a catalogue of
// specific recipes rather than one generic folder importer.
const customInstallers = require('../../packages/core/custom-installers.js');

// ── Which screen games open on (KDE only) ────────────────────────────────────
// See packages/core/kwin-display.js for why this is a KWin script rather than anything
// inside the game, and why it is one script for all games rather than one per game.
const kwinDisplay = host.desktop?.displayPicker || null;

// The choice belongs with the rest of our settings, which travel with the AppImage.
// A loaded KWin script is gone after a logout, so the stored choice is put back into
// effect on every start. Nothing to do, and nothing written, if there is no choice.
try {
    kwinDisplay?.configure(configDir);
    if (kwinDisplay?.isSupported()) kwinDisplay.apply();
} catch {}

// Hyprland window rules, for the same reason the KWin script is re-applied above: they are
// session-scoped and nothing is written to the user's config, so they have to be set again on
// every start. A no-op off Hyprland.
// ⚠️ Called after the database is open, NOT at module load. The float-games choice is a
// setting, and at module-evaluation time `db` is still undefined, reading it there silently
// returned nothing and the toggle appeared to do nothing at all.
//
// ⚠️ Hyprland rules also cannot be un-set once applied for a session, so this is read once at
// startup rather than toggled live; the Control Panel says "takes effect next start" instead
// of pretending otherwise.
function applyHyprlandRules() {
    try {
        const r = host.desktop?.omarchy?.applyWindowRules?.({ gameWindowMode: gameWindowMode() });
        if (r?.applied) console.log(`[hyprland] ${r.applied}/${r.total} window rules applied (games ${gameWindowMode()})`);
    } catch {}
}

// fullscreen | float | tile. ⚠️ The old boolean `omarchy_float_games` is read once and
// translated, because a row that says '1' is someone who went and ticked the box. That is a
// choice for floating and it is kept. An absent row was only ever the old default, so it
// becomes the new one.
function gameWindowMode() {
    const DEFAULT = host.desktop?.omarchy?.GAME_WINDOW_MODE_DEFAULT || 'fullscreen';
    try {
        const row = db?.prepare("SELECT value FROM settings WHERE key='omarchy_game_window'").get();
        if (row && ['fullscreen', 'float', 'tile'].includes(row.value)) return row.value;
        const legacy = db?.prepare("SELECT value FROM settings WHERE key='omarchy_float_games'").get();
        if (legacy) return legacy.value === '0' ? 'tile' : 'float';
    } catch {}
    return DEFAULT;
}

/*
 * "Apply to this session" behind the game-window setting.
 *
 * ⚠️ A Hyprland rule cannot be withdrawn, so switching from Fullscreen to Floating does
 * nothing on its own, the old rule is still there and still wins, which is exactly what it
 * looks like from the outside: a setting that did nothing. The only way round it is to make
 * the compositor forget every runtime rule and put ours back, which is what this does, and
 * why it is a button the user presses rather than something that happens behind their back.
 */
ipcMain.handle('apply-hyprland-rules-now', () => {
    const om = host.desktop?.omarchy;
    if (!om?.reloadConfig) return { ok: false, error: 'This needs a running Hyprland session.' };
    const reloaded = om.reloadConfig();
    if (!reloaded.ok) return { ok: false, error: 'Hyprland did not accept the config reload.' };
    // Everything we own, put back in the order a fresh start would: the window rules first,
    // then the screen choice, which also re-asserts the X11 primary.
    const rules = om.applyWindowRules({ gameWindowMode: gameWindowMode() });
    let display = null;
    try { if (kwinDisplay?.isSupported()) display = kwinDisplay.apply(); } catch {}
    return { ok: !!rules.applied, mode: gameWindowMode(), applied: rules.applied, total: rules.total, display };
});

ipcMain.handle('display-options', () => {
    if (!kwinDisplay?.isSupported()) return { supported: false, displays: [], current: null };
    return { supported: true, displays: kwinDisplay.listDisplays(), current: kwinDisplay.currentDisplay() };
});

ipcMain.handle('set-game-display', (_, index) => {
    if (!kwinDisplay) return { ok: false, error: 'Not supported on this system.' };
    try { return kwinDisplay.setGameDisplay(index === null ? null : Number(index)); }
    catch (e) { return { ok: false, error: e.message }; }
});

// ── Omarchy ──────────────────────────────────────────────────────────────────
// A desktop-level integration, not a platform: host.id is still 'linux'. Both modules are
// null on macOS and self-gating on Linux, so every handler here answers "not detected" on a
// host that is not Omarchy rather than throwing. ⚠️ Optional chaining is not decoration,
// desktop.displayPicker being null crashed this file once on macOS for want of exactly that.
const omarchy = host.desktop?.omarchy || null;

ipcMain.handle('omarchy-status', () => {
    if (!omarchy?.isOmarchy?.()) return { detected: false, hyprland: !!omarchy?.isHyprland?.() };
    return {
        detected: true,
        version: omarchy.version(),
        hyprland: omarchy.isHyprland(),
        gap: omarchy.gapSummary(),
        geometry: omarchy.hyprGeometry?.() || null,
        tuning: omarchy.systemTuning?.() || [],
        tuningCommand: omarchy.tuningCommand?.() || '',
        tools: omarchy.toolStatus(),
        // Emulation belongs to EmuLatte; this app never offers RetroArch.
        installers: omarchy.installerStatus().filter(i => !i.emulation),
    };
});

// Both of these open a terminal and return immediately, the install itself is the user's,
// running under their own sudo, and its outcome shows up on the next status read.
ipcMain.handle('omarchy-install-tools', (_, keys) => {
    if (!omarchy) return { ok: false, error: 'Not supported on this system.' };
    return omarchy.openInstallTerminal(Array.isArray(keys) ? keys.map(String) : []);
});

// Hands the tuning command to a terminal, exactly like the package installs. The app never
// runs it, kernel parameters belong to the person who owns the machine.
ipcMain.handle('omarchy-apply-tuning', () => {
    if (!omarchy) return { ok: false, error: 'Not supported on this system.' };
    const cmd = omarchy.tuningCommand?.() || '';
    if (!cmd) return { ok: false, error: 'Nothing to change, every setting already matches.' };
    return omarchy.openTerminalWith(cmd);
});

ipcMain.handle('omarchy-run-installer', (_, key) => {
    if (!omarchy) return { ok: false, error: 'Not supported on this system.' };
    return omarchy.runInstaller(String(key || ''));
});

// ⚠️ 'omarchy-theme' and its live watch are registered in shared-ipc.js, NOT here, Couch
// needs them too, and registering the same channel twice throws at startup.

// Paths other games already occupy. Custom installs share a folder with GOG and Epic
// installs and the names collide, <root>/Witchaven is where GOG puts Witchaven and where
// a recipe called Witchaven wants to go, so a target that lands on one must be renamed,
// never emptied.
function _reservedPaths(exceptId) {
    if (!ensureInstallerEngine()) return [];
    try {
        return _installerEngineDb.prepare('SELECT id, install_path FROM games WHERE install_path IS NOT NULL')
            .all().filter(r => r.id !== exceptId && r.install_path).map(r => r.install_path);
    } catch { return []; }
}

const _installerRowsForData = () => {
    if (!ensureInstallerEngine()) return [];
    try { return _installerEngineDb.prepare('SELECT title, install_path, installed FROM games').all(); }
    catch { return []; }
};

// The first engine from an accepted group that is actually installed. Mods declare a group
// (GZDoom or UZDoom) rather than one engine: they are the same 4.x lineage with the same
// command line, so either satisfies the requirement and the user's existing one is reused.
function _installedEngines(engineIds) {
    if (!ensureInstallerEngine()) return [];
    const out = [];
    for (const id of engineIds) {
        try {
            const row = _installerEngineDb.prepare('SELECT id,title,install_path,executable FROM games WHERE id=? AND installed=1').get(`cn_${id}`);
            if (row && row.install_path && fs.existsSync(row.install_path)) {
                out.push({ id, title: row.title, root: row.install_path, exe: row.executable });
            }
        } catch {}
    }
    return out;
}
const _installedEngine = (ids) => {
    const all = _installedEngines(ids);
    return all.length ? { title: all[0].title, install_path: all[0].root, executable: all[0].exe } : null;
};

// Register an install in both databases. library.db owns the launch (so the shared engine
// supplies Proton and the prefix); games.db points at it exactly as a GOG title does.
function _registerCustomInstall(r) {
    const gid = `cn_${r.key || r.recipeId}`;
    _installerEngineDb.prepare(`INSERT INTO games (id,title,store,installed,install_path,executable,platform,launch_args)
                              VALUES (?,?,?,1,?,?,?,?)
                              ON CONFLICT(id) DO UPDATE SET
                                installed=1, install_path=excluded.install_path,
                                executable=excluded.executable, platform=excluded.platform,
                                launch_args=excluded.launch_args`)
        .run(gid, r.title, 'custom', r.installPath, r.executable, r.platform, r.launchArgs || null);

    const cmd = `installer://launch/${gid}`;
    const existing = db.prepare('SELECT id FROM games WHERE InstallerGameId=?').get(gid);
    if (existing) db.prepare('UPDATE games SET Installed=1, LaunchCommand=? WHERE id=?').run(cmd, existing.id);
    // OpenBOR is its own category rather than a member of Others, one engine with one
    // rigid layout, the same argument that earned PICO-8 its own place in the library.
    // It stands alone now that the gallery has a filter for it: a game filed under both
    // would be counted twice and turn up under Others, which is where it was never meant
    // to be. Anything without a category of its own still lands in Others.
    else db.prepare(`INSERT INTO games (Game, Store, LaunchCommand, InstallerGameId, Installed, FAV, WANT_TO_PLAY)
                     VALUES (?,?,?,?,1,'NO','NO')`)
            .run(r.title, r.category || 'Others', cmd, gid);
    return gid;
}

// The catalogue, each entry carrying what this machine can currently do with it: whether
// the required game data is already resolvable, and whether it is installed already.
ipcMain.handle('custom-recipe-list', () => {
    const rows = _installerRowsForData();
    return customInstallers.listRecipes().map(r => {
        const out = { ...r, installed: false, installedCount: 0, data: r.data ? { ...r.data } : null };
        try {
            if (r.dynamic) {
                // One recipe, many installs (every OpenBOR game shares it), so report a
                // count rather than a yes/no, and never offer to "reinstall" a shape.
                out.installedCount = _installerEngineDb?.prepare("SELECT COUNT(*) n FROM games WHERE id LIKE ?").get(`cn_${r.id}_%`)?.n || 0;
            } else {
                out.installed = !!_installerEngineDb?.prepare('SELECT 1 FROM games WHERE id=?').get(`cn_${r.id}`);
            }
        } catch {}
        if (r.data) {
            const d = customInstallers.resolveGameData(r.data.id, rows);
            out.data.ready = d.ok;
            out.data.from = d.ok ? d.title : '';
            out.data.owned = d.owned || [];
            out.data.userSupplied = !!d.userSupplied;
            out.data.message = d.ok ? '' : d.message;
        }
        // A mod needs an engine. Report which of its accepted engines is already here, so
        // the button can say whether this is one file or two.
        if (r.engine) {
            const eng = _installedEngine(r.engine);
            out.engineReady = !!eng;
            out.engineTitle = eng ? eng.title : '';
            out.engineNames = r.engine.map(id => customInstallers.getRecipe(id)?.title || id);
        }
        return out;
    });
});

ipcMain.handle('custom-install-pick', async (_, recipeId) => {
    const recipe = customInstallers.getRecipe(recipeId);
    // There is no module-scope `win` in this file, every dialog derives the parent
    // itself. Referencing one throws inside the handler, which reaches the renderer as
    // a rejected invoke and looks exactly like a button that does nothing.
    const parent = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(parent, {
        title: recipe ? `Select the ${recipe.title} download` : 'Select the download',
        // Some projects ship a setup.exe rather than an archive; it is unpacked, not run.
        filters: [{ name: 'Downloads', extensions: ['zip', '7z', 'rar', 'exe', 'tar', 'gz', 'xz'] }],
        properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: res.filePaths[0] };
});

ipcMain.handle('custom-install', async (_, { recipeId, archivePath, engineArchivePath, selected, iwad, dataPath, overwrite } = {}) => {
    if (!ensureInstallerEngine(true)) return { ok: false, error: 'Installer data could not be created.' };
    const recipe = customInstallers.getRecipe(recipeId);
    if (!recipe) return { ok: false, error: `Unknown recipe "${recipeId}".` };

    // A mod is installed against an engine. Reuse one that is already here; otherwise
    // install the engine the user just pointed at, in the same click, because nobody sets
    // out to install GZDoom, they set out to install Brutal Doom.
    if (recipe.engine) {
        let engine = _installedEngine(recipe.engine);
        if (!engine) {
            if (!engineArchivePath) {
                return { ok: false, needsEngine: true,
                         engines: recipe.engine.map(id => customInstallers.getRecipe(id)).filter(Boolean)
                                   .map(e => ({ id: e.id, title: e.title, source: e.source })) };
            }
            const engineId = customInstallers.detectRecipe(engineArchivePath)
                .find(id => recipe.engine.includes(id));
            if (!engineId) {
                return { ok: false, error: `That file does not look like ${recipe.engine.map(id => customInstallers.getRecipe(id)?.title).join(' or ')}.` };
            }
            const er = customInstallers.installFromArchive({
                recipeId: engineId, archivePath: engineArchivePath, dataPath, overwrite: true, reserved: _reservedPaths(`cn_${engineId}`),
                installRoot: installerDefaultDir(), dataRows: _installerRowsForData(),
            });
            if (!er.ok) return er;
            try { _registerCustomInstall(er); } catch (e) { return { ok: false, error: `Engine installed, but could not register it: ${e.message}` }; }
            engine = { install_path: er.installPath, executable: er.executable, title: er.title };
        }

        // A game on a shared engine brings no download of its own. It needs the engine
        // and its data, and gets a folder of its own so two Build games never collide
        // over tiles000.art.
        const mr = recipe.onEngine
            ? customInstallers.installGameOnEngine({
                recipeId, archivePath, dataPath, overwrite: !!overwrite, reserved: _reservedPaths(`cn_${recipeId}`),
                engineRoot: engine.install_path, engineExe: engine.executable,
                engines: _installedEngines(recipe.engine),
                installRoot: installerDefaultDir(), dataRows: _installerRowsForData(),
              })
            : customInstallers.installMod({
                recipeId, archivePath, selected, iwad,
                engineRoot: engine.install_path, engineExe: engine.executable,
                dataRows: _installerRowsForData(),
              });
        // Several loadable files inside, the renderer asks which, then calls back with
        // `selected`. Carries the engine title so the second pass can report it.
        if (!mr.ok) return (mr.choose || mr.needsData) ? { ...mr, engineTitle: engine.title } : mr;
        try { _registerCustomInstall(mr); } catch (e) { return { ok: false, error: `Installed, but could not add it to the library: ${e.message}` }; }
        if (recipe.onEngine) _refreshEngineSearchPaths(recipe.engine);
        invalidateInstallerInstalledCache();
        return { ...mr, engineTitle: engine.title };
    }

    const r = customInstallers.installFromArchive({
        recipeId, archivePath, dataPath, overwrite: !!overwrite, reserved: _reservedPaths(`cn_${recipeId}`),
        installRoot: installerDefaultDir(),
        dataRows: _installerRowsForData(),
    });
    if (!r.ok) return r;

    try { _registerCustomInstall(r); }
    catch (e) { return { ok: false, error: `Installed, but could not add it to the library: ${e.message}` }; }

    invalidateInstallerInstalledCache();
    return r;
});

// Adding a Windows game from a folder that is already unpacked. Registered in place,
// nothing is copied, so this also covers folders living on another drive.
ipcMain.handle('custom-folder-pick', async (_, title) => {
    const parent = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(parent, {
        title: title || "Select the game's folder",
        properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: res.filePaths[0] };
});

ipcMain.handle('custom-folder-scan', (_, folder) => {
    try {
        if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'That folder no longer exists.' };
        return { ok: true, entries: customInstallers.scanFolderEntries(folder), suggestedTitle: path.basename(folder) };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('custom-folder-add', (_, { folder, executable, title } = {}) => {
    if (!ensureInstallerEngine(true)) return { ok: false, error: 'Installer data could not be created.' };
    const r = customInstallers.addFromFolder({ folder, executable, title });
    if (!r.ok) return r;
    try { _registerCustomInstall(r); }
    catch (e) { return { ok: false, error: `Could not add it to the library: ${e.message}` }; }
    invalidateInstallerInstalledCache();
    return r;
});

// Asked at the moment of pressing Play, not at install time: which Doom this mod runs on
// is a per-session decision, the way you would pick a disc off a shelf. Returns null when
// there is nothing to ask, not a mod, or only one IWAD available, so the launch goes
// straight through and nothing is put in the way of games that have no choice to make.
ipcMain.handle('custom-iwad-options', (_, installerGameId) => {
    if (!installerGameId || !ensureInstallerEngine()) return null;
    try {
        const row = _installerEngineDb.prepare('SELECT install_path, launch_args FROM games WHERE id=?').get(installerGameId);
        if (!row || !row.install_path || !/-file\b/i.test(row.launch_args || '')) return null;
        const iwads = customInstallers.listIwads(row.install_path);
        if (iwads.length < 2) return null;
        return {
            iwads,
            current: customInstallers.currentIwad(row.launch_args),
            // The full line with the choice applied, ready to hand back to launch-game.
            argsFor: Object.fromEntries(iwads.map(i => [i.file, customInstallers.withIwad(row.launch_args, i.file)])),
        };
    } catch { return null; }
});

// BuildGDX is a Java program, and Java asks Windows whether a folder is writable rather
// than trying. Wine answers that question for its Z: drive, the one that maps the whole
// Linux filesystem, by saying no, even where writing plainly works: a cmd.exe redirect
// into the same folder succeeds. So BuildGDX refused every game folder with
// "AccessDeniedException: You don't have write permissions".
//
// A path on C: is answered correctly, so each such game is mapped into its own prefix at
// C:\cn\<name> and handed that instead. Done before every launch rather than at install,
// because a rebuilt prefix would otherwise silently lose the mapping.
function _ensureGdxDriveMapping(gid) {
    if (!_installerEngineDb) return;
    let row;
    try { row = _installerEngineDb.prepare('SELECT * FROM games WHERE id=?').get(gid); } catch { return; }
    const m = row && row.launch_args && row.launch_args.match(/C:\\cn\\([^"\\]+)/i);
    if (!m || !row.install_path) return;
    try {
        const driveC = path.join(installerEngine.prefixPathForGame(row), 'pfx', 'drive_c', 'cn');
        fs.mkdirSync(driveC, { recursive: true });
        const link = path.join(driveC, m[1]);
        try { if (fs.realpathSync(link) === fs.realpathSync(row.install_path)) return; } catch {}
        try { fs.unlinkSync(link); } catch {}
        fs.symlinkSync(row.install_path, link);
    } catch (e) { console.error('[launch] could not map', gid, 'into its prefix:', e.message); }
}

// Tell each engine where the games ended up. Without this an engine opened on its own
// finds nothing and quits, which is what happened once the games moved into their own
// folders, see writeEngineSearchPaths.
function _refreshEngineSearchPaths(engineIds) {
    for (const e of _installedEngines(engineIds || [])) {
        let folders = [];
        try {
            folders = _installerEngineDb.prepare(
                // Tolerates the pre-rename `cn_raze-*` ids as well as the current ones.
                "SELECT install_path FROM games WHERE (id LIKE 'cn_build-game-%' OR id LIKE 'cn_raze-%') AND installed=1"
            ).all().map(r => r.install_path).filter(p => p && fs.existsSync(p));
        } catch {}
        if (folders.length) customInstallers.writeEngineSearchPaths(e.id, e.root, folders);
    }
}

// Which engine to run this on, asked at Play time. Null unless the game folder really
// holds more than one, a game with a single engine must never be slowed by a question.
ipcMain.handle('custom-engine-options', (_, installerGameId) => {
    if (!installerGameId || !ensureInstallerEngine()) return null;
    try {
        const row = _installerEngineDb.prepare('SELECT install_path, executable FROM games WHERE id=?').get(installerGameId);
        if (!row || !row.install_path) return null;
        const engines = customInstallers.readEngines(row.install_path)
            .filter(e => fs.existsSync(path.join(row.install_path, e.exe)));
        return engines.length > 1 ? { engines, current: row.executable } : null;
    } catch { return null; }
});

ipcMain.handle('custom-set-engine', (_, installerGameId, exe) => {
    if (!installerGameId || !ensureInstallerEngine() || !exe) return { ok: false };
    try {
        _installerEngineDb.prepare('UPDATE games SET executable=? WHERE id=?').run(exe, installerGameId);
        return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
});

// Remember the choice as the new default, so the dialog opens on what you picked last.
ipcMain.handle('custom-set-iwad', (_, installerGameId, iwad) => {
    if (!installerGameId || !ensureInstallerEngine()) return { ok: false, error: 'Installer data not found.' };
    try {
        const row = _installerEngineDb.prepare('SELECT launch_args FROM games WHERE id=?').get(installerGameId);
        if (!row) return { ok: false, error: 'That game is no longer registered.' };
        const next = customInstallers.withIwad(row.launch_args, iwad || '');
        _installerEngineDb.prepare('UPDATE games SET launch_args=? WHERE id=?').run(next || null, installerGameId);
        return { ok: true, launchArgs: next };
    } catch (e) { return { ok: false, error: e.message }; }
});

// Cancel the in-flight in-process download (kills gogdl/legendary). The install
// promise then resolves as failed and the renderer's queue advances to the next.
ipcMain.handle('installer-install-cancel', () => {
    if (!_installerEngineDb) return { ok: false };
    return { ok: installerEngine.cancelActiveInstall() };
});

ipcMain.handle('installer-uninstall', async (event, { gameId, installerGameId } = {}) => {
    if (_installerBusy) return { ok: false, error: 'Another install/uninstall is in progress.' };
    if (!ensureInstallerEngine()) return { ok: false, error: 'Installer data not found.' };
    const parsed = parseInstallerId(installerGameId);
    if (!parsed) return { ok: false, error: 'This game cannot be uninstalled in-process (not a GOG/Epic title).' };
    _installerBusy = true;
    _installerProgressCb = (data) => { try { event.sender.send('installer-install-progress', data); } catch {} };
    try {
        await installerEngine.headlessUninstall(parsed.store, parsed.appId);
        // Mirror of the install case: a Set that still lists this game would make
        // resolveInstallState() answer 1 and put Installed back, undoing the uninstall.
        invalidateInstallerInstalledCache();
        if (gameId && db) { try { db.prepare("UPDATE games SET Installed=0 WHERE id=?").run(gameId); } catch {} }
        try { event.sender.send('install-status-updated'); } catch {}
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    } finally {
        _installerBusy = false; _installerProgressCb = null;
    }
});

// ── Manage Storage: move and delete ──────────────────────────────────────────
// Candidate destinations for a move, in the shape Steam offers: every writable
// filesystem the machine actually has, with what is free on each.
//
// ⚠️ Read from /proc/mounts rather than a hardcoded list. A second drive is the
// whole reason this feature exists, and where it is mounted is the user's choice.
function storageTargets(currentPath) {
    const seen = new Set();
    const out  = [];
    const add  = (dir, label) => {
        if (!dir || seen.has(dir)) return;
        seen.add(dir);
        let free = null, dev = null;
        try { const st = fs.statfsSync(dir); free = st.bavail * st.bsize; } catch { return; }
        try { dev = fs.statSync(dir).dev; } catch {}
        out.push({ path: dir, label, freeBytes: free, dev });
    };

    // The directory the app installs into by default, and where this game is now.
    try { add(installerDefaultDir(), 'Default install folder'); } catch {}
    if (currentPath) { try { add(path.dirname(currentPath), 'Where it is now'); } catch {} }

    // Real filesystems. Pseudo and virtual ones are not places to put a game.
    const SKIP_FS = new Set(['proc','sysfs','devtmpfs','devpts','tmpfs','cgroup','cgroup2','pstore',
        'securityfs','debugfs','tracefs','configfs','fusectl','bpf','mqueue','hugetlbfs','autofs',
        'binfmt_misc','efivarfs','ramfs','squashfs','overlay','nsfs']);
    try {
        for (const line of fs.readFileSync('/proc/mounts', 'utf8').split('\n')) {
            const [, mountRaw, fstype] = line.split(' ');
            if (!mountRaw || SKIP_FS.has(fstype)) continue;
            const mount = mountRaw.replace(/\\040/g, ' ');
            if (mount === '/' ) { add(path.join(os.homedir(), 'Games'), 'Home'); continue; }
            if (!/^\/(mnt|media|run\/media)\//.test(mount) && mount !== os.homedir()) continue;
            try { fs.accessSync(mount, fs.constants.W_OK); } catch { continue; }
            add(mount, mount.split('/').filter(Boolean).pop() || mount);
        }
    } catch {}
    return out;
}

ipcMain.handle('installer-storage-targets', (_, currentPath) => {
    try { return { ok: true, targets: storageTargets(currentPath) }; }
    catch (e) { return { ok: false, error: e.message }; }
});

// Every place a game's own folder is written down. install_path is the one that
// matters; the other two only carry a path for games that are not GOG/Epic, and
// a move that updated the folder but not these would leave the game unlaunchable.
function repointGamePaths(oldDir, newDir, gameId) {
    let touched = 0;
    try {
        _installerEngineDb.prepare('UPDATE games SET install_path=? WHERE install_path=?').run(newDir, oldDir);
        touched++;
    } catch {}
    if (!db) return touched;
    for (const [table, col] of [['games','LaunchCommand'], ['games','LaunchCommands'], ['game_manuals','path']]) {
        try {
            const r = db.prepare(`UPDATE ${table} SET ${col} = REPLACE(${col}, ?, ?) WHERE ${col} LIKE ?`)
                        .run(oldDir, newDir, `%${oldDir}%`);
            touched += r.changes || 0;
        } catch {}
    }
    return touched;
}

// Copy a tree, then remove the original. Only for a move across filesystems, where
// rename() cannot work. Progress is by bytes so a 60GB game does not look frozen.
async function copyTreeWithProgress(src, dest, totalBytes, onProgress) {
    let copied = 0, lastTick = 0;
    const walk = async (from, to) => {
        await fs.promises.mkdir(to, { recursive: true });
        for (const entry of await fs.promises.readdir(from, { withFileTypes: true })) {
            const s = path.join(from, entry.name), d = path.join(to, entry.name);
            if (entry.isSymbolicLink()) {
                const link = await fs.promises.readlink(s);
                try { await fs.promises.symlink(link, d); } catch {}
            } else if (entry.isDirectory()) {
                await walk(s, d);
            } else if (entry.isFile()) {
                await fs.promises.copyFile(s, d);
                try { copied += (await fs.promises.stat(d)).size; } catch {}
                const now = Date.now();
                if (now - lastTick > 250) {
                    lastTick = now;
                    onProgress(Math.min(99, Math.round((copied / Math.max(1, totalBytes)) * 100)));
                }
            }
        }
    };
    await walk(src, dest);
}

ipcMain.handle('installer-move-game', async (event, { gameId, targetDir } = {}) => {
    if (_installerBusy) return { ok: false, error: 'Another install or move is in progress.' };
    if (!ensureInstallerEngine()) return { ok: false, error: 'Installer data not found.' };
    if (!targetDir) return { ok: false, error: 'No destination chosen.' };

    let row;
    try { row = _installerEngineDb.prepare('SELECT id,title,install_path FROM games WHERE id=?').get(gameId); }
    catch (e) { return { ok: false, error: e.message }; }
    if (!row || !row.install_path) return { ok: false, error: 'That game has no recorded folder.' };

    const src = row.install_path;
    if (!fs.existsSync(src)) return { ok: false, error: `Its folder is already gone:\n${src}` };

    const dest = path.join(targetDir, path.basename(src));
    if (dest === src) return { ok: false, error: 'It is already there.' };
    // Moving a folder inside itself would recurse until the disk filled.
    if (dest.startsWith(src + path.sep)) return { ok: false, error: 'That destination is inside the game\'s own folder.' };
    if (fs.existsSync(dest)) return { ok: false, error: `Something is already there:\n${dest}` };

    let size = 0;
    try { size = dirSizeBytes(src); } catch {}
    try {
        const st = fs.statfsSync(fs.existsSync(targetDir) ? targetDir : path.dirname(targetDir));
        if (st.bavail * st.bsize < size) return { ok: false, error: 'Not enough room on that drive.' };
    } catch {}

    _installerBusy = true;
    const send = (pct, note) => { try { event.sender.send('installer-move-progress', { gameId, pct, note }); } catch {} };
    try {
        await fs.promises.mkdir(targetDir, { recursive: true });
        let sameFs = false;
        try { sameFs = fs.statSync(path.dirname(src)).dev === fs.statSync(targetDir).dev; } catch {}

        if (sameFs) {
            send(50, 'Moving');
            await fs.promises.rename(src, dest);      // instant, whatever the size
        } else {
            send(0, 'Copying');
            await copyTreeWithProgress(src, dest, size, pct => send(pct, 'Copying'));
            send(99, 'Removing the original');
            await fs.promises.rm(src, { recursive: true, force: true });
        }
        repointGamePaths(src, dest, gameId);
        invalidateInstallerInstalledCache();
        try { event.sender.send('install-status-updated'); } catch {}
        send(100, 'Done');
        return { ok: true, from: src, to: dest, sameFs, bytes: size };
    } catch (e) {
        // A half-copied destination is worse than none: it would read as installed.
        try { if (fs.existsSync(dest) && !fs.existsSync(src)) { /* rename already succeeded */ } 
              else if (fs.existsSync(dest)) await fs.promises.rm(dest, { recursive: true, force: true }); } catch {}
        return { ok: false, error: e.message };
    } finally { _installerBusy = false; }
});

// Delete: a proper uninstall where the store engine can do one, and the folder
// otherwise. Both end with the game marked uninstalled in both databases.
ipcMain.handle('installer-delete-game', async (event, { gameId, installerGameId } = {}) => {
    if (_installerBusy) return { ok: false, error: 'Another install or move is in progress.' };
    if (!ensureInstallerEngine()) return { ok: false, error: 'Installer data not found.' };

    let row;
    try { row = _installerEngineDb.prepare('SELECT id,title,install_path FROM games WHERE id=?').get(gameId); }
    catch (e) { return { ok: false, error: e.message }; }
    if (!row) return { ok: false, error: 'That game is not in the installer library.' };

    const parsed = parseInstallerId(installerGameId || gameId);
    _installerBusy = true;
    _installerProgressCb = (data) => { try { event.sender.send('installer-install-progress', data); } catch {} };
    try {
        if (parsed) {
            await installerEngine.headlessUninstall(parsed.store, parsed.appId);
        } else if (row.install_path && fs.existsSync(row.install_path)) {
            await fs.promises.rm(row.install_path, { recursive: true, force: true });
            try { _installerEngineDb.prepare('UPDATE games SET installed=0 WHERE id=?').run(gameId); } catch {}
        } else {
            try { _installerEngineDb.prepare('UPDATE games SET installed=0 WHERE id=?').run(gameId); } catch {}
        }
        invalidateInstallerInstalledCache();
        if (db) { try { db.prepare('UPDATE games SET Installed=0 WHERE InstallerGameId=?').run(gameId); } catch {} }
        try { event.sender.send('install-status-updated'); } catch {}
        return { ok: true, freed: row.install_path || '' };
    } catch (e) {
        return { ok: false, error: e.message };
    } finally { _installerBusy = false; _installerProgressCb = null; }
});

// Default install dir + a native folder picker for the install dialog.
ipcMain.handle('installer-default-dir', () => { ensureInstallerEngine(); return installerDefaultDir(); });
ipcMain.handle('installer-pick-dir', async (_, current) => {
    // NOTE: `win` is local to createWindow(), referencing it here threw a ReferenceError that
    // rejected the invoke, so the install dialog's "Change" button silently did nothing.
    const parent = BrowserWindow.getFocusedWindow();
    const opts = { properties: ['openDirectory', 'createDirectory'] };
    const start = expandTilde(current || installerDefaultDir());
    if (start && fs.existsSync(start)) opts.defaultPath = start;
    const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    return (!r.canceled && r.filePaths[0]) ? r.filePaths[0] : null;
});

// Persist the global default install folder (shared with the Installer face, which reads the
// same library.db setting). Passing an empty value restores the built-in default.
ipcMain.handle('installer-set-default-dir', (_, dir) => {
    if (!ensureInstallerEngine(true)) return { ok: false, error: 'Installer data not available.' };
    const clean = String(dir || '').trim();
    try {
        if (clean) {
            try { fs.mkdirSync(expandTilde(clean), { recursive: true }); }
            catch (e) { return { ok: false, error: `Cannot create "${clean}": ${e.message}` }; }
            _installerEngineDb.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('default_install_dir',?)").run(clean);
        } else {
            _installerEngineDb.prepare("DELETE FROM settings WHERE key='default_install_dir'").run();
        }
        return { ok: true, dir: installerDefaultDir() };
    } catch (e) { return { ok: false, error: e.message }; }
});

// Couch is now a face of this same binary (launched with --couch), so it's always available.
ipcMain.handle('check-couch', () => true);

function findEmuLattePath() {
    try {
        const f = fs.readdirSync(baseDir).find(n => /^EmuLatte\.(AppImage|appimage)$/i.test(n));
        return f ? path.join(baseDir, f) : null;
    } catch(e) { return null; }
}
ipcMain.handle('check-emulatte', () => !!findEmuLattePath());

// ── INSTALL STATUS HELPERS ────────────────────────────────────────────────
// Kept as a local name so the call sites below read unchanged.
const getSteamLibraryPaths = () => host.steamLibraryPaths();
function guessLauncherLabel(cmd) {
    if (!cmd) return 'Custom';
    if (/steam:\/\/rungameid/i.test(cmd))         return 'Steam';
    if (/installer:\/\/launch\/gog/i.test(cmd))      return 'GOG via Installer';
    if (/installer:\/\/launch\/epic/i.test(cmd))     return 'Epic via Installer';
    if (cmd.startsWith('itch://'))                return 'itch.io';
    if (cmd.startsWith('pico8-cart:'))            return 'PICO-8';
    if (/^flatpak run/i.test(cmd))               return 'Flatpak';
    if (cmd.startsWith('installer://'))             return 'Installer';
    return 'Custom';
}

// Which store a single launch command belongs to (null = manual/custom/emulator/etc.).
function launcherStore(cmd) {
    if (/steam:\/\/rungameid/i.test(cmd))        return 'steam';
    if (/installer:\/\/launch\/gog\//i.test(cmd))  return 'gog';
    if (/installer:\/\/launch\/epic\//i.test(cmd)) return 'epic';
    return null;
}

// Remove one store's presence from a library row after that store reports the game gone
// (Steam uninstall/refund, GOG/Epic refund). For a plain single-store entry the whole row is
// deleted; for a cross-store entry (same title merged from e.g. Steam + GOG) only the removed
// store's launcher + tag are stripped and the surviving store(s) keep the row. Returns
// 'deleted' | 'stripped'. `which` is 'steam' | 'gog' | 'epic'.
function pruneStoreEntry(row, which) {
    // Expanded, not raw: a mixed-store row whose other store is only implied by its Store tag
    // + id (see expandLaunchers) would otherwise look single-store here and get deleted whole
    // when the refunded store is the one that owns the primary command.
    const launchers = expandLaunchers(row);
    const remaining = launchers.filter(l => launcherStore(l.cmd || '') !== which);
    // Keep the row only if a DIFFERENT recognised store launcher survives; a leftover
    // unrecognised/dangling launcher (e.g. a bare installer://<id> fallback) still deletes.
    const survives = remaining.some(l => launcherStore(l.cmd || ''));

    if (survives) {
        let storeArr = (row.Store || '').split(',').map(s => s.trim()).filter(Boolean)
            .filter(s => s.toLowerCase() !== which);
        if (!storeArr.length) {
            const tag = { steam: 'Steam', gog: 'GOG', epic: 'EPIC' };
            storeArr = [...new Set(remaining.map(l => tag[launcherStore(l.cmd || '')]).filter(Boolean))];
        }
        const clearField = which === 'steam' ? 'SteamAppID' : 'InstallerGameId';
        db.prepare(`UPDATE games SET Store=?, LaunchCommand=?, LaunchCommands=?, ${clearField}=NULL WHERE id=?`)
          .run(storeArr.join(', '), remaining[0].cmd, JSON.stringify(remaining), row.id);
        return 'stripped';
    }
    db.prepare("DELETE FROM games WHERE id=?").run(row.id);
    return 'deleted';
}

function isSteamGameInstalled(appId) {
    if (!appId || appId === 'None' || appId === '') return false;
    const id = String(appId).replace(/\.0+$/, '');
    return getSteamLibraryPaths().some(dir => fs.existsSync(path.join(dir, `appmanifest_${id}.acf`)));
}

// ── Locate a game's on-disk install folder (Browse Local Files) ───────────────
// Steam → appmanifest "installdir" under steamapps/common; GOG/Epic → library.db
// install_path; everything else (custom / emulator / others) → an absolute path
// pulled out of its launch command(s). Returns an existing directory, or null.
function installerDbPath() {
    return host.findInstallerDb(baseDir);
}
function expandTilde(p) {
    return (p && p.startsWith('~')) ? path.join(os.homedir(), p.slice(1)) : p;
}
// Best-effort: pull a real folder out of a custom / emulator launch command.
function folderFromLaunchCommand(cmd) {
    if (!cmd) return null;
    // URL-scheme launchers (steam://, installer://, itch://, pico8-cart:) carry no local
    // path. `flatpak run …` is NOT excluded: an emulator command such as
    // `flatpak run org.libretro.RetroArch -L core rom` still yields the ROM's folder,
    // while `flatpak run …hgl "installer://…"` has no path token and falls through to null.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(cmd) || /^pico8-cart:/i.test(cmd)) return null;
    const tokens = cmd.match(/"[^"]+"|'[^']+'|\S+/g) || [];
    let best = null;
    for (let tok of tokens) {
        tok = tok.replace(/^["']|["']$/g, '');
        if (!(tok.startsWith('/') || tok.startsWith('~'))) continue;   // skip flags, VAR=…, bare binaries
        const p = expandTilde(tok);
        try { const st = fs.statSync(p); best = st.isDirectory() ? p : path.dirname(p); } catch {}
    }
    return best;   // last existing path wins (the game exe/content usually trails the runner)
}
function resolveGameFolder(game) {
    if (!game) return null;
    // 1. Steam, appmanifest installdir → steamapps/common/<installdir>
    const appid = game.SteamAppID ? String(game.SteamAppID).replace(/\.0+$/, '') : '';
    if (appid && appid !== 'None') {
        for (const dir of getSteamLibraryPaths()) {
            const manifest = path.join(dir, `appmanifest_${appid}.acf`);
            if (!fs.existsSync(manifest)) continue;
            try {
                const m = fs.readFileSync(manifest, 'utf8').match(/"installdir"\s+"([^"]+)"/i);
                if (m) { const gd = path.join(dir, 'common', m[1]); if (fs.existsSync(gd)) return gd; }
            } catch {}
        }
    }
    // 2. GOG / Epic, library.db install_path (only when actually installed)
    if (game.InstallerGameId) {
        const gpath = installerDbPath();
        if (gpath) {
            try {
                const gdb = new Database(gpath, { readonly: true, timeout: 5000 });
                const row = gdb.prepare("SELECT install_path FROM games WHERE id=? AND installed=1").get(String(game.InstallerGameId));
                gdb.close();
                const ip = expandTilde((row && row.install_path) || '');
                if (ip && fs.existsSync(ip)) return ip;
            } catch {}
        }
    }
    // 3. Custom / emulator / others, derive from the launch command(s)
    const cmds = [];
    try { for (const l of JSON.parse(game.LaunchCommands || '[]')) if (l && l.cmd) cmds.push(l.cmd); } catch {}
    if (game.LaunchCommand) cmds.push(game.LaunchCommand);
    for (const c of cmds) { const d = folderFromLaunchCommand(c); if (d) return d; }
    return null;
}
// Renderer asks whether a browsable folder exists (to show/hide the hero button).
ipcMain.handle('resolve-game-folder', (e, gameId) => {
    if (!db) return null;
    try { return resolveGameFolder(db.prepare("SELECT Store, SteamAppID, InstallerGameId, LaunchCommand, LaunchCommands FROM games WHERE id=?").get(gameId)); }
    catch { return null; }
});
// Open the game's install folder in the system file manager.
ipcMain.handle('open-game-folder', (e, gameId) => {
    if (!db) return { ok: false };
    let game; try { game = db.prepare("SELECT Store, SteamAppID, InstallerGameId, LaunchCommand, LaunchCommands FROM games WHERE id=?").get(gameId); } catch { return { ok: false }; }
    const folder = resolveGameFolder(game);
    if (!folder) return { ok: false };
    shell.openPath(folder);
    return { ok: true, folder };
});

// ── GOG SAVE-GAME MANAGER ─────────────────────────────────────────────────────
// Locate a GOG game's save folder(s), back them up to a portable .zip and restore
// them, the piece GOG-on-Linux completely lacks (no Galaxy). Desktop/Manager face
// only. Windows/Proton games resolve saves in 3 tiers (.script → Wine-profile scan →
// install-dir scan); native-Linux games fall back to a manual "Locate saves…" pick.
// Design + empirical validation: plan floofy-rolling-pixel.md.
const AdmZip = require('adm-zip');

// GOG installer-script {tokens} → real dirs under the Wine prefix / install dir.
// (Distinct from GOG's *cloud* <?…?> token set, do NOT mix the two.)
const GOG_SAVE_TOKENS = {
    '{app}':          (c) => c.install,
    '{userdocs}':     (c) => path.join(c.win, 'Documents'),
    '{userappdata}':  (c) => path.join(c.win, 'AppData', 'Roaming'),
    '{localappdata}': (c) => path.join(c.win, 'AppData', 'Local'),
    '{supportDir}':   (c) => path.join(c.install || '', '__redist'),
    '{productID}':    (c) => String(c.appId || ''),
};
function resolveGogToken(tmpl, ctx) {
    const t = String(tmpl).replace(/\\/g, '/');                     // GOG uses '/', but normalise any '\' defensively
    const m = t.match(/^\{[a-zA-Z]+\}/);
    if (!m || !GOG_SAVE_TOKENS[m[0]]) return null;
    const root = GOG_SAVE_TOKENS[m[0]](ctx);
    if (!root) return null;
    return path.normalize(root + t.slice(m[0].length));             // collapses the /../ sibling hops
}

// Wine's "Windows" user home inside a prefix (Proton uses "steamuser").
function winUserHome(prefix) {
    if (!prefix) return null;
    const users = path.join(prefix, 'drive_c', 'users');
    const steam = path.join(users, 'steamuser');
    if (fs.existsSync(steam)) return steam;
    try {
        const other = fs.readdirSync(users).find(u => u !== 'Public' && fs.statSync(path.join(users, u)).isDirectory());
        if (other) return path.join(users, other);
    } catch {}
    return steam;   // best guess even if absent (⇒ "no saves yet")
}

// A goggame-*.script in the install dir may DECLARE the save folder (authoritative).
function scriptSavePaths(installDir) {
    if (!installDir) return [];
    let files = [];
    try { files = fs.readdirSync(installDir).filter(f => /^goggame-.*\.script$/i.test(f)); } catch { return []; }
    const out = [];
    for (const f of files) {
        try {
            const d = JSON.parse(fs.readFileSync(path.join(installDir, f), 'utf8'));
            for (const a of (d.actions || [])) {
                const sp = a && a.install && a.install.action === 'savePath' && a.install.arguments && a.install.arguments.savePath;
                if (sp) out.push(sp);
            }
        } catch {}
    }
    return out;
}

// ── Epic (legendary) authoritative source: CloudSaveFolder from the game metadata ──
// legendary uses the standard ~/.config/legendary (confirmed against Installer).
const legendaryDir = () => host.legendaryConfigDir();
function epicAccountId() {
    try { const u = JSON.parse(fs.readFileSync(path.join(legendaryDir(), 'user.json'), 'utf8')); return u.account_id || u.accountId || ''; } catch { return ''; }
}
// Epic declares its save folder as a template in metadata/<appId>.json (parallel to GOG's .script).
function epicCloudSaveFolders(appId) {
    if (!appId) return [];
    try {
        const d = JSON.parse(fs.readFileSync(path.join(legendaryDir(), 'metadata', `${appId}.json`), 'utf8'));
        const v = d && d.metadata && d.metadata.customAttributes && d.metadata.customAttributes.CloudSaveFolder && d.metadata.customAttributes.CloudSaveFolder.value;
        return v ? [v] : [];
    } catch { return []; }
}
// Epic CloudSaveFolder {tokens}. {AppData} = AppData\Local (verified); case-insensitive; a template
// may hold several tokens, e.g. {AppData}/Remedy/AlanWake2/{EpicID}.
const EPIC_SAVE_TOKENS = {
    installdir:     (c) => c.install,
    epicid:         (c) => c.epicId,
    appdata:        (c) => path.join(c.win, 'AppData', 'Local'),
    localappdata:   (c) => path.join(c.win, 'AppData', 'Local'),
    userdir:        (c) => path.join(c.win, 'Documents'),
    userprofile:    (c) => c.win,
    usersavedgames: (c) => path.join(c.win, 'Saved Games'),
};
function resolveEpicToken(tmpl, ctx) {
    // Epic CloudSaveFolder values are Windows paths that may use '\' separators; normalise to '/'
    // first, since path.normalize on Linux treats '\' as a literal filename character.
    const out = String(tmpl).replace(/\\/g, '/').replace(/\{([a-zA-Z]+)\}/g, (m, name) => {
        const fn = EPIC_SAVE_TOKENS[name.toLowerCase()];
        const v = fn && fn(ctx);
        return v ? v : m;
    });
    if (/\{[a-zA-Z]+\}/.test(out)) return null;              // an unknown token remained → bail
    return path.normalize(out.replace(/\/+$/, ''));          // drop any trailing slash the template had
}

// Does a directory contain at least one file (walked, budget-capped)? Drops empty Wine stubs.
function dirHasFiles(dir, budget = 400) {
    const stack = [dir];
    while (stack.length && budget-- > 0) {
        const cur = stack.pop();
        let ents; try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
        for (const e of ents) {
            if (e.isFile()) return true;
            if (e.isDirectory()) stack.push(path.join(cur, e.name));
        }
    }
    return false;
}

// Wine seeds every prefix with empty XDG stubs (Downloads/Music/…), never a save on their own.
const SAVE_DOC_STUBS = new Set(['downloads','music','pictures','videos','desktop','contacts','links',
    'searches','favorites','my music','my pictures','my videos','onedrive','nethood','printhood',
    'templates','start menu','sendto','recent','application data','local settings']);
const SAVE_LOCAL_NOISE = /^(dxvk|temp|inetcache|microsoft|packages|connecteddevicesplatform|d3dscache|d3d12|crashdumps|gog\.com|comms|history|iconcache|virtualstore|programs|nvidia|amd|epic games|epicgameslauncher|easyanticheat|battleye)$/i;
const SAVE_WIN_ROOTS = ['Saved Games', 'Documents/My Games', 'AppData/LocalLow', 'AppData/Roaming', 'AppData/Local', 'Documents'];

// Tier 2: scan the Wine user profile, denylisting stubs and requiring real content.
function scanWinProfile(win) {
    if (!win) return [];
    const seen = new Set(), out = [];
    for (const rel of SAVE_WIN_ROOTS) {
        const base = path.join(win, ...rel.split('/'));
        let subs; try { subs = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
        for (const e of subs) {
            if (!e.isDirectory()) continue;
            if (rel === 'Documents' && SAVE_DOC_STUBS.has(e.name.toLowerCase())) continue;
            if (rel.startsWith('AppData/Local') && SAVE_LOCAL_NOISE.test(e.name)) continue;
            const dir = path.join(base, e.name);
            let real; try { real = fs.realpathSync(dir); } catch { real = dir; }
            if (seen.has(real) || !dirHasFiles(dir)) continue;
            seen.add(real);
            let mtime = 0; try { mtime = fs.statSync(dir).mtimeMs; } catch {}
            const boost = (rel === 'Saved Games' || rel === 'Documents/My Games') ? 2 : (/LocalLow|Roaming/.test(rel) ? 1 : 0);
            out.push({ dir, boost, mtime });
        }
    }
    out.sort((a, b) => (b.boost - a.boost) || (b.mtime - a.mtime));
    return out.slice(0, 6);
}

// Tier 3: classic games save INSIDE the install dir, match STRONG save-name signals only.
const SAVE_STRONG_DIR = /^(saves?|savegames?|saved|savedata|slot.*)$/i;
const SAVE_STRONG_FILE = /\.sav(e)?$/i;
function scanInstallDir(installDir) {
    if (!installDir || !fs.existsSync(installDir)) return [];
    const out = [], seen = new Set();
    let budget = 6000;
    const walk = (dir, depth) => {
        if (depth > 3 || budget <= 0) return;
        let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
            if (budget-- <= 0) return;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (SAVE_STRONG_DIR.test(e.name)) { if (dirHasFiles(full) && !seen.has(full)) { seen.add(full); out.push({ dir: full }); } }
                else walk(full, depth + 1);
            } else if (SAVE_STRONG_FILE.test(e.name) && !seen.has(dir)) { seen.add(dir); out.push({ dir }); }
        }
    };
    walk(installDir, 0);
    return out.slice(0, 6);
}

// Classify a resolved dir relative to the prefix user-home or install dir, so a backup
// can be re-homed on restore (portable across machines / moved prefixes).
function classifySaveDir(dir, win, install) {
    const abs = path.resolve(dir);
    if (win)     { const w = path.resolve(win);     if (abs === w || abs.startsWith(w + path.sep)) return { root: 'winhome', rel: path.relative(w, abs) }; }
    if (install) { const i = path.resolve(install); if (abs === i || abs.startsWith(i + path.sep)) return { root: 'install', rel: path.relative(i, abs) }; }
    return { root: 'abs', rel: abs };
}

// A "shared root" that must never be treated as one game's save folder or wiped on restore:
// the prefix user-home, the install root, or a top-level profile folder (Documents, AppData\*,
// Saved Games, …). Anything shallower than a game-specific subfolder qualifies.
function isSharedSaveRoot(dir, win, install) {
    const abs = path.resolve(dir);
    if (win && abs === path.resolve(win)) return true;
    if (install && abs === path.resolve(install)) return true;
    if (win) for (const r of SAVE_WIN_ROOTS) if (abs === path.resolve(win, ...r.split('/'))) return true;
    const cls = classifySaveDir(dir, win, install);
    if (cls.root === 'abs') return true;                       // outside the known prefix/install → unsafe
    return !cls.rel || cls.rel.split(path.sep).length < 2;     // top-level directly under winhome/install
}

// ctx: { store, platform, prefix, install, appId, epicId, override } → ranked save-dir candidates.
function resolveSaveDirs(ctx) {
    const win = ctx.platform === 'windows' ? winUserHome(ctx.prefix) : null;
    const mk = (dir, source, confidence) => {
        const { root, rel } = classifySaveDir(dir, win, ctx.install);
        const label = root === 'winhome' ? rel.split(path.sep).join('/')
                    : root === 'install' ? '…/' + rel.split(path.sep).join('/') : dir;
        return { dir, source, confidence, root, rel, label };
    };
    // 0. Manual override always wins.
    if (ctx.override && fs.existsSync(ctx.override)) {
        const c = mk(ctx.override, 'manual', 1.0); c.checked = true;
        return { native: ctx.platform !== 'windows', candidates: [c], override: ctx.override };
    }
    const cands = [];
    if (ctx.platform === 'windows' && win) {
        // 1. Authoritative store template, GOG .script savePath / Epic CloudSaveFolder.
        const templates = ctx.store === 'epic' ? epicCloudSaveFolders(ctx.appId) : scriptSavePaths(ctx.install);
        for (const tmpl of templates) {
            const resolved = [];   // candidate absolute paths, best first
            if (ctx.store === 'epic') {
                const full = resolveEpicToken(tmpl, { win, install: ctx.install, epicId: ctx.epicId });
                if (full) {
                    resolved.push(full);
                    // Epic's {EpicID} leaf is a cloud-sync convention Proton games rarely create → fall back to the
                    // game folder, but never to a shared root (e.g. a bare {AppData}/{EpicID} would strip to AppData\Local).
                    const segs = String(tmpl).replace(/[\\/]+$/, '').split(/[\\/]/);
                    if (/^\{[a-zA-Z]+\}$/.test(segs[segs.length - 1])) {
                        const parent = path.dirname(full);
                        if (!isSharedSaveRoot(parent, win, ctx.install)) resolved.push(parent);
                    }
                }
            } else {
                const d = resolveGogToken(tmpl, { win, install: ctx.install, appId: ctx.appId });
                if (d) resolved.push(d);
            }
            // Must stay within prefix/install; take the first that exists (authoritative, even if empty).
            const pick = resolved.find(d => classifySaveDir(d, win, ctx.install).root !== 'abs' && fs.existsSync(d));
            if (pick) cands.push(mk(pick, 'store', 0.95));
        }
        if (!cands.length) for (const h of scanWinProfile(win))       cands.push(mk(h.dir, 'detected', 0.5));  // 2.
        if (!cands.length) for (const h of scanInstallDir(ctx.install)) cands.push(mk(h.dir, 'detected', 0.5)); // 3.
    } else {
        for (const h of scanInstallDir(ctx.install)) cands.push(mk(h.dir, 'detected', 0.4));   // native: best-effort only
    }
    const uniq = [], seen = new Set();
    for (const c of cands) { const k = path.resolve(c.dir); if (seen.has(k)) continue; seen.add(k); uniq.push(c); }
    uniq.forEach((c, i) => { c.checked = c.source === 'store' ? dirHasFiles(c.dir) : i === 0; });   // pre-check non-empty authoritative hits / strongest heuristic
    return { native: ctx.platform !== 'windows', candidates: uniq, override: '' };
}

// Load both DB rows + resolve prefix/install/platform for a GOG game. null ⇒ not a GOG game.
function saveGameContext(gameId) {
    if (!db) return null;
    let row; try { row = db.prepare("SELECT id, Game, Store, InstallerGameId, SaveDirOverride, SteamAppID, LaunchCommand, LaunchCommands FROM games WHERE id=?").get(gameId); } catch { return null; }
    const gid = String(row?.InstallerGameId || '');
    if (!row || !/^(gog|epic)_/i.test(gid)) return { supported: false };
    if (!ensureInstallerEngine()) return { supported: false };
    let grow; try { grow = _installerEngineDb.prepare("SELECT id, title, prefix_path, install_path, platform, store, app_id FROM games WHERE id=?").get(gid); } catch {}
    if (!grow) return { supported: false };
    const store   = /^epic_/i.test(gid) ? 'epic' : 'gog';
    const prefix  = installerEngine.prefixPathForGame(grow);
    const install = expandTilde(grow.install_path || '') || resolveGameFolder(row) || '';
    // Epic on Linux is always Proton (no native builds), treat blank platform as 'windows'.
    return { supported: true, store, row, grow, ctx: {
        store, platform: grow.platform || 'windows', prefix, install,
        appId: grow.app_id, title: grow.title || row.Game, override: row.SaveDirOverride || '',
        epicId: store === 'epic' ? epicAccountId() : '',
    } };
}

function saveDateStamp() { return new Date().toISOString().slice(0, 10); }
function saveSafeName(s) { return String(s || 'game').replace(/[/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'game'; }

// Resolve the save location(s) + prior backups for the gamepage Saves panel.
ipcMain.handle('gog-saves-resolve', (_, gameId) => {
    const c = saveGameContext(gameId);
    if (!c || !c.supported) return { ok: true, supported: false, candidates: [] };
    const r = resolveSaveDirs(c.ctx);
    let backups = [];
    try { backups = db.prepare("SELECT path, created, bytes, source FROM save_backups WHERE game_id=? ORDER BY created DESC LIMIT 20").all(gameId); } catch {}
    backups = backups.filter(b => { try { return fs.existsSync(b.path); } catch { return false; } });
    return { ok: true, supported: true, store: c.store, native: r.native, title: c.ctx.title, candidates: r.candidates, override: r.override, backups };
});

// Back up the user-checked save folder(s) to a portable .zip (read-only on the saves).
ipcMain.handle('gog-backup-saves', async (_, gameId, dirs) => {
    const c = saveGameContext(gameId);
    if (!c || !c.supported) return { ok: false, error: 'Saves aren\'t supported for this game.' };
    const win = c.ctx.platform === 'windows' ? winUserHome(c.ctx.prefix) : null;
    const chosen = (Array.isArray(dirs) ? dirs : []).filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
    if (!chosen.length) return { ok: false, error: 'No save folders selected.' };
    const { canceled, filePath } = await dialog.showSaveDialog({
        title: `Back Up Saves, ${c.ctx.title}`,
        defaultPath: `Clarity Saves - ${saveSafeName(c.ctx.title)} - ${saveDateStamp()}.zip`,
        filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
        const zip = new AdmZip();
        const manifest = { kind: 'gog-saves', app: 'Clarity', created: Date.now(), title: c.ctx.title, installerGameId: c.grow.id, appId: c.ctx.appId, dirs: [] };
        chosen.forEach((dir, i) => {
            const { root, rel } = classifySaveDir(dir, win, c.ctx.install);
            zip.addLocalFolder(dir, `dir_${i}`);
            manifest.dirs.push({ index: i, abs: dir, root, rel, base: path.basename(dir) });
        });
        zip.addFile('cn-gog-saves.json', Buffer.from(JSON.stringify(manifest, null, 2)));
        zip.writeZip(filePath);
        let bytes = 0; try { bytes = fs.statSync(filePath).size; } catch {}
        try { db.prepare("INSERT INTO save_backups (game_id, path, created, bytes, source) VALUES (?,?,?,?,?)").run(gameId, filePath, Date.now(), bytes, 'manual'); } catch {}
        return { ok: true, path: filePath, dirs: chosen.length };
    } catch (e) { return { ok: false, error: e.message }; }
});

// Open a backup .zip, validate it, and re-home each backed-up dir onto THIS machine.
function saveRestoreTargets(zipPath, c) {
    let zip, manifest;
    try { zip = new AdmZip(zipPath); manifest = JSON.parse(zip.readAsText('cn-gog-saves.json') || '{}'); } catch { return { error: 'Not a Clarity saves backup.' }; }
    if (manifest.kind !== 'gog-saves' || !Array.isArray(manifest.dirs)) return { error: 'Unrecognized backup file.' };
    const win = c.ctx.platform === 'windows' ? winUserHome(c.ctx.prefix) : null;
    const targets = manifest.dirs.map(d =>
        (d.root === 'winhome' && win)           ? path.join(win, d.rel) :
        (d.root === 'install' && c.ctx.install) ? path.join(c.ctx.install, d.rel) : d.abs);
    return { zip, manifest, targets };
}

// Restore step 1, pick/validate the zip and return the re-homed targets. The renderer
// shows its OWN themed confirm (not a native message box) before committing.
ipcMain.handle('gog-restore-preview', async (_, gameId, zipPath) => {
    const c = saveGameContext(gameId);
    if (!c || !c.supported) return { ok: false, error: 'Saves aren\'t supported for this game.' };
    let src = zipPath;
    if (!src) {
        const { canceled, filePaths } = await dialog.showOpenDialog({ title: 'Restore Saves', properties: ['openFile'], filters: [{ name: 'Zip archive', extensions: ['zip'] }] });
        if (canceled || !filePaths || !filePaths.length) return { ok: false, canceled: true };
        src = filePaths[0];
    }
    const r = saveRestoreTargets(src, c);
    if (r.error) return { ok: false, error: r.error };
    return { ok: true, zipPath: src, title: c.ctx.title, targets: r.targets };
});

// Restore step 2, snapshot the CURRENT saves, then overwrite. Called after the themed confirm.
ipcMain.handle('gog-restore-commit', async (_, gameId, zipPath) => {
    const c = saveGameContext(gameId);
    if (!c || !c.supported) return { ok: false, error: 'Saves aren\'t supported for this game.' };
    if (!zipPath) return { ok: false, error: 'No backup specified.' };
    const r = saveRestoreTargets(zipPath, c);
    if (r.error) return { ok: false, error: r.error };
    const { zip, manifest, targets } = r;
    // Snapshot-before-overwrite.
    try {
        const snapDir = path.join(configDir, 'save-backups');
        fs.mkdirSync(snapDir, { recursive: true });
        const snap = new AdmZip(); let any = false;
        targets.forEach((t, i) => { if (fs.existsSync(t)) { snap.addLocalFolder(t, `dir_${i}`); any = true; } });
        if (any) {
            snap.addFile('cn-gog-saves.json', Buffer.from(JSON.stringify({ ...manifest, snapshot: true, created: Date.now() }, null, 2)));
            const sp = path.join(snapDir, `${saveSafeName(c.ctx.title)} - pre-restore - ${saveDateStamp()} - ${Date.now()}.zip`);
            snap.writeZip(sp);
            try { db.prepare("INSERT INTO save_backups (game_id, path, created, bytes, source) VALUES (?,?,?,?,?)").run(gameId, sp, Date.now(), fs.statSync(sp).size, 'pre-restore'); } catch {}
        }
    } catch (e) { return { ok: false, error: 'Could not make a safety snapshot: ' + e.message }; }
    // True replace: wipe each target folder first so files that exist only in the CURRENT saves
    // don't linger (the "overwrites" the confirm promised). The pre-restore snapshot above makes
    // this recoverable. Never wipe a shared root (a legacy/over-broad backup), merge into it instead.
    const win = c.ctx.platform === 'windows' ? winUserHome(c.ctx.prefix) : null;
    for (const t of targets) {
        if (fs.existsSync(t) && !isSharedSaveRoot(t, win, c.ctx.install)) {
            try { fs.rmSync(t, { recursive: true, force: true }); } catch {}
        }
    }
    // Extract each dir_i into its target (guarded against zip path-traversal).
    let restored = 0;
    try {
        for (const e of zip.getEntries()) {
            if (e.isDirectory) continue;
            const m = e.entryName.match(/^dir_(\d+)\/(.+)$/);
            if (!m) continue;
            const target = targets[Number(m[1])];
            if (!target) continue;
            const dest = path.join(target, m[2]);
            if (dest !== target && !path.resolve(dest).startsWith(path.resolve(target) + path.sep)) continue;
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, e.getData());
            restored++;
        }
    } catch (e) { return { ok: false, error: e.message }; }
    return { ok: true, restored };
});

// Delete a previous backup .zip (only files we logged for THIS game, never arbitrary paths).
ipcMain.handle('gog-delete-backup', (_, gameId, backupPath) => {
    if (!db || !backupPath) return { ok: false };
    let row; try { row = db.prepare("SELECT id FROM save_backups WHERE game_id=? AND path=?").get(gameId, backupPath); } catch {}
    if (!row) return { ok: false, error: 'Unknown backup.' };
    try { fs.rmSync(backupPath, { force: true }); } catch {}
    try { db.prepare("DELETE FROM save_backups WHERE id=?").run(row.id); } catch {}
    return { ok: true };
});

// "Locate saves…", user points at the folder; overrides auto-detection for this game.
// Opens the picker AT the game's Wine user-home so Documents / AppData / Saved Games are one click away.
ipcMain.handle('gog-set-save-override', async (_, gameId) => {
    if (!db) return { ok: false };
    const c = saveGameContext(gameId);
    const win = c && c.supported && c.ctx.platform === 'windows' ? winUserHome(c.ctx.prefix) : null;
    const startAt = (win && fs.existsSync(win)) ? win : (c && c.supported && c.ctx.install && fs.existsSync(c.ctx.install) ? c.ctx.install : undefined);
    const opts = { title: 'Locate Save Folder', properties: ['openDirectory'] };
    if (startAt) opts.defaultPath = startAt;
    const { canceled, filePaths } = await dialog.showOpenDialog(opts);
    if (canceled || !filePaths || !filePaths.length) return { ok: false, canceled: true };
    try { db.prepare("UPDATE games SET SaveDirOverride=? WHERE id=?").run(filePaths[0], gameId); } catch (e) { return { ok: false, error: e.message }; }
    return { ok: true, dir: filePaths[0] };
});
// Clear the manual override → back to auto-detection.
ipcMain.handle('gog-clear-save-override', (_, gameId) => {
    if (!db) return { ok: false };
    try { db.prepare("UPDATE games SET SaveDirOverride=NULL WHERE id=?").run(gameId); } catch (e) { return { ok: false, error: e.message }; }
    return { ok: true };
});

// Steam tools/runtimes that live as appmanifests but are not games.
function isSteamInfraApp(name) {
    return /^(Proton\b|Steam Linux Runtime|Steamworks Common Redistributables)/i.test(name || '');
}

// Upsert one Steam game (by appid) into the library. Returns 'added' | 'updated' | null.
// Shared by the Web-API import loop (sync-steam) and the local-appmanifest fallback scan,
// so both paths get identical dedup/cross-store-merge behaviour.
function upsertSteamGame(appid, rawName) {
    appid = String(appid);
    const name = rawName ? rawName.trim() : 'Unknown Game';
    if (!name) return null;

    const launchCommand = host.steamLaunchCommand(appid);
    const isInstalled = isSteamGameInstalled(appid) ? 1 : 0;

    // Match only by exact LaunchCommand or SteamAppID, never by game name,
    // to prevent merging separate store entries (e.g. GOG + Steam of the same title).
    const existing = db.prepare(
        "SELECT * FROM games WHERE LaunchCommand = ? OR (SteamAppID = ? AND SteamAppID IS NOT NULL AND SteamAppID != '' AND SteamAppID != 'None')"
    ).get(launchCommand, appid);

    if (existing) {
        const existingCmd = existing.LaunchCommand || '';
        if (/steam:\/\/rungameid/i.test(existingCmd)) {
            // Pure Steam update, refresh SteamAppID and install status
            db.prepare("UPDATE games SET SteamAppID=?, Installed=? WHERE id=?")
              .run(appid, isInstalled, existing.id);
            // Also check for a sibling non-Steam entry with the same title (pre-existing duplicate)
            //, if found, merge the Steam launcher into it and delete this Steam-only orphan
            const sibling = db.prepare(
                "SELECT * FROM games WHERE LOWER(TRIM(Game))=LOWER(TRIM(?)) AND id != ? AND Store NOT LIKE '%Steam%'"
            ).get(name, existing.id);
            if (sibling) {
                let launchers = [];
                try { launchers = JSON.parse(sibling.LaunchCommands || '[]'); } catch(e) {}
                if (launchers.length === 0 && sibling.LaunchCommand) {
                    launchers.push({ label: guessLauncherLabel(sibling.LaunchCommand), cmd: sibling.LaunchCommand });
                }
                if (!launchers.some(l => l.cmd === launchCommand)) {
                    launchers.push({ label: 'Steam', cmd: launchCommand });
                }
                const storeArr = (sibling.Store || '').split(',').map(s => s.trim()).filter(Boolean);
                if (!storeArr.some(s => s.toLowerCase() === 'steam')) storeArr.push('Steam');
                db.prepare("UPDATE games SET Store=?, SteamAppID=?, Installed=?, LaunchCommands=? WHERE id=?")
                  .run(storeArr.join(', '), appid,
                       Math.max(isInstalled, sibling.Installed || 0),
                       JSON.stringify(launchers), sibling.id);
                db.prepare("DELETE FROM games WHERE id=?").run(existing.id);
            }
        } else {
            // Cross-store merge, append Steam launcher to LaunchCommands, keep existing as primary
            let launchers = [];
            try { launchers = JSON.parse(existing.LaunchCommands || '[]'); } catch(e) {}
            if (launchers.length === 0 && existingCmd) {
                launchers.push({ label: guessLauncherLabel(existingCmd), cmd: existingCmd });
            }
            if (!launchers.some(l => l.cmd === launchCommand)) {
                launchers.push({ label: 'Steam', cmd: launchCommand });
            }
            const storeArr = (existing.Store || '').split(',').map(s => s.trim()).filter(Boolean);
            if (!storeArr.some(s => s.toLowerCase() === 'steam')) storeArr.push('Steam');
            db.prepare("UPDATE games SET Store=?, SteamAppID=?, Installed=?, LaunchCommands=? WHERE id=?")
              .run(storeArr.join(', '), appid,
                   Math.max(isInstalled, existing.Installed || 0),
                   JSON.stringify(launchers), existing.id);
        }
        return 'updated';
    }

    // Fallback: title match against a non-Steam entry with no SteamAppID yet
    // (covers the case where GOG/Epic was imported via Installer before Steam sync)
    const titleMatch = db.prepare(
        "SELECT * FROM games WHERE LOWER(TRIM(Game))=LOWER(TRIM(?)) AND Store NOT LIKE '%Steam%' AND (SteamAppID IS NULL OR SteamAppID='' OR SteamAppID='None')"
    ).get(name);

    if (titleMatch) {
        const existingCmd = titleMatch.LaunchCommand || '';
        let launchers = [];
        try { launchers = JSON.parse(titleMatch.LaunchCommands || '[]'); } catch(e) {}
        if (launchers.length === 0 && existingCmd) {
            launchers.push({ label: guessLauncherLabel(existingCmd), cmd: existingCmd });
        }
        if (!launchers.some(l => l.cmd === launchCommand)) {
            launchers.push({ label: 'Steam', cmd: launchCommand });
        }
        const storeArr = (titleMatch.Store || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!storeArr.some(s => s.toLowerCase() === 'steam')) storeArr.push('Steam');
        db.prepare("UPDATE games SET Store=?, SteamAppID=?, Installed=?, LaunchCommands=? WHERE id=?")
          .run(storeArr.join(', '), appid,
               Math.max(isInstalled, titleMatch.Installed || 0),
               JSON.stringify(launchers), titleMatch.id);
        return 'updated';
    }

    db.prepare("INSERT INTO games (Store, Game, SteamAppID, LaunchCommand, FAV, WANT_TO_PLAY, Installed) VALUES (?, ?, ?, ?, 'NO', 'NO', ?)")
      .run("Steam", name, appid, launchCommand, isInstalled);
    return 'added';
}

// ── Disk footprint scan ──────────────────────────────────────────────────────
function _dirSizeBytes(dir) {
    let total = 0, guard = 0; const stack = [dir];
    while (stack.length && guard < 400000) {
        const d = stack.pop();
        let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
            guard++;
            if (e.isSymbolicLink()) continue;
            const p = path.join(d, e.name);
            if (e.isDirectory()) stack.push(p);
            else { try { total += fs.statSync(p).size; } catch {} }
        }
    }
    return total;
}
function _diskStoreBucket(s) {
    s = (s || '').toLowerCase();
    if (s.includes('steam')) return 'Steam'; if (s.includes('gog')) return 'GOG'; if (s.includes('epic')) return 'Epic';
    if (s.includes('itch')) return 'itch.io'; if (s.includes('flatpak')) return 'Flatpak'; if (s.includes('pico')) return 'PICO-8';
    if (s.includes('emulation')) return 'Emulation'; if (s.includes('physical')) return 'Physical'; if (s.includes('apps')) return 'Apps';
    if (s.includes('others')) return 'Others'; return 'Other';
}
// Which games have a native macOS build, Steam via its public store API (platforms.mac),
// GOG/Epic via library.db's platform/platforms (already correctly tagged 'osx' there, see
// darwin.js and the GOG_CATALOG_OS_ALIAS fix in installer-engine.js). Only meaningful on macOS;
// gated by host.id so a Linux run of this same shared file never touches it.
//
// Steam's endpoint needs a live call per game with no bulk form, so results are cached in
// MacNativeChecked and only re-asked with force. GOG/Epic reads are free (local library.db),
// so those always refresh.
let _macNativeScanRunning = false;
ipcMain.handle('scan-mac-native', async (evt, opts) => {
    if (host.id !== 'darwin') return { ok: false, error: 'macOS only.' };
    if (!db) return { ok: false, error: 'Library not ready.' };
    if (_macNativeScanRunning) return { ok: false, error: 'already_running' };
    _macNativeScanRunning = true;
    const force = !!(opts && opts.force);
    const send = (scanned, total, label) => { try { evt.sender.send('mac-native-scan-progress', { scanned, total, label }); } catch {} };
    try {
        // GOG/Epic, free, local, always refreshed.
        const gpath = host.findInstallerDb(baseDir);
        const installerPlatforms = new Map();
        if (gpath) {
            try {
                const gdb = new Database(gpath, { readonly: true, timeout: 5000 });
                for (const r of gdb.prepare("SELECT id, platform, platforms FROM games").all())
                    installerPlatforms.set(String(r.id), `${r.platform || ''},${r.platforms || ''}`);
                gdb.close();
            } catch {}
        }
        const installerRows = db.prepare("SELECT id, InstallerGameId FROM games WHERE InstallerGameId IS NOT NULL AND InstallerGameId != ''").all();
        let updated = 0;
        for (const g of installerRows) {
            // library.db's own `id` column already carries the store_appid form ("gog_123…"),
            // same as InstallerGameId itself, key on that directly, not the split appId (see
            // disk-scan's installerPaths for the same lookup done right).
            const blob = installerPlatforms.get(String(g.InstallerGameId)) || '';
            const isMac = blob.split(',').map(s => s.trim()).includes('osx');
            db.prepare("UPDATE games SET MacNative=?, MacNativeChecked=1 WHERE id=?").run(isMac ? 1 : 0, g.id);
            updated++;
        }

        // Steam, one live lookup per game, only for what hasn't been asked yet (or `force`).
        let steamRows = db.prepare(
            `SELECT id, SteamAppID FROM games WHERE SteamAppID IS NOT NULL AND SteamAppID != '' AND SteamAppID != 'None'` +
            (force ? '' : ' AND MacNativeChecked=0')
        ).all();
        const total = steamRows.length;
        let scanned = 0;
        for (const r of steamRows) {
            scanned++;
            const appId = String(r.SteamAppID).replace(/\.0+$/, '').trim();
            send(scanned, total, `Checking Steam #${appId}…`);
            let isMac = false;
            try {
                const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&filters=platforms`);
                const j = await res.json();
                isMac = !!j?.[appId]?.data?.platforms?.mac;
            } catch {}
            db.prepare("UPDATE games SET MacNative=?, MacNativeChecked=1 WHERE id=?").run(isMac ? 1 : 0, r.id);
            updated++;
            // Steam's public store API has no documented rate limit but is known to soft-throttle
            // bursts, a small gap per call is cheap insurance against a scan of hundreds of games
            // silently degrading into a wall of failed lookups partway through.
            await new Promise(res => setTimeout(res, 150));
        }
        send(total, total, '');
        return { ok: true, updated, macNative: db.prepare("SELECT COUNT(*) c FROM games WHERE MacNative=1").get().c };
    } catch (e) {
        return { ok: false, error: e.message };
    } finally {
        _macNativeScanRunning = false;
    }
});

ipcMain.handle('disk-get', () => { try { const raw = db.prepare("SELECT value FROM settings WHERE key='disk_usage'").get()?.value; return raw ? JSON.parse(raw) : null; } catch { return null; } });
ipcMain.handle('disk-scan', async () => {
    if (!db) return null;
    const home = os.homedir();
    // Steam: read SizeOnDisk straight from each appmanifest (cheap + exact).
    const steamSizes = new Map();
    for (const dir of getSteamLibraryPaths()) {
        let files; try { files = fs.readdirSync(dir); } catch { continue; }
        for (const f of files) {
            const idm = f.match(/^appmanifest_(\d+)\.acf$/); if (!idm) continue;
            try { const sm = fs.readFileSync(path.join(dir, f), 'utf8').match(/"SizeOnDisk"\s+"(\d+)"/i); if (sm) steamSizes.set(idm[1], parseInt(sm[1], 10)); } catch {}
        }
    }
    // Installer (GOG/Epic): install_path → directory size.
    const installerPaths = new Map();
    const gpath = host.findInstallerDb(baseDir);
    if (gpath) { try { const gdb = new Database(gpath, { readonly: true, timeout: 5000 }); for (const r of gdb.prepare("SELECT id, install_path FROM games WHERE installed=1 AND install_path IS NOT NULL AND install_path != ''").all()) installerPaths.set(String(r.id), r.install_path); gdb.close(); } catch {} }

    const expand = p => (p && p.startsWith('~')) ? path.join(home, p.slice(1)) : p;
    for (const g of db.prepare("SELECT id, SteamAppID, InstallerGameId FROM games").all()) {
        let size = 0;
        const appid = g.SteamAppID ? String(g.SteamAppID).replace(/\.0+$/, '') : '';
        if (appid && steamSizes.has(appid)) size = steamSizes.get(appid);
        else if (g.InstallerGameId && installerPaths.has(String(g.InstallerGameId))) { const ip = expand(installerPaths.get(String(g.InstallerGameId))); if (ip && fs.existsSync(ip)) size = _dirSizeBytes(ip); }
        try { db.prepare("UPDATE games SET DiskSize=? WHERE id=?").run(size, g.id); } catch {}
    }
    const rows = db.prepare("SELECT Game, Store, DiskSize FROM games WHERE DiskSize > 0").all();
    let total = 0; const byStore = new Map();
    for (const r of rows) { total += r.DiskSize; const b = _diskStoreBucket(r.Store); byStore.set(b, (byStore.get(b) || 0) + r.DiskSize); }
    const result = {
        ts: Date.now(), totalBytes: total, scanned: rows.length,
        byStore: [...byStore.entries()].map(([store, bytes]) => ({ store, bytes })).sort((a, b) => b.bytes - a.bytes),
        biggest: rows.sort((a, b) => b.DiskSize - a.DiskSize).slice(0, 8).map(r => ({ game: r.Game, bytes: r.DiskSize })),
    };
    try { db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('disk_usage', ?)").run(JSON.stringify(result)); } catch {}
    return result;
});

// ── Achievement completion scan (Steam) ──────────────────────────────────────
const _achEngine = require('../../packages/core/achievements.js');
ipcMain.handle('ach-scan', async () => {
    if (!db) return null;
    const key = db.prepare("SELECT value FROM settings WHERE key='steam_api_key'").get()?.value;
    const steamid = db.prepare("SELECT value FROM settings WHERE key='steam_id'").get()?.value;
    if (!key || !steamid) return { error: 'Steam API key + SteamID required (set them in Connect & Sync).' };
    const targets = db.prepare("SELECT id, SteamAppID FROM games WHERE SteamAppID IS NOT NULL AND TRIM(SteamAppID) != '' AND SteamAppID != 'None'").all()
        .map(g => ({ id: g.id, appid: String(g.SteamAppID).replace(/\.0+$/, '') }));
    const results = await _achEngine.scanLibrary(targets, key, steamid, { limit: 400 });
    const upd = db.prepare("UPDATE games SET AchUnlocked=?, AchTotal=? WHERE id=?");
    db.transaction(() => { for (const r of results) upd.run(r.unlocked, r.total, r.id); })();
    let withAch = 0, completed = 0, sumPct = 0, totalUnlocked = 0, totalAch = 0;
    for (const r of results) { withAch++; totalUnlocked += r.unlocked; totalAch += r.total; sumPct += r.unlocked / r.total; if (r.unlocked === r.total) completed++; }
    const stats = { ts: Date.now(), withAch, completed, avgPct: withAch ? Math.round(sumPct / withAch * 100) : 0, totalUnlocked, totalAch };
    try { db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('ach_stats', ?)").run(JSON.stringify(stats)); } catch {}
    return stats;
});

// ── Multi-store install detection ────────────────────────────────────────────
// A library row can front several stores at once (e.g. Store "Steam, GOG") with one
// launcher per store in LaunchCommands. Install state is the OR across those stores,
// the game is "installed" if ANY store's copy is on disk. The old code keyed off only
// the primary LaunchCommand, so an installed Steam copy was invisible whenever the
// primary command happened to be the GOG/Epic one (→ Play hidden, Installed stuck at 0).

// The canonical per-store launcher list for a row: [{ label, cmd }].
//
// LaunchCommands is the source of truth when it is populated, but plenty of genuinely
// multi-store rows have never had it, cross-store merges predating the column only wrote
// the Store tag, and until the edit dialog stopped hiding Installer launchers a plain Save
// collapsed the list back down to the primary. Those rows silently lost their second store:
// no picker, and install state keyed off whichever launcher survived. So anything the row's
// own store fields prove exists is filled back in (Steam tag + SteamAppID, GOG/Epic tag +
// InstallerGameId), which is enough for both the picker and the install-state OR.
//
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

    // A SteamAppID on its own proves nothing, it doubles as the metadata key on GOG and
    // itch rows, so a Steam launcher is only inferred when the row is tagged Steam too.
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

// Every launch-command string for a row: the plural LaunchCommands plus the primary,
// plus any store launcher the row's fields imply (see expandLaunchers).
function launchCmdsOf(game) {
    return expandLaunchers(game).map(l => l.cmd);
}

// library.db's installed-id set (gog_* / epic_*), cached so the watcher and batch scans
// don't reopen the DB once per row.
//
// The key has to account for WAL. library.db runs in WAL mode, so an install's
// `UPDATE games SET installed=1` lands in library.db-wal and leaves the main file's
// mtime untouched, keying on that alone pinned this Set to whatever it held at boot,
// for the whole session. The damage was not just a stale read: for a row fronting both
// Steam and GOG, resolveInstallState() sees the Steam copy absent and the GOG copy
// "not installed", concludes 0, and verify-install-status writes that back, actively
// undoing the Installed=1 the install had just committed. Hence a freshly installed
// game reverting to Install until the app was restarted.
//
// Both files, mtime and size: a checkpoint drains the WAL back to 0 bytes without
// necessarily moving mtime, and that is a change too. Reading the files rather than
// hooking our own writes also keeps it correct when the writer is another process,
// standalone Installer, or Couch.
let _installerInstalledCache = { key: '', set: new Set() };
function installerInstalledStamp(p) {
    let key = p;
    for (const f of [p, p + '-wal']) {
        try { const s = fs.statSync(f); key += `:${s.mtimeMs}:${s.size}`; } catch { key += ':-'; }
    }
    return key;
}
function installerInstalledSet() {
    const p = installerDbPath();
    if (!p) { _installerInstalledCache = { key: '', set: new Set() }; return _installerInstalledCache.set; }
    const key = installerInstalledStamp(p);
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

// Belt and braces for the in-process case: after our own install/uninstall we know the
// set changed, so drop it outright rather than trusting a filesystem stamp to have moved
// within the same tick.
function invalidateInstallerInstalledCache() {
    _installerInstalledCache = { key: '', set: new Set() };
}

// Is one launch command's store copy installed on disk? Returns true/false for a
// recognised store (Steam via appmanifest, GOG/Epic via library.db), or null otherwise
// (custom / emulator / manual, those key off "has a launch command" elsewhere).
function launcherInstalled(cmd, steamAppId) {
    const c = cmd || '';
    const sm = c.match(/steam:\/\/rungameid\/(\d+)/i);
    if (sm) return isSteamGameInstalled(sm[1] || steamAppId);
    const gm = c.match(/installer:\/\/launch\/(gog|epic)\/([^"\s]+)/i);
    if (gm) return installerInstalledSet().has(`${gm[1].toLowerCase()}_${gm[2]}`);
    return null;
}

// Install state for a Steam-fronting row, OR-ed across every store it fronts. Returns
// 1/0 when the row has a Steam launcher, else null so pure GOG/Epic/manual rows keep
// relying on their own source of truth (installer push-sync / launch command presence).
// Scoping to Steam-fronting rows keeps the blast radius to exactly the mixed-store
// class this fixes and never overrides the GOG/Epic reconciler.
function resolveInstallState(game) {
    const cmds = launchCmdsOf(game);
    if (!cmds.some(c => /steam:\/\/rungameid/i.test(c))) return null;
    let allTracked = true;
    for (const cmd of cmds) {
        const s = launcherInstalled(cmd, game.SteamAppID);
        if (s === true) return 1;          // any store copy on disk ⇒ installed
        if (s === null) allTracked = false; // an untracked launcher (flatpak/custom/…)
    }
    // No tracked store copy is on disk. Only declare the row uninstalled when EVERY
    // launcher is a tracked store (Steam/GOG/Epic); an untracked launcher (flatpak,
    // custom, emulator) may itself be the install, so leave the flag alone.
    return allTracked ? 0 : null;
}

// Per-launcher install state for the store-picker UI: [{ label, cmd, store, installed }].
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

// Rows that front Steam: an explicit steam:// launcher in either column, or a Steam tag
// plus an appid (a mixed-store row whose Steam launcher is only implied, see expandLaunchers).
const STEAM_FRONTING_SQL =
    "LaunchCommand LIKE '%steam://rungameid%' OR LaunchCommands LIKE '%steam://rungameid%' " +
    "OR (LOWER(Store) LIKE '%steam%' AND SteamAppID IS NOT NULL AND SteamAppID NOT IN ('', 'None'))";

// ── DYNAMIC INSTALL WATCHER ───────────────────────────────────────────────
// Reconcile Installed for every Steam-fronting row (incl. mixed-store rows whose Steam
// launcher lives in LaunchCommands, not the primary). Returns how many rows changed.
function reconcileSteamInstalls() {
    if (!db) return 0;
    let changed = 0;
    const games = db.prepare(
        "SELECT id, Store, SteamAppID, InstallerGameId, LaunchCommand, LaunchCommands, Installed FROM games " +
        `WHERE ${STEAM_FRONTING_SQL}`
    ).all();
    for (const g of games) {
        const s = resolveInstallState(g);
        if (s !== null && s !== g.Installed) { db.prepare("UPDATE games SET Installed=? WHERE id=?").run(s, g.id); changed++; }
    }
    return changed;
}

// ── Rows whose install lives at a path that no longer exists ─────────────────
// Custom installs, source ports, fan games, mods, anything launched by running a file
// directly, never went through the checks above: resolveInstallState() returns null unless
// the row has a steam:// launcher, so their Installed flag was only ever whatever it was set
// to when the game was installed.
//
// ⚠️ That is fine on the machine that did the installing, and wrong everywhere else. Restore
// a library backup onto a second machine and every source port and fan game still claims to
// be installed, offering PLAY for files that are not there. Reported on exactly that path:
// a library carried from one machine to another.
//
// Conservative about WHICH rows it judges, and bidirectional about the answer:
//   • Only absolute paths are judged. A bare command name is resolved through PATH, a URI is
//     someone else's business, and `flatpak run …` is not a path at all.
//   • EVERY launcher on the row must be an absolute path, or the row is skipped entirely.
//     That scoping matters: such rows are owned by no other reconciler, so this cannot fight
//     with the Steam or Installer ones.
//
// ⚠️ Bidirectional on purpose. One-directional was the obvious first instinct and it is a
// trap: a game on an external drive is genuinely installed, just not mounted, and clearing
// its flag while the drive is unplugged would strand it, nothing else ever sets Installed
// back to 1 for a path-launched row, so the game would be stuck offering INSTALL forever.
// Reading it both ways means "installed" tracks "playable right now" and plugging the drive
// back in restores the Play button on the next start.
// Launchers that are not plain paths but can still be checked. Returns true/false when this
// launcher's target can be judged, or null when it cannot.
//
// ⚠️ These three are the bulk of a restored library's false Play buttons, and none of them was
// being checked by anything:
//   • pico8-cart: carries an absolute path to the cart, and a restored config points at the
//     OTHER machine's config directory. The carts are simply not here.
//   • flatpak run <id> is verifiable from the exports directory without shelling out.
//   • installer://launch/<store>/<id> already has a source of truth in Installer's own database;
//     resolveInstallState() just never reached it, because it returns early unless the row
//     also has a steam:// launcher. A library with 26 GOG/Epic rows marked installed against
//     Installer's actual 2 is the result.
const FLATPAK_EXPORT_DIRS = [
    path.join(os.homedir(), '.local', 'share', 'flatpak', 'exports', 'bin'),
    '/var/lib/flatpak/exports/bin',
];

function launcherSchemeInstalled(cmd) {
    const c = String(cmd || '').trim();
    if (!c) return null;

    // steam:// can appear bare or wrapped ("steam steam://rungameid/123 -silent"), so match it
    // anywhere in the command rather than anchoring. isSteamGameInstalled() reads the
    // appmanifest, which is the same truth reconcileSteamInstalls() uses.
    const sm = c.match(/steam:\/\/rungameid\/(\d+)/i);
    if (sm) { try { const v = isSteamGameInstalled(sm[1]); return v === null ? null : !!v; } catch { return null; } }

    const p8 = c.match(/^pico8-cart:(.+)$/i);
    if (p8) {
        let f = p8[1].trim().replace(/^["']|["']$/g, '');
        if (f.startsWith('~/')) f = path.join(os.homedir(), f.slice(2));
        try { return fs.existsSync(f); } catch { return false; }
    }

    const fp = c.match(/^flatpak\s+run\s+(?:--[^\s]+\s+)*([A-Za-z0-9_.-]+)/i);
    if (fp) {
        const id = fp[1];
        return FLATPAK_EXPORT_DIRS.some(d => { try { return fs.existsSync(path.join(d, id)); } catch { return false; } });
    }

    // Every installer:// form, not just the store ones. Installer's database is the single source
    // of truth for all of them:
    //   installer://launch/gog/1234   → key "gog_1234"
    //   installer://launch/cn_vkquake → key "cn_vkquake"   (custom installs, source ports, mods)
    //   installer://mpiz1xxacr1d      → key "mpiz1xxacr1d" (manually added entries)
    //
    // ⚠️ The cn_* case is the bulk of a restored library's false Play buttons and the earlier
    // version missed it entirely, because it only matched gog|epic. A machine that never
    // installed those source ports has no rows for them at all, while the imported games.db
    // still claims all of them are installed.
    // itch:// games are launched BY the itch app, it owns the install and the URI is
    // meaningless without it. So the honest test is not "is this game installed" (only itch's
    // own database knows that) but "can this launcher run at all", and if the app is not on
    // this machine the answer is no for every itch game in the library.
    //
    // ⚠️ Only judged in the negative. If itch IS installed, whether a particular game is
    // installed lives in itch's butler database, which is not ours to read, so that returns
    // null and the row is left exactly as it was.
    if (/^itch:\/\//i.test(c)) {
        const ITCH = [
            path.join(os.homedir(), '.var', 'app', 'io.itch.itch'),
            path.join(os.homedir(), '.config', 'itch'),
            path.join(os.homedir(), '.local', 'share', 'flatpak', 'exports', 'bin', 'io.itch.itch'),
            '/var/lib/flatpak/exports/bin/io.itch.itch',
        ];
        const present = ITCH.some(d => { try { return fs.existsSync(d); } catch { return false; } });
        return present ? null : false;
    }

    const gm = c.match(/^installer:\/\/(?:launch\/)?(.+)$/i);
    if (gm) {
        // ⚠️ No Installer database means "cannot judge", NOT "nothing is installed". Without
        // this guard, a machine where library.db has not been created yet would have every
        // Installer-launched game in the library marked uninstalled in one pass.
        try { if (!installerDbPath()) return null; } catch { return null; }
        const key = String(gm[1]).trim().replace(/\/+$/, '')
            .replace(/^(gog|epic)\//i, (_m, st) => st.toLowerCase() + '_');
        try { return installerInstalledSet().has(key); } catch { return null; }
    }

    return null;
}

function launcherLocalPath(cmd) {
    let c = String(cmd || '').trim();
    if (!c) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(c)) return '';        // steam://, installer://, http://…
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(c)) {                // strip leading VAR=value
        const sp = c.indexOf(' ');
        if (sp < 0) return '';
        c = c.slice(sp + 1).trim();
    }
    let exe;
    if (c[0] === '"' || c[0] === "'") {
        const q = c[0], end = c.indexOf(q, 1);
        if (end < 0) return '';
        exe = c.slice(1, end);
    } else {
        exe = c.split(/\s+/)[0];
    }
    if (exe.startsWith('~/')) exe = path.join(os.homedir(), exe.slice(2));
    return exe.startsWith('/') ? exe : '';                      // absolute paths only
}

function reconcileLocalPathInstalls() {
    if (!db) return 0;
    let changed = 0;
    let rows;
    try {
        rows = db.prepare(
            "SELECT id, Store, SteamAppID, InstallerGameId, LaunchCommand, LaunchCommands, Installed FROM games"
        ).all();
    } catch { return 0; }

    for (const g of rows) {
        const cmds = launchCmdsOf(g).filter(Boolean);
        if (!cmds.length) continue;

        // Each launcher resolves to true/false when it can be judged, or null when it cannot
        // (a bare command resolved through PATH, an unknown URI scheme, a store we do not
        // track). One unjudgeable launcher and the whole row is left alone, the flag may be
        // the only record that the game is there.
        const states = cmds.map(cmd => {
            const scheme = launcherSchemeInstalled(cmd);
            if (scheme !== null) return scheme;
            const local = launcherLocalPath(cmd);
            if (!local) return null;
            try { return fs.existsSync(local); } catch { return false; }
        });
        if (states.some(v => v === null)) continue;
        const want = states.some(v => v === true) ? 1 : 0;
        if (g.Installed === want) continue;
        try { db.prepare("UPDATE games SET Installed=? WHERE id=?").run(want, g.id); changed++; } catch {}
    }
    return changed;
}

let steamInstallWatchers = [];
function startSteamInstallWatcher(win) {
    steamInstallWatchers.forEach(w => { try { w.close(); } catch(e) {} });
    steamInstallWatchers = [];
    // Reconcile once at boot so a game installed on Steam but fronted by GOG/Epic (Play
    // hidden, Installed stuck at 0) corrects itself without waiting for a manifest change.
    try { if (reconcileSteamInstalls() && win) win.webContents.send('install-status-updated'); } catch(e) {}
    // Same idea for path-launched rows, and the reason it runs at boot rather than on demand:
    // a restored library is wrong from the very first paint, before the user touches anything.
    try {
        const n = reconcileLocalPathInstalls();
        if (n) {
            console.log(`[install] ${n} path-launched row(s) reconciled against what is actually on this machine`);
            if (win) win.webContents.send('install-status-updated');
        }
    } catch(e) {}
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

ipcMain.handle('check-all-install-status', async () => {
    if (!db) return { updated: 0 };
    let updated = 0;

    // ── STEAM: filesystem detection ──────────────────────────────────────────
    // Include mixed-store rows whose Steam launcher sits in LaunchCommands (not the
    // primary) so a game installed on Steam but fronted by GOG/Epic still resolves.
    const steamGames = db.prepare(
        "SELECT id, Store, SteamAppID, InstallerGameId, LaunchCommand, LaunchCommands FROM games " +
        `WHERE ${STEAM_FRONTING_SQL}`
    ).all();
    for (const g of steamGames) {
        const s = resolveInstallState(g);
        if (s !== null) { db.prepare("UPDATE games SET Installed=? WHERE id=?").run(s, g.id); updated++; }
    }

    // GOG/Epic (installer://) install state is reconciled from Installer's DB via
    // sync-installer-installed / sync-all-installer-games, not detected here.

    // ── PHYSICAL / OTHERS / EMULATION / APPS: installed = has launch command ──
    const manualResult = db.prepare(`
        UPDATE games SET Installed = CASE WHEN LaunchCommand IS NOT NULL AND LaunchCommand != '' THEN 1 ELSE 0 END
        WHERE (LOWER(Store) LIKE '%physical%' OR LOWER(Store) LIKE '%others%' OR LOWER(Store) LIKE '%emulation%' OR LOWER(Store) LIKE '%apps%')
          AND LOWER(Store) NOT LIKE '%steam%' AND LOWER(Store) NOT LIKE '%epic%'
          AND LOWER(Store) NOT LIKE '%gog%'
    `).run();
    updated += manualResult.changes;

    return { updated };
});

// ── Scan for game updates (user-triggered, always optional) ──────────────────
// GOG/Epic: compare the installed version against the store's latest (gogdl/legendary);
// the user applies an update inside CN by re-running the install (reconciles to latest).
// Steam owns its own updater, so Steam is a best-effort "pending in Steam" flag read from
// the local appmanifest that routes to the Steam client, never an in-CN update.
function steamUpdatePending(appId) {
    const id = String(appId).replace(/\.0+$/, '');
    if (!id || id === 'None') return false;
    for (const dir of getSteamLibraryPaths()) {
        const mf = path.join(dir, `appmanifest_${id}.acf`);
        if (!fs.existsSync(mf)) continue;
        try {
            const txt = fs.readFileSync(mf, 'utf8');
            const num = k => { const m = txt.match(new RegExp(`"${k}"\\s+"(\\d+)"`, 'i')); return m ? Number(m[1]) : 0; };
            const stateFlags = num('StateFlags');
            const toDownload = num('BytesToDownload');
            const downloaded = num('BytesDownloaded');
            // StateFlags bit 2 = "update required"; a real bytes gap = a queued/partial update.
            // (ScheduledAutoUpdate is deliberately ignored, it's a next-check timestamp Steam
            // sets on plenty of up-to-date games, so it produces false "update available" hits.)
            if ((stateFlags & 2) || (toDownload > 0 && toDownload !== downloaded)) return true;
        } catch {}
    }
    return false;
}

// Map an engine library.db row → a scan result keyed to the shared games.db row.
function cnUpdateRow(g, current, latest, store) {
    const gid = `${store}_${g.app_id}`;
    let cn = null;
    try { cn = db && db.prepare("SELECT id, Game FROM games WHERE InstallerGameId=?").get(gid); } catch {}
    return { id: cn ? cn.id : null, name: (cn && cn.Game) || g.title, store, current: current || '', latest: latest || '', gid };
}

// ── DOSBox mode ──────────────────────────────────────────────────────────────
// GOG's DOS games ship a Windows DOSBox 0.74 from 2010 that we run through Proton, an
// emulator inside a translation layer. A native DOSBox reads the very same GOG .conf, so
// the game keeps every tweak GOG made for it and only the emulator changes. Stored in
// Installer's settings because the engine is what acts on it.
ipcMain.handle('dosbox-status', () => {
    if (!ensureInstallerEngine()) return { mode: 'auto', native: null, hint: {} };
    const native = installerEngine.findNativeDosbox();
    return {
        mode: String(installerEngine.engineSetting('dosbox_mode', 'auto') || 'auto'),
        native: native ? { label: native.label, flatpak: native.args.length > 0 } : null,
        hint: installerEngine.dosboxInstallHint(),
    };
});
ipcMain.handle('set-dosbox-mode', (_, mode) => {
    if (!ensureInstallerEngine() || !_installerEngineDb) return false;
    const v = ['auto', 'native', 'bundled'].includes(String(mode)) ? String(mode) : 'auto';
    try {
        _installerEngineDb.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dosbox_mode', ?)").run(v);
        return true;
    } catch { return false; }
});

// ── Per-game manuals ─────────────────────────────────────────────────────────
// A pointer to a file the user owns (see packages/core/manuals.js), read in a frameless
// viewer window of its own so it can be dragged to a second monitor and survives the
// library window moving or a game launching. One viewer is reused across games.
const _manuals = require('../../packages/core/manuals.js');
let gameManualWin = null;

// Manuals we download live here, one folder per game, the only manual files this app
// owns, and therefore the only ones it may ever delete.
const manualsDir = path.join(baseDir, 'GameManagerConfig', 'manuals');
const gameManualDir = gameId => path.join(manualsDir, String(gameId));

function _gameRow(gameId) {
    try { return db.prepare("SELECT id, Game, Store, SteamAppID, InstallerGameId, LaunchCommand, LaunchCommands FROM games WHERE id=?").get(gameId); }
    catch { return null; }
}
function _gogAppId(row) {
    const m = String(row?.InstallerGameId || '').match(/^gog_(.+)$/i);
    return m ? m[1] : null;
}

// Everything the button needs in one call: what is attached, what could be attached from
// the game's own folder, and whether GOG has anything to offer.
ipcMain.handle('manual-list', (_, gameId) => {
    if (!db) return { attached: [], detected: [], gogAppId: null };
    const attached = _manuals.listManuals(db, fs, gameId);
    const row = _gameRow(gameId);
    const folder = row ? resolveGameFolder(row) : null;
    const have = new Set(attached.map(m => m.path.toLowerCase()));
    const detected = (folder ? _manuals.detectManuals(fs, folder, _gogAppId(row)) : [])
        .filter(d => !have.has(d.path.toLowerCase()));
    return { attached, detected, gogAppId: _gogAppId(row) };
});

// Attach something detection already found, no dialog needed.
ipcMain.handle('attach-manual', (_, gameId, filePath, label, source) => {
    if (!db) return { ok: false };
    const id = _manuals.addManual(db, gameId, filePath, label, source || 'user');
    return { ok: !!id, id };
});

// Browse for one. Opens in the game's own install folder when we can find it. That is
// where GOG leaves the PDFs it ships, but it is an ordinary file dialog, so anywhere
// else on disk works just as well.
ipcMain.handle('pick-manual', async (_, gameId) => {
    if (!db) return { ok: false };
    let startAt;
    try {
        const folder = resolveGameFolder(_gameRow(gameId));
        if (folder && fs.existsSync(folder)) startAt = folder;
    } catch {}
    const opts = {
        title: 'Choose a manual for this game',
        properties: ['openFile', 'multiSelections'],
        filters: _manuals.MANUAL_FILTERS,
    };
    if (startAt) opts.defaultPath = startAt;
    const { canceled, filePaths } = await dialog.showOpenDialog(opts);
    if (canceled || !filePaths || !filePaths.length) return { ok: false, canceled: true };
    const added = filePaths.map(p => ({ path: p, id: _manuals.addManual(db, gameId, p, null, 'user') }));
    return { ok: true, added, path: filePaths[0] };
});

// Unlink. The file is only deleted when this app downloaded it (see removeManual).
ipcMain.handle('remove-manual', (_, manualId, gameId) =>
    ({ ok: _manuals.removeManual(db, fs, manualId, gameManualDir(gameId)) }));

ipcMain.handle('gog-manual-list', async (_, gameId) => {
    if (!ensureInstallerEngine()) return { ok: false, error: 'Installer engine unavailable.' };
    const appId = _gogAppId(_gameRow(gameId));
    if (!appId) return { ok: false, error: 'Not a GOG game.' };
    return installerEngine.gogListManuals(appId);
});

ipcMain.handle('gog-manual-download', async (evt, gameId, bonusId) => {
    if (!ensureInstallerEngine()) return { ok: false, error: 'Installer engine unavailable.' };
    const appId = _gogAppId(_gameRow(gameId));
    if (!appId) return { ok: false, error: 'Not a GOG game.' };
    const dest = gameManualDir(gameId);
    const res = await installerEngine.gogDownloadManual(appId, bonusId, dest, (got, total) => {
        try { evt.sender.send('manual-download-progress', { gameId, got, total }); } catch {}
    });
    if (!res.ok) return res;
    for (const f of res.files) _manuals.addManual(db, gameId, f.path, f.label, 'gog-download');
    return res;
});

ipcMain.handle('open-manual-viewer', (event, opts = {}) => {
    const p = opts.path;
    if (!p || !fs.existsSync(p)) return { ok: false, error: 'Manual file not found.' };
    const query = {
        file:   p,
        title:  opts.title || 'Manual',
        store:  opts.store || '',
        logo:   opts.logo  || '',
        font:   opts.font  || '',
        gameId: String(opts.gameId ?? ''),
        theme:  JSON.stringify(opts.theme || {}),
    };

    if (gameManualWin && !gameManualWin.isDestroyed()) {
        gameManualWin.loadFile(path.join(__dirname, 'game-manual.html'), { query });
        if (gameManualWin.isMinimized()) gameManualWin.restore();
        gameManualWin.focus();
        return { ok: true };
    }

    const parent = BrowserWindow.fromWebContents(event.sender);
    const pb = parent ? parent.getBounds() : { x: 80, y: 60, width: 1200, height: 900 };
    gameManualWin = new BrowserWindow({
        width: 860, height: 980,
        x: (pb.x || 0) + 60, y: Math.max(0, (pb.y || 0) + 30),
        frame: false,
        backgroundColor: (opts.theme && opts.theme.bg) || '#141414',
        title: opts.title ? `Manual, ${opts.title}` : 'Manual',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,   // the PDF is a local file loaded into an iframe
            plugins: true,        // enables Chromium's built-in PDF viewer
        }
    });
    gameManualWin.setMenu(null);
    gameManualWin.loadFile(path.join(__dirname, 'game-manual.html'), { query });
    gameManualWin.on('closed', () => { gameManualWin = null; });
    return { ok: true };
});

// Window controls for the viewer's own chrome, scoped to the manual window so they can
// never be aimed at the library window by anything else holding the preload.
ipcMain.handle('game-manual-close', () => { try { gameManualWin?.close(); } catch {} });
ipcMain.handle('game-manual-minimize', () => { try { gameManualWin?.minimize(); } catch {} });
ipcMain.handle('open-manual-externally', async (_, p) => {
    if (p && fs.existsSync(p)) await shell.openPath(p);
});

// ── Genre scan ───────────────────────────────────────────────────────────────
// Community tags from SteamSpy, IGDB for everything Steam never heard of, and the old
// GENRE column as a floor (see packages/core/genre-scan.js). The pace is SteamSpy's
// one-request-a-second guidance, so a full library takes minutes, not seconds, hence
// the progress events and the cancel flag.
const _genreScan = require('../../packages/core/genre-scan.js');
const _smart = require('../../packages/core/smart-playlists.js');
const _genreStore = require('../../packages/core/genre-store.js');
let _genreScanRunning = false;
let _genreScanCancel  = false;

// IGDB genres/themes/keywords for one game. Separate from igdbSearch's fat metadata
// query: this asks for the three fields the classifier reads and nothing else.
async function igdbGenreLookup(name, steamAppId) {
    const auth = await getIgdbToken();
    if (!auth) return null;
    const fields = 'fields name,genres.name,themes.name,keywords.name;';
    try {
        if (steamAppId) {
            const byId = await igdbQuery(auth, `${fields} where external_games.uid = "${steamAppId}" & external_games.category = 1; limit 1;`);
            if (byId) return byId;
        }
        if (!name) return null;
        const hit = await igdbQuery(auth, `search "${String(name).replace(/"/g, '')}"; ${fields} limit 3;`);
        // A loose search can return a sequel or an unrelated title; only trust a close match.
        if (hit && titleSimilarity(hit.name || '', name) < 0.5) return null;
        return hit;
    } catch { return null; }
}

ipcMain.handle('scan-genres', async (evt, opts) => {
    if (_genreScanRunning) return { ok: false, error: 'already_running' };
    _genreScanRunning = true;
    _genreScanCancel  = false;
    try {
        const res = await _genreScan.runGenreScan({
            db,
            force: !!(opts && opts.force),
            igdbLookup: igdbGenreLookup,
            shouldCancel: () => _genreScanCancel,
            onProgress: p => { try { evt.sender.send('genre-scan-progress', p); } catch {} },
        });
        return { ok: true, ...res };
    } catch (e) {
        return { ok: false, error: e.message };
    } finally {
        _genreScanRunning = false;
    }
});

ipcMain.handle('cancel-genre-scan', () => { _genreScanCancel = true; return true; });

// Instant, offline: re-reads the GENRE column through the vocabulary. Worth offering
// before the long scan because it costs nothing and already sorts a good chunk.
ipcMain.handle('quick-genre-pass', () => {
    try { return { ok: true, ..._genreScan.quickGenrePass(db) }; }
    catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('scan-updates', async (evt) => {
    const out = [];
    const send = (scanned, total, label) => { try { evt.sender.send('update-scan-progress', { scanned, total, label }); } catch {} };

    // 1) GOG / Epic, via the in-process Installer engine.
    if (ensureInstallerEngine() && _installerEngineDb) {
        let installed = [];
        try { installed = _installerEngineDb.prepare(
            "SELECT id, title, store, app_id, version, platform FROM games WHERE installed=1 AND (is_dlc IS NULL OR is_dlc=0)"
        ).all(); } catch {}
        const gog  = installed.filter(g => g.store === 'gog'  && g.app_id);
        const epic = installed.filter(g => g.store === 'epic' && g.app_id);
        const total = gog.length + epic.length;
        let scanned = 0;

        // Epic, one bulk `legendary list-installed --check-updates`.
        if (epic.length) {
            send(scanned, total, 'Checking Epic games…');
            let updMap = new Map();
            try { updMap = await installerEngine.epicListUpdates(); } catch {}
            for (const g of epic) {
                scanned++;
                const info = updMap.get(g.app_id);
                if (info && info.update) out.push(cnUpdateRow(g, info.current, info.latest, 'epic'));
            }
        }
        // GOG, per-game `gogdl info` (no bulk update check exists). Linux builds report no
        // versionName, so they can't be diffed and are skipped.
        for (const g of gog) {
            scanned++;
            send(scanned, total, `Checking ${g.title}…`);
            const platform = (g.platform === 'linux') ? 'linux' : 'windows';
            if (platform === 'linux') continue;
            let latest = '';
            try { latest = (await installerEngine.gogInstallInfo(g.app_id, platform))?.version || ''; } catch {}
            if (latest && g.version && String(latest) !== String(g.version)) out.push(cnUpdateRow(g, g.version, latest, 'gog'));
        }
        send(total, total, '');
    }

    // 2) Steam, best-effort "pending in Steam" from the local appmanifest.
    if (db) {
        let steamRows = [];
        try { steamRows = db.prepare(
            "SELECT id, Game, SteamAppID FROM games " +
            "WHERE (LaunchCommand LIKE '%steam://rungameid%' OR LaunchCommands LIKE '%steam://rungameid%') AND Installed=1"
        ).all(); } catch {}
        for (const r of steamRows) {
            const appId = r.SteamAppID ? String(r.SteamAppID).replace(/\.0+$/, '').trim() : '';
            if (appId && appId !== 'None' && steamUpdatePending(appId)) {
                out.push({ id: r.id, name: r.Game, store: 'steam', current: '', latest: '', appId });
            }
        }
    }
    return { updates: out };
});

ipcMain.handle('set-launch-command', (e, gameId, cmd) => {
    if (!db) return false;
    const installed = (cmd && cmd.trim() !== '') ? 1 : 0;
    db.prepare("UPDATE games SET LaunchCommand=?, Installed=? WHERE id=?").run(cmd || '', installed, gameId);
    return true;
});


// Auto-sync Installer installed status into Clarity library.
// installedIds = array of Installer game IDs that are installed (from installerStatus).
// Sets InstallerGameId + Installed=1 for matching GOG/Epic games.
ipcMain.handle('sync-installer-installed', (_, installedIds) => {
    if (!db || !Array.isArray(installedIds)) return { synced: 0 };
    const idSet = new Set(installedIds);
    let synced = 0;
    const games = db.prepare(
        "SELECT id, LaunchCommand, InstallerGameId FROM games WHERE LaunchCommand LIKE '%installer://launch/%'"
    ).all();
    for (const g of games) {
        const epicMatch = (g.LaunchCommand || '').match(/installer:\/\/launch\/epic\/([^"\s]+)/i);
        const gogMatch  = (g.LaunchCommand || '').match(/installer:\/\/launch\/gog\/([^"\s]+)/i);
        const m = epicMatch || gogMatch;
        if (!m) continue;
        const gid = epicMatch ? `epic_${epicMatch[1]}` : `gog_${gogMatch[1]}`;
        if (idSet.has(gid)) {
            db.prepare("UPDATE games SET InstallerGameId=?, Installed=1 WHERE id=?").run(gid, g.id);
            synced++;
        } else if (g.InstallerGameId) {
            // No longer installed in Installer, clear the auto-set override
            db.prepare("UPDATE games SET InstallerGameId=NULL WHERE id=?").run(g.id);
        }
    }
    return { synced };
});

ipcMain.handle('installer-status', () => {
    const installerPath = findInstallerPath();
    if (!installerPath) return { found: false, installedGames: [] };

    const installerDb = host.findInstallerDb(baseDir);
    if (!installerDb) return { found: true, path: installerPath, installedGames: [], error: 'Launch Installer once to create its database.' };

    try {
        const gdb = new Database(installerDb, { readonly: true });
        const installed = gdb.prepare("SELECT id FROM games WHERE installed=1").all();
        const allGames  = gdb.prepare("SELECT id, title, store, app_id, installed, platform, is_dlc FROM games").all();
        gdb.close();
        return { found: true, path: installerPath,
                 installedGames: installed.map(r => r.id),
                 allGames };
    } catch (e) {
        return { found: true, path: installerPath, installedGames: [], allGames: [], error: `Could not read Installer DB: ${e.message}` };
    }
});

// Sync ALL Installer games into Clarity (installed and not installed).
// Matches by app_id for GOG/Epic; inserts new entries for unmatched games.
ipcMain.handle('sync-all-installer-games', (_, allInstallerGames, installerPath) => {
    if (!allInstallerGames?.length) return { synced: 0 };
    let synced = 0;

    // Build set of DLC installer IDs so we can clean up any previously-synced entries
    const dlcIds = new Set(allInstallerGames.filter(g => g.is_dlc).map(g => g.id));

    // Remove any Clarity entries that were auto-synced from Installer but are DLC/non-game content
    if (dlcIds.size) {
        const placeholders = Array.from(dlcIds).map(() => '?').join(',');
        db.prepare(`DELETE FROM games WHERE InstallerGameId IN (${placeholders})`).run(...dlcIds);
    }

    // NOTE: refund/removal of GOG/Epic titles is handled in the installer-refresh-owned handler,
    // which drops from games.db exactly the ids syncOwnedLibrary just pruned from library.db,
    // scoped to this run so pre-existing games.db↔library.db drift is never mistaken for a refund.

    for (const gg of allInstallerGames) {
        // Never bring DLC/soundtrack/extras into Clarity's library
        if (gg.is_dlc) continue;

        // Authoritative install state: any Clarity game already linked to this Installer game reflects
        // Installer's real installed flag, regardless of Clarity's stored value (e.g. after restoring an
        // older backup, or after a Installer-side install/uninstall Clarity never saw). Installer keeps this
        // flag accurate via its own verify-installs (checks the files on disk).
        try {
            db.prepare("UPDATE games SET Installed=? WHERE InstallerGameId=?").run(gg.installed ? 1 : 0, gg.id);
            // ...and make sure GOG/Epic games have a launch command, otherwise the UI shows "Install"
            // (button needs LaunchCommand) even though they're installed, and they couldn't launch.
            if (gg.app_id && (gg.store === 'gog' || gg.store === 'epic')) {
                db.prepare("UPDATE games SET LaunchCommand=? WHERE InstallerGameId=? AND (LaunchCommand IS NULL OR TRIM(LaunchCommand)='')")
                  .run(`installer://launch/${gg.store}/${gg.app_id}`, gg.id);
            }
        } catch {}

        // Try to find a matching Clarity game by app_id embedded in the Installer LaunchCommand
        let existing = null;
        if (gg.app_id) {
            existing = db.prepare(
                "SELECT id, InstallerGameId FROM games WHERE LaunchCommand LIKE ? AND (InstallerGameId IS NULL OR InstallerGameId=?)"
            ).get(`%${gg.app_id}%`, gg.id);
        }

        if (existing) {
            // Matched, update InstallerGameId and install status
            db.prepare("UPDATE games SET InstallerGameId=?, Installed=? WHERE id=?")
              .run(gg.id, gg.installed ? 1 : 0, existing.id);
            synced++;
        } else {
            // No Clarity equivalent, insert as new entry if not already imported
            const alreadyIn = db.prepare("SELECT id FROM games WHERE InstallerGameId=?").get(gg.id);
            if (!alreadyIn) {
                let launchCmd = '';
                if (gg.store === 'gog' && gg.app_id)   launchCmd = `installer://launch/gog/${gg.app_id}`;
                if (gg.store === 'epic' && gg.app_id)  launchCmd = `installer://launch/epic/${gg.app_id}`;
                const store = gg.store === 'gog' ? 'GOG' : gg.store === 'epic' ? 'EPIC' : 'Others';
                if (!launchCmd) launchCmd = `installer://${gg.id}`;

                // Before inserting, check if a Steam game with the same title already exists, merge instead
                const steamMatch = (gg.store === 'gog' || gg.store === 'epic') && gg.title
                    ? db.prepare(
                        "SELECT * FROM games WHERE LOWER(TRIM(Game))=LOWER(TRIM(?)) AND Store LIKE '%Steam%' AND (InstallerGameId IS NULL OR InstallerGameId='')"
                      ).get(gg.title)
                    : null;

                if (steamMatch) {
                    let launchers = [];
                    try { launchers = JSON.parse(steamMatch.LaunchCommands || '[]'); } catch(e) {}
                    if (launchers.length === 0 && steamMatch.LaunchCommand) {
                        launchers.push({ label: guessLauncherLabel(steamMatch.LaunchCommand), cmd: steamMatch.LaunchCommand });
                    }
                    if (!launchers.some(l => l.cmd === launchCmd)) {
                        launchers.push({ label: store + ' via Installer', cmd: launchCmd });
                    }
                    const storeArr = (steamMatch.Store || '').split(',').map(s => s.trim()).filter(Boolean);
                    if (!storeArr.some(s => s.toLowerCase() === store.toLowerCase())) storeArr.push(store);
                    db.prepare("UPDATE games SET Store=?, InstallerGameId=?, Installed=?, LaunchCommands=? WHERE id=?")
                      .run(storeArr.join(', '), gg.id,
                           Math.max(gg.installed ? 1 : 0, steamMatch.Installed || 0),
                           JSON.stringify(launchers), steamMatch.id);
                } else {
                    db.prepare(
                        "INSERT INTO games (Game, LaunchCommand, Store, Installed, InstallerGameId) VALUES (?, ?, ?, ?, ?)"
                    ).run(gg.title || gg.id, launchCmd, store, gg.installed ? 1 : 0, gg.id);
                }
                synced++;
            }
        }
    }
    // Installer only knows the GOG/Epic side, so the writes above set Installed purely from
    // that store, which zeroes a mixed-store row (e.g. Steam+GOG) whose Steam copy is the
    // one actually installed. Re-assert the Steam OR so those rows aren't wrongly downgraded.
    reconcileSteamInstalls();
    return { synced };
});

ipcMain.on('launch-couch', () => {
    // Launch the Couch face of THIS binary (separate 'couch' process), not an external AppImage.
    const bin  = host.selfExecutable();
    const args = host.selfSpawnArgs(['--couch'], path.join(__dirname, '..', '..'));
    const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
    child.unref();
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.minimize();
    // Restore the Manager window when the Couch face exits.
    child.on('exit', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
});

ipcMain.on('launch-emulatte', () => {
    const p = findEmuLattePath();
    if (!p) return;
    const child = spawn(p, [], { detached: true, stdio: 'ignore' });
    child.unref();
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.minimize();
});

ipcMain.handle('install-to-menu', () => {
    try {
        if (!host.desktop.canInstallMenuEntries) return { success: false, message: 'This system installs its own menu entries.' };
        const appsDir  = host.desktop.appsDir();
        const iconsDir = path.join(baseDir, 'icons');
        if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });
        fs.writeFileSync(path.join(iconsDir, 'Clarity.svg'),     Buffer.from(Clarity_SVG_B64,     'base64'));
        fs.writeFileSync(path.join(iconsDir, 'Couch.svg'),    Buffer.from(Couch_SVG_B64,    'base64'));
        fs.writeFileSync(path.join(iconsDir, 'Installer.svg'),  Buffer.from(Installer_SVG_B64,  'base64'));
        fs.writeFileSync(path.join(iconsDir, 'EmuLatte.svg'), Buffer.from(EMULATTE_SVG_B64, 'base64'));
        const files = fs.readdirSync(baseDir);
        // One answer to "which binary is the suite?", shared with the desktop descriptor so
        // the app menu and the Omarchy plugin open the same file.
        const suitePath    = desktopDescriptor.suiteExecutable(baseDir, host.selfExecutable());
        const emulatteFile = files.find(f => /^EmuLatte.*\.AppImage$/i.test(f));

        const installed = [];
        if (suitePath) {
            try { fs.chmodSync(suitePath, '755'); } catch {}
            host.desktop.writeLauncher(appsDir, {
                id: 'clarity', name: 'Clarity',
                comment: 'Your game library, Manager, Installer and Couch in one.',
                exec: suitePath, icon: path.join(iconsDir, 'Clarity.svg'),
                categories: ['Game', 'Utility'], wmClass: 'clarity',
            });
            host.desktop.writeLauncher(appsDir, {
                id: 'clarity-couch', name: 'Couch (Fullscreen)',
                comment: 'Clarity in fullscreen, gamepad-first mode, made for the living room / TV.',
                exec: suitePath, args: ['--couch'], icon: path.join(iconsDir, 'Couch.svg'),
                categories: ['Game'], wmClass: 'couch',
                keywords: ['couch', 'tv', 'living room', 'gamepad', 'controller', 'fullscreen',
                           'big picture', 'bigpicture', 'clarity'],
            });
            installed.push('Clarity', 'Couch');
        }
        if (emulatteFile) {
            const p = path.join(baseDir, emulatteFile);
            try { fs.chmodSync(p, '755'); } catch {}
            host.desktop.writeLauncher(appsDir, {
                id: 'clarity-emulatte', name: 'EmuLatte',
                comment: 'Clarity EmuLatte, ROM library manager.',
                exec: p, icon: path.join(iconsDir, 'EmuLatte.svg'),
                categories: ['Game', 'Emulator'],
            });
            installed.push('EmuLatte');
        }
        host.desktop.refreshMenu(appsDir);
        if (installed.length === 0) return { success: false, message: 'Clarity.AppImage not found in the app folder.' };
        return { success: true, message: `Installed to menu: ${installed.join(' + ')}` };
    } catch(err) { return { success: false, message: err.message }; }
});

// Where a desktop shortcut goes is the host's business (see the platform backend).

// Add a per-game launcher that opens the game straight through Clarity (via the
// --game=<id> deeplink). targets = { menu, desktop }. Works on any XDG desktop (KDE/GNOME/…).
ipcMain.handle('add-game-shortcut', (_, gameId, targets) => {
    try {
        if (!db) return { ok: false, message: 'Library not ready.' };
        const game = db.prepare("SELECT id, Game, Icon, Logo, CoverArt FROM games WHERE id=?").get(gameId);
        if (!game) return { ok: false, message: 'Game not found.' };
        targets = targets || {};
        if (!targets.menu && !targets.desktop) return { ok: false, message: 'No location selected.' };

        // The suite AppImage (or the exec path in dev).
        const suitePath = desktopDescriptor.suiteExecutable(baseDir, host.selfExecutable());
        try { if (/\.AppImage$/i.test(suitePath)) fs.chmodSync(suitePath, '755'); } catch {}

        // Icon: prefer a squarish Icon/Logo, fall back to the cover, then the CN app icon.
        const iconsDir = path.join(baseDir, 'icons');
        const resolveImg = p => {
            if (!p || !String(p).trim()) return '';
            const abs = String(p).startsWith('/') ? String(p) : path.join(baseDir, String(p));
            return fs.existsSync(abs) ? abs : '';
        };
        let iconPath = resolveImg(game.Icon) || resolveImg(game.Logo) || resolveImg(game.CoverArt);
        if (!iconPath) {
            try {
                fs.mkdirSync(iconsDir, { recursive: true });
                const f = path.join(iconsDir, 'Clarity.svg');
                if (!fs.existsSync(f)) fs.writeFileSync(f, Buffer.from(Clarity_SVG_B64, 'base64'));
                iconPath = f;
            } catch {}
        }

        const entry = {
            id: `clarity-game-${game.id}`,
            name: String(game.Game || 'Game'),
            comment: `Launch ${String(game.Game || 'Game')} via Clarity`,
            exec: suitePath, args: [`--game=${game.id}`], icon: iconPath,
            categories: ['Game'], wmClass: 'clarity',
        };

        const wrote = [];
        if (targets.menu) {
            const appsDir = host.desktop.appsDir();
            host.desktop.writeLauncher(appsDir, entry);
            host.desktop.refreshMenu(appsDir);
            wrote.push('app menu');
        }
        if (targets.desktop) {
            const p = host.desktop.writeLauncher(host.desktop.desktopDir(), entry);
            host.desktop.markTrusted(p);
            wrote.push('desktop');
        }
        return { ok: true, message: `Shortcut added to ${wrote.join(' + ')}.` };
    } catch (e) { return { ok: false, message: e.message }; }
});

// Opt-in: auto-start the Couch (fullscreen) face on login (living-room / HTPC). Off by default.
// State = presence of the XDG autostart entry; no separate setting to drift.
const COUCH_AUTOSTART_ID = 'clarity-couch';
ipcMain.handle('get-couch-autostart', () => host.desktop.getAutostart(COUCH_AUTOSTART_ID));
ipcMain.handle('set-couch-autostart', (_, enabled) => {
    try {
        if (!enabled) return host.desktop.setAutostart(COUCH_AUTOSTART_ID, false);
        const suitePath = desktopDescriptor.suiteExecutable(baseDir, host.selfExecutable());
        const iconsDir = path.join(baseDir, 'icons');
        try { fs.mkdirSync(iconsDir, { recursive: true }); fs.writeFileSync(path.join(iconsDir, 'Couch.svg'), Buffer.from(Couch_SVG_B64, 'base64')); } catch {}
        return host.desktop.setAutostart(COUCH_AUTOSTART_ID, true, {
            name: 'Couch (Fullscreen)',
            comment: 'Clarity, auto-start in fullscreen / gamepad mode on login.',
            exec: suitePath, args: ['--couch'], icon: path.join(iconsDir, 'Couch.svg'),
            categories: ['Game'], wmClass: 'couch',
        });
    } catch (e) { return { ok: false, error: e.message }; }
});

let manualWin = null;
ipcMain.on('open-manual', () => {
    if (manualWin && !manualWin.isDestroyed()) { manualWin.focus(); return; }
    manualWin = new BrowserWindow({ width: 1100, height: 800, minWidth: 800, minHeight: 500, frame: false, backgroundColor: '#2C1E16',
        webPreferences: { contextIsolation: true, nodeIntegration: false } });
    manualWin.loadFile(path.join(__dirname, 'manual.html'));
    manualWin.setMenu(null);
    manualWin.on('closed', () => { manualWin = null; });
});

// ⚠️ The renderer must NOT derive the UI scale from `window.screen`. On a multi-monitor
// desk that reports the display the window happens to sit on, and on a fresh install, before
// any bounds are saved, that is Electron's idea of the primary, which `pickDisplay` exists
// precisely because we cannot trust. A 3440x1440 ultrawide beside a portrait 900x1440 panel
// derived 0.75 from the panel and shrank the whole UI on the screen actually being used.
//
// So placement and scale now answer to the same helper: whichever display `pickDisplay` says
// the window belongs on is the one the scale is derived from.
//
// `layout` identifies the monitor *set*, not one monitor, so dragging the window between
// screens no longer looks like a different machine and re-derives a choice out from under the
// user. Plugging in a genuinely different set still does.
ipcMain.handle('ui-screen-info', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    let bounds = null;
    try { bounds = win ? win.getBounds() : null; } catch { /* window already gone */ }
    const wa = pickDisplay(bounds || getSavedBounds()).workArea;
    const layout = screen.getAllDisplays()
        .map(d => `${d.workArea.width}x${d.workArea.height}`)
        .sort()
        .join('+');
    return { width: wa.width, height: wa.height, layout };
});

ipcMain.on('window-minimize', () => { const win = BrowserWindow.getFocusedWindow(); if(win) win.minimize(); });
ipcMain.on('window-maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if(win) { if(win.isMaximized()) win.unmaximize(); else win.maximize(); }
});
ipcMain.on('window-close', () => { const win = BrowserWindow.getFocusedWindow(); if(win) win.close(); });

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

// ── IGDB / Twitch ──────────────────────────────────────────────────────────
async function getIgdbToken() {
    const clientId = db?.prepare("SELECT value FROM settings WHERE key='igdb_client_id'").get()?.value;
    const secret   = db?.prepare("SELECT value FROM settings WHERE key='igdb_client_secret'").get()?.value;
    if (!clientId || !secret) return null;

    const cached  = db.prepare("SELECT value FROM settings WHERE key='igdb_token'").get()?.value;
    const expiry  = db.prepare("SELECT value FROM settings WHERE key='igdb_token_expiry'").get()?.value;
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
    const res = await fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: { 'Client-ID': auth.clientId, 'Authorization': `Bearer ${auth.token}`, 'Content-Type': 'text/plain' },
        body
    });
    const data = await res.json();
    // IGDB returns error objects with a 'title' field instead of 'name'
    if (!Array.isArray(data) || data[0]?.title) return null;
    return data[0] || null;
}

async function igdbSearch(gameName, steamAppId) {
    const auth = await getIgdbToken();
    if (!auth) return null;
    const fields = 'fields name,summary,involved_companies.developer,involved_companies.publisher,involved_companies.company.name,genres.name,themes.name,themes.id,first_release_date,aggregated_rating,cover.url,screenshots.url,videos.video_id,similar_games.name,franchises.name,collection.name,external_games.category,external_games.uid;';
    try {
        // Try Steam App ID lookup first (precise), fall back to name search
        if (steamAppId) {
            const byId = await igdbQuery(auth, `${fields} where external_games.uid = "${steamAppId}" & external_games.category = 1; limit 1;`);
            if (byId) return byId;
        }
        return await igdbQuery(auth, `search "${gameName.replace(/"/g, '')}"; ${fields} limit 3;`);
    } catch(e) { return null; }
}

function titleSimilarity(a, b) {
    const tokens = s => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
    const ta = tokens(a), tb = tokens(b);
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return inter / (ta.size + tb.size - inter);
}

function igdbImg(url, size = 'cover_big') {
    if (!url) return null;
    return 'https:' + url.replace('t_thumb', `t_${size}`);
}

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
            { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'Clarity/1.0' } }
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

ipcMain.handle('igdb-test', async () => {
    const auth = await getIgdbToken();
    if (!auth) return { success: false, message: 'No credentials saved.' };
    // Use name search for the test, most reliable, no external_games dependency
    const result = await igdbQuery(auth, 'search "Portal 2"; fields name; limit 1;');
    if (result?.name) return { success: true, message: `✅ Connected! Found: ${result.name}` };
    return { success: false, message: '❌ Token OK but IGDB query failed. Try again in a moment.' };
});

ipcMain.handle('igdb-search-list', async (e, gameName) => {
    try {
        const auth = await getIgdbToken();
        if (!auth) return { error: 'no_key', results: [] };
        const res = await fetch('https://api.igdb.com/v4/games', {
            method: 'POST',
            headers: { 'Client-ID': auth.clientId, 'Authorization': `Bearer ${auth.token}`, 'Content-Type': 'text/plain' },
            body: `search "${gameName.replace(/"/g, '')}"; fields id,name,first_release_date; limit 8;`
        });
        const data = await res.json();
        if (!Array.isArray(data)) return { error: null, results: [] };
        return { error: null, results: data.filter(g => g.name).map(g => ({ id: g.id, name: g.name, year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null })) };
    } catch(e) { return { error: null, results: [] }; }
});

ipcMain.handle('igdb-fetch-screenshots', async (e, igdbId) => {
    try {
        const auth = await getIgdbToken();
        if (!auth) return { error: 'no_key', screenshots: [] };
        const res = await fetch('https://api.igdb.com/v4/games', {
            method: 'POST',
            headers: { 'Client-ID': auth.clientId, 'Authorization': `Bearer ${auth.token}`, 'Content-Type': 'text/plain' },
            body: `fields screenshots.url; where id = ${igdbId}; limit 1;`
        });
        const data = await res.json();
        if (!Array.isArray(data) || !data[0]?.screenshots) return { error: null, screenshots: [] };
        return { error: null, screenshots: data[0].screenshots.map(s => ({
            thumb: 'https:' + s.url.replace('t_thumb', 't_screenshot_med'),
            full:  'https:' + s.url.replace('t_thumb', 't_screenshot_big')
        })) };
    } catch(e) { return { error: null, screenshots: [] }; }
});

ipcMain.handle('igdb-save-screenshot', async (e, gameId, screenshotUrl) => {
    try {
        const row = db.prepare("SELECT Game, Screenshot FROM games WHERE id=?").get(gameId);
        if (!row) return null;
        const safeName = row.Game.replace(/[\\/:*?"<>|#]/g, '').trim();
        const existing = (row.Screenshot || '').split('|').filter(s => s.trim() && s.startsWith('GameManagerConfig'));
        const fn = `${safeName} - Screen IGDB-${Date.now()}.jpg`;
        if (!await downloadImage(screenshotUrl, path.join(imagesDir, fn))) return null;
        const newPath = `GameManagerConfig/images/${fn}`;
        const allScreens = [...existing, newPath].join('|');
        db.prepare("UPDATE games SET Screenshot=? WHERE id=?").run(allScreens, gameId);
        return allScreens;
    } catch(e) { return null; }
});
// ───────────────────────────────────────────────────────────────────────────

ipcMain.handle('open-web-popup', async (event, url) => {
    const popupWin = new BrowserWindow({
        width: 1000, height: 700, title: "Web Search", autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    popupWin.setMenu(null);
    popupWin.loadURL(url);
});

// --- DATA MANAGEMENT TOOLS ---
ipcMain.handle('clear-browser-data', async () => {
    try {
        await session.defaultSession.clearStorageData();
        return { success: true, message: "Browser data (cookies, active logins, cache) successfully wiped!" };
    } catch (err) {
        return { success: false, message: err.message };
    }
});

// FIX: New handler to ruthlessly clean orphaned images
ipcMain.handle('clean-unused-images', () => {
    try {
        const files = fs.readdirSync(imagesDir);
        const rows = db.prepare("SELECT CoverArt, HeroArt, Logo, Icon, Screenshot FROM games").all();
        const usedSet = new Set();

        rows.forEach(r => {
            if (r.CoverArt) usedSet.add(path.basename(r.CoverArt));
            if (r.HeroArt) usedSet.add(path.basename(r.HeroArt));
            if (r.Logo) usedSet.add(path.basename(r.Logo));
            if (r.Icon) usedSet.add(path.basename(r.Icon));
            if (r.Screenshot) {
                r.Screenshot.split('|').filter(s => s.trim() !== '').forEach(s => {
                    usedSet.add(path.basename(s));
                });
            }
        });

        let deletedCount = 0;
        files.forEach(file => {
            if (!usedSet.has(file)) {
                fs.unlinkSync(path.join(imagesDir, file));
                deletedCount++;
            }
        });
        return { success: true, message: `Successfully deleted ${deletedCount} unused/orphaned images!` };
    } catch (err) {
        return { success: false, message: `Cleanup failed: ${err.message}` };
    }
});

// FIX: New handler for the nuclear option (Clear All Images)
ipcMain.handle('clear-all-images', () => {
    try {
        const files = fs.readdirSync(imagesDir);
        let deletedCount = 0;
        files.forEach(file => {
            fs.unlinkSync(path.join(imagesDir, file));
            deletedCount++;
        });
        db.prepare("UPDATE games SET CoverArt='', HeroArt='', Logo='', Icon='', Screenshot=''").run();
        return { success: true, message: `Successfully wiped ${deletedCount} images from the system and reset the database!` };
    } catch (err) {
        return { success: false, message: `Failed to wipe images: ${err.message}` };
    }
});

// RetroArch save locations, so the suite backup can bundle EmuLatte's save states (they live
// OUTSIDE GameManagerConfig). Reads EmuLatte's owned RA config first, then the host config.
const _runFile = (prog, args, opts) => new Promise((res, rej) => execFile(prog, args, opts, e => e ? rej(e) : res()));
function raCfgDir() {
    const flat = path.join(os.homedir(), '.var', 'app', 'org.libretro.RetroArch', 'config', 'retroarch');
    return fs.existsSync(flat) ? flat : path.join(os.homedir(), '.config', 'retroarch');
}
function raCfgKey(key) {
    const owned = path.join(configDir, 'EmuLatte', 'retroarch', 'emulatte-retroarch.cfg');
    const host  = path.join(raCfgDir(), 'retroarch.cfg');
    for (const f of [owned, host]) {
        try {
            const m = fs.readFileSync(f, 'utf8').match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'));
            if (m && m[1] && m[1] !== 'default') return m[1].replace(/^~(?=[/\\])/, os.homedir()).replace(/^:/, raCfgDir());
        } catch {}
    }
    return '';
}
const raStateDir = () => raCfgKey('savestate_directory') || path.join(raCfgDir(), 'states');
const raSaveDir  = () => raCfgKey('savefile_directory')  || path.join(raCfgDir(), 'saves');

ipcMain.handle('backup-zip', async (event) => {
    const win = BrowserWindow.getFocusedWindow();
    const { filePath } = await dialog.showSaveDialog(win, {
        title: 'Save ZIP Backup',
        defaultPath: 'Clarity Suite.zip',
            filters: [{ name: 'ZIP Archives', extensions: ['zip'] }]
    });
    if (!filePath) return { success: false, canceled: true };

    event.sender.send('zip-started');

    const isWin = process.platform === 'win32';
    try {
        if (isWin) {
            await _runFile('powershell', ['-command', `Compress-Archive -Path '${configDir}' -DestinationPath '${filePath}' -Force`], { timeout: 300000 });
        } else {
            await _runFile('zip', ['-r', filePath, 'GameManagerConfig'], { cwd: baseDir, timeout: 300000 });
            // Bundle RetroArch save states + savefiles under a known prefix (they live outside GameManagerConfig).
            const stateDir = raStateDir(), saveDir = raSaveDir();
            const stage = path.join(os.tmpdir(), 'cn-suite-saves-' + Date.now());
            let staged = false;
            try {
                if (fs.existsSync(stateDir)) { fs.cpSync(stateDir, path.join(stage, '__ra_saves__', 'states'), { recursive: true }); staged = true; }
                if (fs.existsSync(saveDir) && path.resolve(saveDir) !== path.resolve(stateDir)) { fs.cpSync(saveDir, path.join(stage, '__ra_saves__', 'saves'), { recursive: true }); staged = true; }
                if (staged) await _runFile('zip', ['-r', filePath, '__ra_saves__'], { cwd: stage, timeout: 300000 });
            } finally { try { fs.rmSync(stage, { recursive: true, force: true }); } catch {} }
        }
        return { success: true, message: "ZIP Backup successfully created!" };
    } catch (error) {
        return { success: false, message: `Backup failed: ${error.message}` };
    }
});

ipcMain.handle('restore-zip', async (event) => {
    const win = BrowserWindow.getFocusedWindow();
    const { filePaths } = await dialog.showOpenDialog(win, {
        title: 'Restore ZIP Backup',
        filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
        properties: ['openFile']
    });
    if (!filePaths || filePaths.length === 0) return { success: false, canceled: true };

    event.sender.send('zip-started');

    const filePath = filePaths[0];
    const isWin = process.platform === 'win32';
    try {
        if (isWin) {
            await _runFile('powershell', ['-command', `Expand-Archive -Path '${filePath}' -DestinationPath '${baseDir}' -Force`], { timeout: 300000 });
        } else {
            await _runFile('unzip', ['-o', filePath, '-d', baseDir], { timeout: 300000 });
            // Re-home any bundled RetroArch saves into THIS machine's RA dirs, then drop the temp folder.
            const extracted = path.join(baseDir, '__ra_saves__');
            if (fs.existsSync(extracted)) {
                try {
                    const stStates = path.join(extracted, 'states'), stSaves = path.join(extracted, 'saves');
                    if (fs.existsSync(stStates)) fs.cpSync(stStates, raStateDir(), { recursive: true });
                    if (fs.existsSync(stSaves))  fs.cpSync(stSaves,  raSaveDir(),  { recursive: true });
                } finally { try { fs.rmSync(extracted, { recursive: true, force: true }); } catch {} }
            }
        }
        return { success: true, message: "Restore successful! Please restart the app to load the new database." };
    } catch (error) {
        return { success: false, message: `Restore failed: ${error.message}` };
    }
});

ipcMain.handle('add-game', (e, name) => {
    try {
        const gameName = (name && name.trim()) ? name.trim() : 'New Game';
        const info = db.prepare("INSERT INTO games (Game, Store, LaunchCommand, FAV, WANT_TO_PLAY) VALUES (?, '', '', 'NO', 'NO')").run(gameName);
        return { success: true, id: info.lastInsertRowid };
    } catch (err) { return { success: false }; }
});

ipcMain.handle('set-game-flag', (_, id, field, value) => {
    const allowed = ['FAV', 'WANT_TO_PLAY', 'kb_played', 'Hidden'];
    if (!allowed.includes(field)) return { ok: false };
    db.prepare(`UPDATE games SET ${field}=? WHERE id=?`).run(value, id);
    return { ok: true };
});

// Desktop notification (freedesktop/DBus via Electron). KDE Connect's notification-sync
// plugin (or GSConnect) mirrors these to a paired phone, icon included when the phone
// app has "sync icons" on. `icon` is a games-db art path (baseDir-relative) or absolute.
ipcMain.handle('notify', (_, { title, body, icon } = {}) => {
    try {
        if (!Notification.isSupported()) return { ok: false, error: 'not supported' };
        let img;
        if (icon) {
            const p = path.isAbsolute(icon) ? icon : path.join(baseDir, icon);
            if (fs.existsSync(p)) { const ni = nativeImage.createFromPath(p); if (!ni.isEmpty()) img = ni; }
        }
        new Notification({ title: String(title || 'Clarity'), body: String(body || ''), icon: img }).show();
        return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('update-game', (event, id, data) => {
    try {
        // Preserve existing translations when English description is edited manually
        let descI18n = data.Description_i18n || null;
        if (!descI18n && data.Description) {
            const existing = db.prepare("SELECT Description_i18n FROM games WHERE id=?").get(id);
            try { const p = JSON.parse(existing?.Description_i18n || '{}'); p.en = data.Description; descI18n = JSON.stringify(p); }
            catch(e) { descI18n = JSON.stringify({ en: data.Description }); }
        }
        // Preserve LaunchCommands when caller doesn't explicitly pass it (e.g. FAV/WANT toggles)
        let launchCommands = data.LaunchCommands !== undefined
            ? data.LaunchCommands
            : db.prepare("SELECT LaunchCommands FROM games WHERE id=?").get(id)?.LaunchCommands ?? null;
        const stmt = db.prepare(`UPDATE games SET Game=?, Store=?, GENRE=?, RELEASED=?, LaunchCommand=?, LaunchCommands=?, FAV=?, WANT_TO_PLAY=?, METACRITIC=?, HLTB_Main=?, DEV=?, PUB=?, Coop=?, NumPlayers=?, Tags=?, SimilarGames=?, Franchise=?, Description=?, Description_i18n=?, SteamAppID=?, ProtonTier=?, HeroArt=?, Logo=?, Icon=?, SteamDesc=?, SteamTrailer=?, CoverArt=?, Screenshot=?, IGDBTrailer=? WHERE id=?`);
        stmt.run(data.Game, data.Store, data.GENRE, data.RELEASED, data.LaunchCommand, launchCommands, data.FAV, data.WANT_TO_PLAY, data.METACRITIC, data.HLTB_Main, data.DEV, data.PUB, data.Coop, data.NumPlayers, data.Tags, data.SimilarGames, data.Franchise || "", data.Description, descI18n, data.SteamAppID, data.ProtonTier, data.HeroArt, data.Logo, data.Icon, data.SteamDesc, data.SteamTrailer, data.CoverArt, data.Screenshot, data.IGDBTrailer || "", id);
        return true;
    } catch (err) { return false; }
});

ipcMain.handle('delete-game', (event, id) => {
    try { db.prepare(`DELETE FROM games WHERE id=?`).run(id); return true; } catch (err) { return false; }
});

ipcMain.on('launch-game', (event, cmd, launchArgs, executable) => {
    if (!cmd) return;

    // GOG/Epic via Installer, launched IN-PROCESS (cmd carries Installer's game id).
    // This is the path used by games with a InstallerGameId (the common case).
    // launchArgs, when present, is a one-off override chosen at the moment of pressing
    // Play, the Doom a mod runs on, and is deliberately not written back.
    const gLaunch = cmd.match(/^installer:\/\/(?:launch\/)?(.+)$/);
    if (gLaunch) {
        const gid = gLaunch[1];
        if (ensureInstallerEngine()) {
            _ensureGdxDriveMapping(gid);
            installerEngine.launchGame(gid, { ...(launchArgs !== undefined ? { launchArgs } : {}), ...(executable ? { executable } : {}) })
                .then(r => console.log('[launch-game] launched via', r?.method))
                .catch(e => { console.error('[launch-game] installer launch failed:', e.message); reportLaunchThrow(gid, e); });
        } else {
            spawnInstaller(['launch', gid]); // fallback if installer DB not found
        }
        return;
    }

    // GOG/Epic via Installer (installer:// cmd → resolve id via getInstallerMap), in-process
    const installerMatch = cmd.match(/installer:\/\/launch\/(epic|gog)\/([^"\s]+)/i);
    if (installerMatch) {
        const appId = installerMatch[2];
        const gMap  = getInstallerMap();
        const gId   = gMap.get(appId);
        if (gId) {
            // Launch in-process via the shared engine (no AppImage self-spawn).
            if (ensureInstallerEngine()) {
                installerEngine.launchGame(gId)
                    .then(r => console.log('[launch-game] launched via', r?.method))
                    .catch(e => { console.error('[launch-game] installer launch failed:', e.message); reportLaunchThrow(gId, e); });
            } else {
                spawnInstaller(['launch', gId]); // fallback if installer DB not found
            }
            return;
        }
    }

    // itch.io, hand the scheme to the desktop's opener (shell.openExternal rejects custom schemes)
    if (cmd.startsWith('itch://')) {
        host.desktop.openUrlScheme(cmd);
        return;
    }

    // PICO-8 cart launch (binary resolved from settings at runtime)
    if (cmd.startsWith('pico8-cart:')) {
        const cartPath = cmd.slice('pico8-cart:'.length);
        const bin = _getPico8Bin();
        if (bin) {
            const args = ['-run', cartPath];
            const get = (k) => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
            if (get('pico8_windowed')      === '1') args.push('-windowed', '1');
            if (get('pico8_mute')          === '1') args.push('-volume', '0');
            if (get('pico8_pixel_perfect') === '1') args.push('-pixel_perfect', '1');
            if (get('pico8_joystick')      === '1') args.push('-joystick', '1');
            spawn(bin, args, { detached: true, stdio: 'ignore' }).unref();
        }
        return;
    }

    const child = spawn(cmd, [], { shell: true, detached: true, stdio: 'ignore' });
    child.unref();
});

// ── PICO-8 ────────────────────────────────────────────────────────────────

function humanizeCartName(filename) {
    let name = filename.replace(/\.p8\.png$/, '').replace(/\.p8$/, '');
    name = name.replace(/_\d+$/, '');               // strip BBS pid suffix
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

ipcMain.handle('get-pico8-status', () => ({
    bin: _getPico8Bin(),
    cartsDir: path.join(baseDir, 'GameManagerConfig', 'pico8', 'carts')
}));

ipcMain.handle('browse-pico8-binary', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], title: 'Select PICO-8 Executable' });
    if (result.canceled || !result.filePaths.length) return null;
    const p = result.filePaths[0];
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pico8_path', ?)").run(p);
    return p;
});

ipcMain.handle('launch-pico8-splore', () => {
    const bin = _getPico8Bin();
    if (bin) spawn(bin, ['-splore'], { detached: true, stdio: 'ignore' }).unref();
    return !!bin;
});

ipcMain.handle('open-pico8-folder', () => {
    const dir = path.join(baseDir, 'GameManagerConfig', 'pico8', 'carts');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    shell.openPath(dir);
    return true;
});

ipcMain.handle('get-pico8-opts', () => {
    const get = (k) => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value === '1';
    return { windowed: get('pico8_windowed'), mute: get('pico8_mute'), pixelPerfect: get('pico8_pixel_perfect'), joystick: get('pico8_joystick') };
});

ipcMain.handle('set-pico8-opt', (e, key, val) => {
    const map = { windowed: 'pico8_windowed', mute: 'pico8_mute', pixelPerfect: 'pico8_pixel_perfect', joystick: 'pico8_joystick' };
    const dbKey = map[key];
    if (!dbKey) return false;
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run(dbKey, val ? '1' : '0');
    return true;
});

ipcMain.handle('scan-pico8', () => {
    if (!db) return { count: 0 };
    const cartsDir = path.join(baseDir, 'GameManagerConfig', 'pico8', 'carts');
    const imagesDir = path.join(baseDir, 'GameManagerConfig', 'images');
    try { fs.mkdirSync(cartsDir, { recursive: true }); } catch {}
    let files;
    try { files = fs.readdirSync(cartsDir); } catch { return { count: 0 }; }

    const found = new Set();

    const setCartCover = (rowId, cartPath) => {
        // The .p8.png IS the cover image, copy it directly, no canvas needed
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

let _bbsWin = null;

ipcMain.handle('launch-pico8-bbs', (e, accent = '#ff77a8') => {
    const cartsDir = path.join(baseDir, 'GameManagerConfig', 'pico8', 'carts');
    try { fs.mkdirSync(cartsDir, { recursive: true }); } catch {}

    if (_bbsWin && !_bbsWin.isDestroyed()) { _bbsWin.focus(); return; }

    _bbsWin = new BrowserWindow({
        width: 1280, height: 860,
        frame: false,
        webPreferences: {
            partition: 'persist:pico8bbs',
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    _bbsWin.loadURL('https://www.lexaloffle.com/bbs/?cat=7&carts_tab=1#mode=carts&sub=2');

    const isCart = (url = '') => /\.p8(\.png)?($|\?|#)/.test(url) || url.endsWith('.p8') || url.endsWith('.p8.png');
    const a = accent.replace(/['"\\<>]/g, '');

    const injectUI = () => {
        _bbsWin.webContents.executeJavaScript(`
        (function(){
            if (document.getElementById('clarity-p8-style')) return;
            const s = document.createElement('style');
            s.id = 'clarity-p8-style';
            s.textContent = \`
                ::-webkit-scrollbar{width:8px;height:8px}
                ::-webkit-scrollbar-track{background:#0d0d0d}
                ::-webkit-scrollbar-thumb{background:${a}55;border-radius:4px}
                ::-webkit-scrollbar-thumb:hover{background:${a}aa}
                #clarity-titlebar{position:fixed;top:0;left:0;right:0;height:38px;background:#0d0d0d;border-bottom:1px solid ${a}33;z-index:99999;display:flex;align-items:center;-webkit-app-region:drag;user-select:none}
                #clarity-titlebar .clarity-tb-brand{padding:0 14px;font-family:monospace;font-size:13px;font-weight:900;letter-spacing:3px;color:${a};flex-shrink:0}
                #clarity-titlebar .clarity-tb-hint{font-family:monospace;font-size:10px;color:#444;flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
                #clarity-titlebar .clarity-tb-btns{display:flex;-webkit-app-region:no-drag;flex-shrink:0}
                #clarity-titlebar .clarity-tb-btns button{width:46px;height:38px;border:none;background:transparent;color:#666;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s,color 0.15s}
                #clarity-titlebar .clarity-tb-btns button:hover{background:rgba(255,255,255,0.08);color:#ccc}
                #clarity-titlebar .clarity-tb-btns .tb-close:hover{background:#c0392b;color:#fff}
            \`;
            document.head.appendChild(s);
            const bar = document.createElement('div');
            bar.id = 'clarity-titlebar';
            bar.innerHTML = \`
                <div class="clarity-tb-brand">Clarity, PICO-8 BBS</div>
                <div class="clarity-tb-hint">Right-click a cart image · click CART · or click any .p8.png link to save to your library</div>
                <div class="clarity-tb-btns">
                    <button class="tb-close" onclick="window.close()" title="Close">&#x2715;</button>
                </div>
            \`;
            document.body.insertBefore(bar, document.body.firstChild);
            document.documentElement.style.paddingTop = '38px';
        })()
        `).catch(() => {});
    };

    _bbsWin.webContents.on('did-finish-load', injectUI);
    _bbsWin.webContents.on('did-navigate', injectUI);

    _bbsWin.webContents.on('will-navigate', (event, url) => {
        if (isCart(url)) { event.preventDefault(); _bbsWin.webContents.downloadURL(url); }
    });

    _bbsWin.webContents.setWindowOpenHandler(({ url }) => {
        if (isCart(url)) { _bbsWin.webContents.downloadURL(url); return { action: 'deny' }; }
        shell.openExternal(url);
        return { action: 'deny' };
    });

    _bbsWin.webContents.on('context-menu', (event, params) => {
        const dlURL = [params.srcURL, params.linkURL].find(u => isCart(u));
        const items = [];
        if (dlURL) {
            items.push({ label: '⬇  Save to PICO-8 Library', click: () => _bbsWin.webContents.downloadURL(dlURL) });
            items.push({ type: 'separator' });
        }
        if (params.selectionText) items.push({ role: 'copy', label: 'Copy' });
        if (params.linkURL && !isCart(params.linkURL)) items.push({ label: 'Open Link in Browser', click: () => shell.openExternal(params.linkURL) });
        if (items.length) Menu.buildFromTemplate(items).popup({ window: _bbsWin });
    });

    _bbsWin.webContents.session.on('will-download', (event, item) => {
        const filename = item.getFilename();
        if (!isCart(filename)) return;
        const destPath = path.join(cartsDir, filename);
        const srcURL = item.getURL();
        item.setSavePath(destPath);

        item.on('done', async (ev, state) => {
            if (state !== 'completed') return;

            let name = humanizeCartName(filename);
            const launchCmd = `pico8-cart:${destPath}`;
            let gameId;
            try {
                const existing = db.prepare("SELECT id FROM games WHERE LaunchCommand = ?").get(launchCmd);
                if (existing) { gameId = existing.id; }
                else { gameId = db.prepare("INSERT INTO games (Game,Store,LaunchCommand,Installed) VALUES (?,?,?,1)").run(name, 'PICO-8', launchCmd).lastInsertRowid; }
            } catch {}

            // Copy the .p8.png directly as cover art, it IS the image, no conversion needed
            if (gameId && filename.endsWith('.p8.png')) {
                try {
                    const imDir = path.join(baseDir, 'GameManagerConfig', 'images');
                    const coverFile = `${gameId}_p8_cover.png`;
                    fs.copyFileSync(destPath, path.join(imDir, coverFile));
                    db.prepare("UPDATE games SET CoverArt=? WHERE id=?").run(`GameManagerConfig/images/${coverFile}`, gameId);
                } catch {}
            }

            // Fetch real title from BBS page using pid in the download URL
            const pidM = srcURL.match(/\/cposts\/\d+\/(\d+)\.p8\.png/);
            if (pidM) {
                try {
                    const res = await session.defaultSession.fetch(
                        `https://www.lexaloffle.com/bbs/?pid=${pidM[1]}`,
                        { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' } }
                    );
                    const html = await res.text();
                    const titleM = html.match(/<title[^>]*>([^<]+?)\s*[-–]\s*Lexaloffle BBS/i);
                    if (titleM && titleM[1].trim()) {
                        name = titleM[1].trim();
                        if (gameId) db.prepare("UPDATE games SET Game=? WHERE id=?").run(name, gameId);
                    }
                } catch {}
            }

            // Toast in BBS window
            if (_bbsWin && !_bbsWin.isDestroyed()) {
                const toastMsg = JSON.stringify(`✓ ${name}, saved to library`);
                _bbsWin.webContents.executeJavaScript(`
                    (function(){
                        const t=document.createElement('div');
                        t.style.cssText='position:fixed;bottom:24px;right:24px;z-index:999999;background:#0d0d0d;border:1px solid ${a};color:${a};padding:10px 20px;border-radius:6px;font-family:monospace;font-size:13px;font-weight:700;letter-spacing:1px;box-shadow:0 6px 24px rgba(0,0,0,0.9);transition:opacity 0.4s';
                        t.textContent=${toastMsg};
                        document.body.appendChild(t);
                        setTimeout(()=>{t.style.opacity='0';setTimeout(()=>t.remove(),400)},2800);
                    })()
                `).catch(() => {});
            }

            // Notify main window
            const mainWin = BrowserWindow.getAllWindows().find(w => w !== _bbsWin && !w.isDestroyed());
            if (mainWin) mainWin.webContents.send('pico8-cart-downloaded', { name });
        });
    });

    _bbsWin.on('closed', () => { _bbsWin = null; });
});

ipcMain.handle('update-last-played', (event, id) => {
    if (!db) return false;
    try { db.prepare("UPDATE games SET LastPlayed = ? WHERE id = ?").run(Date.now(), id); return true; } catch(err) { return false; }
});

ipcMain.handle('get-strings', (_, lang) => require('./i18n')(lang || 'en'));

// ── ITCH.IO SYNC ──────────────────────────────────────────────────────────

async function doItchSync() {
    if (!db) return { success: false, message: 'Database not ready.' };
    const home = os.homedir();
    const butlerPaths = [
        path.join(home, '.config', 'itch', 'db', 'butler.db'),
        path.join(home, '.var', 'app', 'io.itch.itch', 'config', 'itch', 'db', 'butler.db')
    ];
    const butlerDbPath = butlerPaths.find(p => fs.existsSync(p));
    if (!butlerDbPath) return { success: false, message: 'itch app not found. Install it and log in first.' };

    let itchDb;
    try { itchDb = new Database(butlerDbPath, { readonly: true }); }
    catch(e) { return { success: false, message: 'Could not open itch database: ' + e.message }; }

    let imported = 0;
    try {
        // Only import games the user actually owns: installed (cave), purchased (download_key), or in library (profile_games)
        const games  = itchDb.prepare(`
            SELECT DISTINCT g.* FROM games g
            LEFT JOIN caves c ON g.id = c.game_id
            LEFT JOIN download_keys dk ON g.id = dk.game_id
            LEFT JOIN profile_games pg ON g.id = pg.game_id
            WHERE c.game_id IS NOT NULL OR dk.game_id IS NOT NULL OR pg.game_id IS NOT NULL
        `).all();
        const caves  = itchDb.prepare("SELECT * FROM caves").all();
        const imDir  = path.join(baseDir, 'GameManagerConfig', 'images');
        const caveByGame = {};
        for (const c of caves) caveByGame[c.game_id] = c;

        // Collect async cover-download tasks so they fire after the transaction
        const coverTasks = [];

        db.transaction(() => {
        for (const game of games) {
            const cave = caveByGame[game.id];
            let launchCmd = null, installed = 0;

            if (cave) {
                installed = 1;
                try {
                    const v = JSON.parse(cave.verdict || '{}');
                    const linuxExe = (v.candidates || []).find(c => c.flavor === 'linux');
                    launchCmd = (v.basePath && linuxExe)
                        ? path.join(v.basePath, linuxExe.path)
                        : `itch://launch/${cave.id}`;
                } catch { launchCmd = `itch://launch/${cave.id}`; }
            } else {
                launchCmd = `itch://install/${game.id}`;
            }

            // Match existing record: by launch key, then title+store, then any itch:// launch cmd + title
            let existing = db.prepare("SELECT * FROM games WHERE LaunchCommand = ?").get(`itch://install/${game.id}`);
            if (!existing) existing = db.prepare("SELECT * FROM games WHERE LOWER(Store) LIKE '%itch%' AND LOWER(Game) = LOWER(?)").get(game.title);
            if (!existing && cave) existing = db.prepare("SELECT * FROM games WHERE LaunchCommand = ? AND LOWER(Game) = LOWER(?)").get(`itch://launch/${cave.id}`, game.title);
            if (!existing) existing = db.prepare("SELECT * FROM games WHERE LaunchCommand LIKE 'itch://%' AND LOWER(Game) = LOWER(?)").get(game.title);

            let gameId;
            if (existing) {
                const storeFixed = (existing.Store || '').toLowerCase().includes('itch') ? existing.Store : 'itch.io';
                db.prepare("UPDATE games SET LaunchCommand=?, Installed=?, Store=? WHERE id=?").run(launchCmd, installed, storeFixed, existing.id);
                gameId = existing.id;
            } else {
                gameId = db.prepare("INSERT INTO games (Game,Store,LaunchCommand,Installed) VALUES (?,?,?,?)").run(game.title, 'itch.io', launchCmd, installed).lastInsertRowid;
            }

            // Queue cover art download (must run outside the transaction, it's async)
            const hasCover = (existing?.CoverArt || '');
            if (game.cover_url && !hasCover && gameId) {
                coverTasks.push({ url: game.cover_url, gameId });
            }

            imported++;
        }
        })();

        // Fire cover downloads after transaction commits
        for (const { url, gameId } of coverTasks) {
            (async () => {
                try {
                    const res = await session.defaultSession.fetch(url, { headers: { 'User-Agent': 'Clarity/1.0' } });
                    const buf = Buffer.from(await res.arrayBuffer());
                    const file = `${gameId}_itch_cover.png`;
                    fs.writeFileSync(path.join(imDir, file), buf);
                    db.prepare("UPDATE games SET CoverArt=? WHERE id=?").run(`GameManagerConfig/images/${file}`, gameId);
                } catch (e) { console.error('[itch cover download]', gameId, e.message); }
            })();
        }
    } catch(e) {
        return { success: false, message: e.message };
    } finally {
        try { itchDb.close(); } catch {}
    }

    return { success: true, count: imported, message: `Synced ${imported} itch.io game${imported !== 1 ? 's' : ''}.` };
}

ipcMain.handle('sync-itch', async () => doItchSync());

// ── STORE BROWSER ─────────────────────────────────────────────────────────

const STORE_CONFIGS = {
    gog:     { url: 'https://www.gog.com/',         label: 'GOG STORE'  },
    epic:    { url: 'https://store.epicgames.com/', label: 'EPIC STORE' },
    flathub: { url: 'https://flathub.org/',         label: 'FLATHUB'    }
};
const _storeWins = {};

ipcMain.handle('open-store-browser', (e, store, colors) => {
    const cfg = STORE_CONFIGS[store];
    if (!cfg) return;
    if (_storeWins[store] && !_storeWins[store].isDestroyed()) { _storeWins[store].focus(); return; }

    const { bg, bgMenu, accent, textDim, borderSolid } = colors;

    const win = new BrowserWindow({
        width: 1400, height: 900, frame: false,
        webPreferences: { partition: `persist:store-${store}` }
    });
    _storeWins[store] = win;
    win.on('closed', () => { delete _storeWins[store]; });

    const injectTitlebar = () => {
        const script = `(function(){
            if(document.getElementById('clarity-sb'))return;
            var bg=${JSON.stringify(bg)},bgMenu=${JSON.stringify(bgMenu)},accent=${JSON.stringify(accent)},textDim=${JSON.stringify(textDim)},borderSolid=${JSON.stringify(borderSolid)},label=${JSON.stringify(cfg.label)};
            var st=document.createElement('style');
            st.textContent='::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:'+bg+'}::-webkit-scrollbar-thumb{background:'+accent+';border-radius:4px}::-webkit-scrollbar-thumb:hover{opacity:.8}body{margin-top:38px!important}html{padding-top:0!important}';
            document.head.appendChild(st);
            var tb=document.createElement('div');
            tb.id='clarity-sb';
            tb.style.cssText='position:fixed;top:0;left:0;right:0;height:38px;background:'+bgMenu+';border-bottom:1px solid '+borderSolid+';display:flex;align-items:center;justify-content:space-between;z-index:2147483647;-webkit-app-region:drag;font-family:Raleway,sans-serif;box-sizing:border-box;';
            var brand=document.createElement('div');
            brand.style.cssText='padding:0 16px;font-size:10px;font-weight:900;color:'+textDim+';letter-spacing:3px;';
            brand.textContent=label;
            var bs='background:transparent;border:none;color:'+accent+';width:42px;height:38px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;-webkit-app-region:no-drag;transition:background 0.1s;';
            function mkBtn(html,onclick){var b=document.createElement('button');b.style.cssText=bs;b.innerHTML=html;b.onclick=onclick;return b;}
            var bk=mkBtn('&#8592;',function(){history.back();});
            var fw=mkBtn('&#8594;',function(){history.forward();});
            var cl=mkBtn('&#x2715;',function(){window.close();});
            cl.onmouseover=function(){this.style.background='#d32f2f';this.style.color='white';};
            cl.onmouseout=function(){this.style.background='transparent';this.style.color=accent;};
            var ctrls=document.createElement('div');
            ctrls.style.cssText='display:flex;height:100%;-webkit-app-region:no-drag;';
            ctrls.appendChild(bk);ctrls.appendChild(fw);ctrls.appendChild(cl);
            tb.appendChild(brand);tb.appendChild(ctrls);
            if(document.body)document.body.prepend(tb);
            function pushFixed(){
                var sels=['header','nav','[role="banner"]','[class*="header"]','[class*="Header"]','[class*="navbar"]','[class*="topbar"]','[class*="top-bar"]','[class*="nav-bar"]','[class*="navigation"]'];
                sels.forEach(function(sel){
                    try{document.querySelectorAll(sel).forEach(function(el){
                        if(el.id==='clarity-sb')return;
                        var s=window.getComputedStyle(el);
                        if(s.position==='fixed'){var t=parseFloat(s.top)||0;if(t<38)el.style.setProperty('top',(t+38)+'px','important');}
                    });}catch(e){}
                });
            }
            setTimeout(pushFixed,200);
            setTimeout(pushFixed,800);
        })();`;
        win.webContents.executeJavaScript(script).catch(() => {});
    };

    win.webContents.on('did-finish-load', injectTitlebar);
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
    win.loadURL(cfg.url);
});

// --- SYNC ENGINES ---
// ── FLATPAK ────────────────────────────────────────────────────────────────

ipcMain.handle('save-flatpak-art', (e, gameId, coverB64, heroB64, iconSrcPath) => {
    const imagesDir = path.join(baseDir, 'GameManagerConfig', 'images');
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

ipcMain.handle('sync-steam', async (event, steamId, apiKey) => {
    if (!steamId || !apiKey) return { success: false, message: "Missing SteamID or API Key." };
    // skip_unvetted_apps=false is REQUIRED: it defaults to true, which makes Steam
    // silently omit "unvetted" apps (a trust flag on many small/indie titles) from
    // GetOwnedGames, so owned games like those never import.
    // include_played_free_games=true also pulls free-to-play games you've played.
    const base = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=true&skip_unvetted_apps=false`;
    try {
        // Primary list = everything, including played free-to-play games (the import set).
        const response = await fetch(`${base}&include_played_free_games=true`);
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        const data = await response.json();
        if (!data.response || !data.response.games) return { success: false, message: "Could not read games." };

        // Second list = paid/owned only (no free games). Any appid in the primary list
        // but NOT here is a free-to-play title → tag it so the UI can pill + hide it.
        // Best-effort: if this call fails we still import everything, just untagged.
        const freeAppids = new Set();
        let freeSetKnown = false;
        try {
            const paidResp = await fetch(base);
            if (paidResp.ok) {
                const paidData = await paidResp.json();
                const paidIds = new Set((paidData.response?.games || []).map(g => String(g.appid)));
                for (const g of data.response.games) {
                    const id = String(g.appid);
                    if (!paidIds.has(id)) freeAppids.add(id);
                }
                freeSetKnown = true;
            }
        } catch (e) { /* 2nd fetch failed → leave tags untouched this run */ }

        let added = 0;
        let updated = 0;
        const games = data.response.games;

        db.transaction(() => { for (const g of games) {
            const r = upsertSteamGame(g.appid, g.name);
            if (r === 'added') added++;
            else if (r === 'updated') updated++;
        } })();
        // Capture Steam playtime (minutes): playtime_forever (total) + playtime_2weeks (recent).
        const _ptStmt = db.prepare("UPDATE games SET Playtime=?, Playtime2wk=? WHERE SteamAppID=?");
        db.transaction(() => { for (const g of games) _ptStmt.run(g.playtime_forever || 0, g.playtime_2weeks || 0, String(g.appid)); })();
        // Tag free-to-play Steam games (matched by SteamAppID, whichever import path they took).
        // Only re-tag when the free set was actually computed, so a failed 2nd fetch never wipes tags.
        if (freeSetKnown) {
            const _ftpStmt = db.prepare("UPDATE games SET FreeToPlay=? WHERE SteamAppID=?");
            db.transaction(() => { for (const g of games) _ftpStmt.run(freeAppids.has(String(g.appid)) ? 1 : 0, String(g.appid)); })();
        }

        // ── Local-install fallback ────────────────────────────────────────────
        // Steam's Web API omits free games / demos the user has never LAUNCHED
        // (include_played_free_games only returns *played* free games, and no
        // parameter lifts that limit), so newly added-but-unplayed free titles &
        // demos never import. Scan local Steam appmanifests and import any
        // installed appid the API didn't already return. These are, by definition,
        // not in the paid set → tag them free-to-play so the FREE pill / hide-free
        // toggle apply, consistent with API-imported free games.
        let localAdded = 0;
        try {
            const apiIds = new Set(games.map(g => String(g.appid)));
            db.transaction(() => {
                for (const dir of getSteamLibraryPaths()) {
                    let files; try { files = fs.readdirSync(dir); } catch { continue; }
                    for (const f of files) {
                        const m = f.match(/^appmanifest_(\d+)\.acf$/); if (!m) continue;
                        const aid = m[1];
                        if (apiIds.has(aid)) continue;   // already handled via the Web API
                        let acf; try { acf = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
                        const nm = acf.match(/"name"\s+"([^"]*)"/);
                        const nameLocal = nm ? nm[1].trim() : '';
                        if (!nameLocal || isSteamInfraApp(nameLocal)) continue; // skip Proton / runtimes / redistributables
                        const r = upsertSteamGame(aid, nameLocal);
                        if (r === 'added') {
                            added++; localAdded++;
                            if (freeSetKnown) db.prepare("UPDATE games SET FreeToPlay=1 WHERE SteamAppID=?").run(aid);
                        } else if (r === 'updated') {
                            updated++;
                        }
                    }
                }
            })();
        } catch (e) { console.error('Local Steam appmanifest scan failed:', e); }

        // ── Removal detection ─────────────────────────────────────────────────
        // Steam is authoritative for what the user still HAS: owned/played-free games
        // (the API list) plus anything installed locally (appmanifests, which also
        // covers demos the API never returns). Any Steam-launcher entry whose appid is
        // in NEITHER set was uninstalled/refunded and should be dropped. Guarded on a
        // non-empty API list so a transient failure or 0-game response never purges.
        let removed = 0;
        if (games.length) {
            const presentIds = new Set(games.map(g => String(g.appid)));
            for (const dir of getSteamLibraryPaths()) {
                let files; try { files = fs.readdirSync(dir); } catch { continue; }
                for (const f of files) { const m = f.match(/^appmanifest_(\d+)\.acf$/); if (m) presentIds.add(m[1]); }
            }
            // Only rows that are genuinely Steam-launched games, never a manual/physical
            // entry that merely borrows a SteamAppID for artwork scraping.
            const steamRows = db.prepare(
                "SELECT id, Store, LaunchCommand, LaunchCommands, SteamAppID, InstallerGameId FROM games WHERE LaunchCommand LIKE '%steam://rungameid%' OR LaunchCommands LIKE '%steam://rungameid%'"
            ).all();
            db.transaction(() => {
                for (const row of steamRows) {
                    const blob = (row.LaunchCommand || '') + ' ' + (row.LaunchCommands || '');
                    const mm = blob.match(/steam:\/\/rungameid\/(\d+)/i);
                    const aid = mm ? mm[1] : String(row.SteamAppID || '').replace(/\.0+$/, '');
                    if (!aid || presentIds.has(aid)) continue;
                    pruneStoreEntry(row, 'steam');
                    removed++;
                }
            })();
        }

        let message = `Imported ${added} new games from Steam.\n(Updated ${updated} existing entries).`;
        if (localAdded) message += `\nIncluded ${localAdded} free/demo game(s) detected from your local Steam install.`;
        if (removed)    message += `\nRemoved ${removed} game(s) no longer in your Steam library.`;
        return { success: true, count: added, message };
    } catch (err) {
        return { success: false, message: `Steam API Error: ${err.message}` };
    }
});

ipcMain.handle('sync-gog', async () => {
    return new Promise((resolve) => {
        const parentWin = BrowserWindow.getFocusedWindow();
        const gogWin = new BrowserWindow({
            parent: parentWin, modal: true, width: 1000, height: 800, title: "Log in to GOG",
            webPreferences: { nodeIntegration: false, contextIsolation: true }
        });
        gogWin.setMenu(null);
        gogWin.loadURL('https://www.gog.com/');
        gogWin.webContents.on('did-finish-load', () => {
            gogWin.webContents.executeJavaScript(`
            if (!document.getElementById('clarity-gog-banner')) {
                const banner = document.createElement('div');
                banner.id = 'clarity-gog-banner';
                banner.innerHTML = "<strong style='font-size:16px;'>Clarity:</strong> Log in to your GOG account using the menu at the top, then <u>CLOSE THIS WINDOW</u> to fetch your games!";
                banner.style.cssText = "position: fixed; bottom: 0; left: 0; width: 100%; background: #673ab7; color: white; text-align: center; padding: 15px; z-index: 9999999; box-shadow: 0 -4px 6px rgba(0,0,0,0.3); font-family: sans-serif;";
                document.body.appendChild(banner);
            }
            `);
        });
        gogWin.on('closed', async () => {
            try {
                const url = "https://www.gog.com/account/getFilteredProducts?hiddenFlag=0&mediaType=1&page=1&totalPages=50";
                const response = await net.fetch(url);
                if (!response.ok) { resolve({ success: false, message: "Could not fetch GOG data. Make sure you logged in successfully." }); return; }
                const data = await response.json();
                if (!data.products) { resolve({ success: false, message: "No games found or login failed." }); return; }

                let added = 0;
                let updated = 0;
                const insertStmt = db.prepare("INSERT INTO games (Store, Game, FAV, WANT_TO_PLAY) VALUES ('GOG', ?, 'NO', 'NO')");
                const selectStmt = db.prepare("SELECT * FROM games WHERE LOWER(Game) = LOWER(?)");
                const updateStmt = db.prepare("UPDATE games SET Store = ? WHERE id = ?");

                db.transaction(() => {
                for (const product of data.products) {
                    const title = product.title.trim();
                    if (!title) continue;

                    const existing = selectStmt.get(title);

                    if (existing) {
                        let stores = existing.Store ? existing.Store.split(',').map(s => s.trim()) : [];
                        if (!stores.some(s => s.toLowerCase() === 'gog')) {
                            stores.push('GOG');
                            updateStmt.run(stores.join(', '), existing.id);
                            updated++;
                        }
                    } else {
                        insertStmt.run(title);
                        added++;
                    }
                }
                })();
                resolve({ success: true, message: `Imported ${added} new games from GOG!\n(Updated ${updated} existing entries).` });
            } catch (err) { resolve({ success: false, message: `GOG Fetch Error: ${err.message}` }); }
        });
    });
});

// --- LOCAL FILE PICKER ---
ipcMain.handle('select-local-image', async (event, gameId, type) => {
    const win = BrowserWindow.getFocusedWindow();

    let titleStr = "Image";
    if (type === 'cover') titleStr = "Cover Art";
    else if (type === 'screenshot') titleStr = "Screenshot";
    else if (type === 'hero') titleStr = "Hero Art";
    else if (type === 'logo') titleStr = "Logo (Transparent PNG)";
    else if (type === 'icon') titleStr = "Icon";

    const { filePaths } = await dialog.showOpenDialog(win, {
        title: `Select Local ${titleStr}`,
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'ico'] }],
        properties: ['openFile']
    });

    if (filePaths && filePaths.length > 0) {
        try {
            const source = filePaths[0];
            const ext = path.extname(source);
            const fileName = `${gameId}_local_${type}_${Date.now()}${ext}`;
            const dest = path.join(imagesDir, fileName);
            fs.copyFileSync(source, dest);

            const dbPath = `GameManagerConfig/images/${fileName}`;

            let column = 'CoverArt';
            if (type === 'screenshot') column = 'Screenshot';
            else if (type === 'hero') column = 'HeroArt';
            else if (type === 'logo') column = 'Logo';
            else if (type === 'icon') column = 'Icon';

            db.prepare(`UPDATE games SET ${column} = ? WHERE id = ?`).run(dbPath, gameId);
            return dbPath;
        } catch (e) { return null; }
    }
    return null;
});

// --- TRAILER LOGIC ---
function getBeautifulName(gameName) { return gameName.replace(/[\\/:*?"<>|#]/g, '').trim(); }
function getOldCrushedName(gameName) { return gameName.replace(/[^a-z0-9]/gi, '_').toLowerCase(); }

ipcMain.handle('delete-trailer', (event, gameName) => {
    const beautifulPath = path.join(trailersDir, `${getBeautifulName(gameName)}.mp4`);
    const oldPath = path.join(trailersDir, `${getOldCrushedName(gameName)}.mp4`);
    let deleted = false;
    try {
        if (fs.existsSync(beautifulPath)) { fs.unlinkSync(beautifulPath); deleted = true; }
        if (fs.existsSync(oldPath)) { fs.unlinkSync(oldPath); deleted = true; }
    } catch(e) {}
    return deleted;
});

ipcMain.handle('search-youtube', async (event, gameName) => {
    const runSearch = (query) => new Promise((resolve) => {
        const args = ['--config-location', ytDlpConfigPath, `ytsearch5:${query}`, '--print', '%(id)s|%(thumbnail)s|%(title)s', '--no-playlist'];
        execFile(ytDlpPath, args, { timeout: 20000 }, (error, stdout) => {
            if (!stdout?.trim()) { resolve([]); return; }
            const lines = stdout.split('\n').filter(l => l.trim());
            resolve(lines.map(line => { const parts = line.split('|'); return { id: parts[0], thumbnail: parts[1], title: parts.slice(2).join('|') }; }));
        });
    });
    // Try "official trailer" first, broader and catches branded trailers; fall back to plain "trailer"
    let results = await runSearch(`${gameName} official trailer`);
    if (results.length === 0) results = await runSearch(`${gameName} trailer`);
    return results;
});

ipcMain.handle('fetch-steam-trailer', async (event, appId) => {
    try {
        if (!appId || appId === 'None') return null;
        const detailsUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}`;
        const detailsRes = await fetch(detailsUrl);
        const detailsData = await detailsRes.json();

        if (!detailsData[appId].success) return null;

        const appData = detailsData[appId].data;
        if (appData.movies && appData.movies.length > 0) {
            const movie = appData.movies[0];
            if (movie.mp4 && movie.mp4.max) return movie.mp4.max;
            if (movie.webm && movie.webm.max) return movie.webm.max;
            if (movie.webm && movie.webm['480']) return movie.webm['480'];
        }
        return null;
    } catch (e) {
        return null;
    }
});

// --- OTHER FETCHERS ---
ipcMain.handle('fetch-hltb', async (event, gameName) => {
    try {
        let results = await searchHltb(gameName);
        if (results.length === 0) {
            let cleanName = gameName.replace(/[:\-].*/, '').replace(/[™®©]/g, '').trim();
            results = await searchHltb(cleanName);
        }
        if (results.length > 0 && results[0].comp_main > 0) return `${Math.round(results[0].comp_main / 3600)} Hours`;
        return "Unknown";
    } catch (e) {
        if (e.message.includes('404')) return "API Offline";
        return "Error";
    }
});

ipcMain.handle('fetch-proton', async (event, appId) => {
    try {
        const response = await fetch(`https://www.protondb.com/api/v1/reports/summaries/${appId}.json`);
        if (!response.ok) return "ERROR";
        const data = await response.json();
        return data.tier ? data.tier.toUpperCase() : "UNKNOWN";
    } catch (e) { return "ERROR"; }
});

ipcMain.handle('search-steam', async (e, gameName) => {
    try {
        let res = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`);
        let data = await res.json();
        if (!data.items || data.items.length === 0) return [];
        return data.items.map(item => ({ id: item.id, name: item.name }));
    } catch(e) { return []; }
});

async function sgdbFetchFirst(gameName, apiKey, appId, assetType) {
    try {
        const headers = { "Authorization": `Bearer ${apiKey}`, "User-Agent": "Mozilla/5.0" };
        let sgdbId = null;
        if (appId) {
            const r = await fetch(`https://www.steamgriddb.com/api/v2/games/steam/${appId}`, { headers });
            const d = await r.json();
            if (d.success && d.data) sgdbId = d.data.id;
        }
        if (!sgdbId) {
            const res = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`, { headers });
            const data = await res.json();
            if (!data.success || !data.data?.length) return null;
            sgdbId = data.data[0].id;
        }
        const endpoint = assetType === 'hero' ? 'heroes' : assetType === 'logo' ? 'logos' : 'grids';
        const res2 = await fetch(`https://www.steamgriddb.com/api/v2/${endpoint}/game/${sgdbId}`, { headers });
        const data2 = await res2.json();
        if (!data2.success || !data2.data?.length) return null;
        const url = data2.data[0].url;
        const ext = assetType === 'logo' ? 'png' : 'jpg';
        const safeN = gameName.replace(/[\\/:*?"<>|#]/g, '').trim();
        const fileName = `${safeN} - SGDB ${assetType}.${ext}`;
        if (await downloadImage(url, path.join(imagesDir, fileName))) return `GameManagerConfig/images/${fileName}`;
        return null;
    } catch(e) { return null; }
}

ipcMain.handle('sgdb-search', async (e, gameName, apiKey, appId, assetType = 'cover') => {
    try {
        const headers = { "Authorization": `Bearer ${apiKey}`, "User-Agent": "Mozilla/5.0" };
        let sgdbId = null;
        if (appId) {
            let r = await fetch(`https://www.steamgriddb.com/api/v2/games/steam/${appId}`, {headers});
            let d = await r.json();
            if (d.success && d.data) sgdbId = d.data.id;
        }
        if (!sgdbId) {
            let res = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`, {headers});
            let data = await res.json();
            if (!data.success || !data.data || data.data.length === 0) return [];
            sgdbId = data.data[0].id;
        }

        let endpoint = 'grids';
        if (assetType === 'hero') endpoint = 'heroes';
        else if (assetType === 'logo') endpoint = 'logos';
        else if (assetType === 'icon') endpoint = 'icons';

        let queryStr = assetType === 'cover' ? '?dimensions=600x900' : '';

        let res2 = await fetch(`https://www.steamgriddb.com/api/v2/${endpoint}/game/${sgdbId}${queryStr}`, {headers});
        let data2 = await res2.json();
        if (!data2.success || !data2.data) return [];
        return data2.data.map(g => ({ thumb: g.thumb, url: g.url }));
    } catch(e) { return []; }
});

ipcMain.handle('sgdb-apply', async (e, gameId, url, assetType = 'cover') => {
    try {
        const ext = assetType === 'cover' || assetType === 'hero' ? 'jpg' : 'png';
        const fileName = `${gameId}_Custom${assetType}_${Date.now()}.${ext}`;
        const savePath = path.join(imagesDir, fileName);

        const success = await downloadImage(url, savePath);
        if (success) {
            const dbPath = `GameManagerConfig/images/${fileName}`;

            let col = 'CoverArt';
            if (assetType === 'hero') col = 'HeroArt';
            else if (assetType === 'logo') col = 'Logo';
            else if (assetType === 'icon') col = 'Icon';

            db.prepare(`UPDATE games SET ${col} = ? WHERE id = ?`).run(dbPath, gameId);
            return dbPath;
        }
        return false;
    } catch(err) { return false; }
});

async function downloadImage(url, destPath) {
    try {
        const res = await fetch(url);
        if (!res.ok) return false;
        const buffer = await res.arrayBuffer();
        fs.writeFileSync(destPath, Buffer.from(buffer));
        return true;
    } catch (err) { return false; }
}

ipcMain.handle('auto-fetch', async (event, gameId, gameName, specificAppId) => {
    try {
        const safeName = gameName.replace(/[\\/:*?"<>|#]/g, '').trim();
        let appId = specificAppId;

        // ── 1. STEAM SEARCH (find App ID if missing) ──────────────────────
        if (!appId) {
            try {
                const sr = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`);
                const sd = await sr.json();
                if (sd.items?.length > 0) {
                    const match = sd.items.find(item => titleSimilarity(item.name || '', gameName) >= 0.4);
                    if (match) appId = match.id;
                }
            } catch(e) {}
        }

        // ── 2. STEAM DETAILS ──────────────────────────────────────────────
        // Read existing local images, preserved if already set; never overwritten
        const existing = db.prepare("SELECT CoverArt, HeroArt, Logo, Icon, Screenshot FROM games WHERE id=?").get(gameId) || {};
        const isLocal = (v) => v && String(v).startsWith('GameManagerConfig');

        let steamSuccess = false, appData = null;
        let desc = "", htmlDesc = "", dev = "", pub = "", released = "", meta = "";
        let genre = "", coop = "None", players = "", tags = "";
        let hltbResult = "", protonResult = "", steamTrailerUrl = "";
        let dbCoverPath  = isLocal(existing.CoverArt)   ? existing.CoverArt   : "";
        let dbHeroPath   = isLocal(existing.HeroArt)    ? existing.HeroArt    : "";
        let dbLogoPath   = isLocal(existing.Logo)       ? existing.Logo       : "";
        let dbScreenPath = isLocal(existing.Screenshot) ? existing.Screenshot : "";

        if (appId) {
            try {
                const dr = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
                const dd = await dr.json();
                if (dd[appId]?.success) {
                    steamSuccess = true;
                    appData = dd[appId].data;

                    desc     = appData.short_description || "";
                    htmlDesc = appData.detailed_description || "";
                    dev      = appData.developers?.join(', ') || "";
                    pub      = appData.publishers?.join(', ') || "";
                    released = appData.release_date?.date?.slice(-4) || "";
                    meta     = appData.metacritic ? String(appData.metacritic.score) : "";
                    genre    = appData.genres?.map(g => g.description).join(', ') || "";

                    const cats = appData.categories?.map(c => c.description) || [];
                    if (cats.includes("Online Co-op") && cats.includes("Shared/Split Screen Co-op")) coop = "Local & Online";
                    else if (cats.includes("Online Co-op")) coop = "Online";
                    else if (cats.includes("Shared/Split Screen Co-op")) coop = "Local";
                    else if (cats.includes("Co-op")) coop = "Online/Local";
                    players = [cats.includes("Single-player") && "Single-player", cats.includes("Multi-player") && "Multi-player"].filter(Boolean).join(', ');
                    tags    = cats.slice(0, 5).join(", ");

                    // HLTB
                    try {
                        let hr = await searchHltb(gameName);
                        if (!hr.length) hr = await searchHltb(gameName.replace(/[:\-].*/, '').replace(/[™®©]/g, '').trim());
                        if (hr.length > 0 && hr[0].comp_main > 0) hltbResult = `${Math.round(hr[0].comp_main / 3600)} Hours`;
                    } catch(e) {}

                    // ProtonDB
                    try {
                        const pr = await fetch(`https://www.protondb.com/api/v1/reports/summaries/${appId}.json`);
                        if (pr.ok) { const pd = await pr.json(); if (pd.tier) protonResult = pd.tier.toUpperCase(); }
                    } catch(e) {}

                    // Cover (skip if already have a local file)
                    if (!dbCoverPath) {
                        const coverFileName = `${safeName} - Cover.jpg`;
                        const coverPath = path.join(imagesDir, coverFileName);
                        let coverOk = await downloadImage(`https://steamcdn-a.akamaihd.net/steam/apps/${appId}/library_600x900.jpg`, coverPath);
                        if (!coverOk && appData.header_image) coverOk = await downloadImage(appData.header_image, coverPath);
                        if (coverOk) dbCoverPath = `GameManagerConfig/images/${coverFileName}`;
                    }

                    // Hero (skip if already have a local file)
                    if (!dbHeroPath) {
                        const heroFileName = `${safeName} - Hero.jpg`;
                        if (await downloadImage(`https://steamcdn-a.akamaihd.net/steam/apps/${appId}/library_hero.jpg`, path.join(imagesDir, heroFileName)))
                            dbHeroPath = `GameManagerConfig/images/${heroFileName}`;
                    }

                    // Logo (skip if already have a local file)
                    if (!dbLogoPath) {
                        const logoFileName = `${safeName} - Logo.png`;
                        if (await downloadImage(`https://steamcdn-a.akamaihd.net/steam/apps/${appId}/logo.png`, path.join(imagesDir, logoFileName)))
                            dbLogoPath = `GameManagerConfig/images/${logoFileName}`;
                    }

                    // Screenshots (skip if already have local screenshots)
                    if (!dbScreenPath && appData.screenshots?.length > 0) {
                        const saved = [];
                        for (let i = 0; i < Math.min(5, appData.screenshots.length); i++) {
                            const fn = `${safeName} - Screen ${i+1}.jpg`;
                            if (await downloadImage(appData.screenshots[i].path_full, path.join(imagesDir, fn)))
                                saved.push(`GameManagerConfig/images/${fn}`);
                        }
                        if (saved.length) dbScreenPath = saved.join('|');
                    }

                    // Steam trailer
                    const movie = appData.movies?.[0];
                    if (movie) steamTrailerUrl = movie.mp4?.max || movie.webm?.max || movie.webm?.['480'] || "";
                }
            } catch(e) {}
        }

        // ── 3. SGDB FALLBACK, Hero Art & Logo ───────────────────────────
        const sgdbApiKey = db?.prepare("SELECT value FROM settings WHERE key='steamgriddb_api'").get()?.value;
        if (sgdbApiKey) {
            if (!dbHeroPath) dbHeroPath = await sgdbFetchFirst(gameName, sgdbApiKey, appId, 'hero') || "";
            if (!dbLogoPath) dbLogoPath = await sgdbFetchFirst(gameName, sgdbApiKey, appId, 'logo') || "";
        }

        // ── 4. IGDB ENRICHMENT ────────────────────────────────────────────
        let similarGames = "", franchise = "", igdbTrailerId = "";
        const igdb = await igdbSearch(gameName, appId);

        const isAdultContent = igdb?.themes?.some(t => t.id === 42);
        const igdbTitleSim   = igdb ? titleSimilarity(igdb.name || '', gameName) : 1;
        const skipIgdbArtwork = isAdultContent || igdbTitleSim < 0.4;

        if (igdb) {
            // Similar games & franchise (for all games)
            if (igdb.similar_games?.length) similarGames = igdb.similar_games.map(g => g.name).slice(0, 6).join(', ');
            franchise = igdb.franchises?.[0]?.name || igdb.collection?.name || "";
            igdbTrailerId = igdb.videos?.[0]?.video_id || "";

            // Fill gaps, used when Steam failed or game is non-Steam
            if (!desc   && igdb.summary)               desc    = igdb.summary;
            if (!dev    && igdb.involved_companies)     dev     = igdb.involved_companies.filter(c => c.developer).map(c => c.company.name).join(', ');
            if (!pub    && igdb.involved_companies)     pub     = igdb.involved_companies.filter(c => c.publisher).map(c => c.company.name).join(', ');
            if (!genre  && igdb.genres)                 genre   = [...(igdb.genres?.map(g => g.name) || []), ...(igdb.themes?.map(t => t.name) || [])].slice(0, 3).join(', ');
            if (!released && igdb.first_release_date)   released = new Date(igdb.first_release_date * 1000).getFullYear().toString();
            if (!meta   && igdb.aggregated_rating)      meta    = Math.round(igdb.aggregated_rating).toString();

            // Discover Steam App ID for non-Steam games → enables ProtonDB
            if (!appId) {
                const steamExt = igdb.external_games?.find(e => e.category === 1);
                if (steamExt?.uid) {
                    appId = String(steamExt.uid).replace(/\.0+$/, '');
                    try {
                        const pr = await fetch(`https://www.protondb.com/api/v1/reports/summaries/${appId}.json`);
                        if (pr.ok) { const pd = await pr.json(); if (pd.tier) protonResult = pd.tier.toUpperCase(); }
                    } catch(e) {}
                }
            }

            // Cover from IGDB (fallback), skip if adult content or title mismatch
            if (!dbCoverPath && igdb.cover?.url && !skipIgdbArtwork) {
                const fn = `${safeName} - Cover.jpg`;
                if (await downloadImage(igdbImg(igdb.cover.url, 'cover_big'), path.join(imagesDir, fn)))
                    dbCoverPath = `GameManagerConfig/images/${fn}`;
            }

            // Screenshots from IGDB (fallback), skip if adult content or title mismatch
            if (!dbScreenPath && igdb.screenshots?.length && !skipIgdbArtwork) {
                const saved = [];
                for (let i = 0; i < Math.min(5, igdb.screenshots.length); i++) {
                    const fn = `${safeName} - Screen ${i+1}.jpg`;
                    if (await downloadImage(igdbImg(igdb.screenshots[i].url, 'screenshot_big'), path.join(imagesDir, fn)))
                        saved.push(`GameManagerConfig/images/${fn}`);
                }
                if (saved.length) dbScreenPath = saved.join('|');
            }
        }

        // ── 5. SAVE ───────────────────────────────────────────────────────
        if (!steamSuccess && !igdb) return { success: false, message: "No data found on Steam or IGDB." };

        const descI18n = await fetchDescI18n(appId, desc);
        db.prepare(`UPDATE games SET Description=?, SteamDesc=?, Description_i18n=?, DEV=?, PUB=?, RELEASED=?, METACRITIC=?, GENRE=?, CoverArt=?, HeroArt=?, Logo=?, Screenshot=?, SteamAppID=?, Coop=?, NumPlayers=?, Tags=?, HLTB_Main=?, ProtonTier=?, SteamTrailer=?, SimilarGames=?, Franchise=?, IGDBTrailer=? WHERE id=?`)
        .run(desc, htmlDesc, descI18n, dev, pub, released, meta, genre, dbCoverPath, dbHeroPath, dbLogoPath, dbScreenPath, appId || "", coop, players, tags, hltbResult, protonResult, steamTrailerUrl, similarGames, franchise, igdbTrailerId, gameId);

        const sources = [steamSuccess && 'Steam', igdb && 'IGDB'].filter(Boolean).join(' + ');
        return { success: true, message: `Data fetched via ${sources}!` };
    } catch (err) { return { success: false, message: `Scraping error: ${err.message}` }; }
});

// Text-only variant, same as auto-fetch but skips all image downloads
ipcMain.handle('auto-fetch-text', async (event, gameId, gameName, specificAppId) => {
    try {
        let appId = specificAppId;

        if (!appId) {
            try {
                const sr = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`);
                const sd = await sr.json();
                if (sd.items?.length > 0) {
                    const match = sd.items.find(item => titleSimilarity(item.name || '', gameName) >= 0.4);
                    if (match) appId = match.id;
                }
            } catch(e) {}
        }

        let steamSuccess = false, appData = null;
        let desc = "", htmlDesc = "", dev = "", pub = "", released = "", meta = "";
        let genre = "", coop = "None", players = "", tags = "";
        let hltbResult = "", protonResult = "", steamTrailerUrl = "";

        if (appId) {
            try {
                const dr = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
                const dd = await dr.json();
                if (dd[appId]?.success) {
                    steamSuccess = true;
                    appData = dd[appId].data;
                    desc     = appData.short_description || "";
                    htmlDesc = appData.detailed_description || "";
                    dev      = appData.developers?.join(', ') || "";
                    pub      = appData.publishers?.join(', ') || "";
                    released = appData.release_date?.date?.slice(-4) || "";
                    meta     = appData.metacritic ? String(appData.metacritic.score) : "";
                    genre    = appData.genres?.map(g => g.description).join(', ') || "";
                    const cats = appData.categories?.map(c => c.description) || [];
                    if (cats.includes("Online Co-op") && cats.includes("Shared/Split Screen Co-op")) coop = "Local & Online";
                    else if (cats.includes("Online Co-op")) coop = "Online";
                    else if (cats.includes("Shared/Split Screen Co-op")) coop = "Local";
                    else if (cats.includes("Co-op")) coop = "Online/Local";
                    players = [cats.includes("Single-player") && "Single-player", cats.includes("Multi-player") && "Multi-player"].filter(Boolean).join(', ');
                    tags    = cats.slice(0, 5).join(", ");
                    try {
                        let hr = await searchHltb(gameName);
                        if (!hr.length) hr = await searchHltb(gameName.replace(/[:\-].*/, '').replace(/[™®©]/g, '').trim());
                        if (hr.length > 0 && hr[0].comp_main > 0) hltbResult = `${Math.round(hr[0].comp_main / 3600)} Hours`;
                    } catch(e) {}
                    try {
                        const pr = await fetch(`https://www.protondb.com/api/v1/reports/summaries/${appId}.json`);
                        if (pr.ok) { const pd = await pr.json(); if (pd.tier) protonResult = pd.tier.toUpperCase(); }
                    } catch(e) {}
                    const movie = appData.movies?.[0];
                    if (movie) steamTrailerUrl = movie.mp4?.max || movie.webm?.max || movie.webm?.['480'] || "";
                }
            } catch(e) {}
        }

        let similarGames = "", franchise = "", igdbTrailerId = "";
        const igdb = await igdbSearch(gameName, appId);
        if (igdb) {
            if (igdb.similar_games?.length) similarGames = igdb.similar_games.map(g => g.name).slice(0, 6).join(', ');
            franchise = igdb.franchises?.[0]?.name || igdb.collection?.name || "";
            igdbTrailerId = igdb.videos?.[0]?.video_id || "";
            if (!desc   && igdb.summary)             desc    = igdb.summary;
            if (!dev    && igdb.involved_companies)   dev     = igdb.involved_companies.filter(c => c.developer).map(c => c.company.name).join(', ');
            if (!pub    && igdb.involved_companies)   pub     = igdb.involved_companies.filter(c => c.publisher).map(c => c.company.name).join(', ');
            if (!genre  && igdb.genres)               genre   = [...(igdb.genres?.map(g => g.name) || []), ...(igdb.themes?.map(t => t.name) || [])].slice(0, 3).join(', ');
            if (!released && igdb.first_release_date) released = new Date(igdb.first_release_date * 1000).getFullYear().toString();
            if (!meta   && igdb.aggregated_rating)    meta    = Math.round(igdb.aggregated_rating).toString();
            if (!appId) {
                const steamExt = igdb.external_games?.find(e => e.category === 1);
                if (steamExt?.uid) {
                    appId = String(steamExt.uid).replace(/\.0+$/, '');
                    try {
                        const pr = await fetch(`https://www.protondb.com/api/v1/reports/summaries/${appId}.json`);
                        if (pr.ok) { const pd = await pr.json(); if (pd.tier) protonResult = pd.tier.toUpperCase(); }
                    } catch(e) {}
                }
            }
        }

        if (!steamSuccess && !igdb) return { success: false, message: "No data found on Steam or IGDB." };

        const descI18n = await fetchDescI18n(appId, desc);
        db.prepare(`UPDATE games SET Description=?, SteamDesc=?, Description_i18n=?, DEV=?, PUB=?, RELEASED=?, METACRITIC=?, GENRE=?, SteamAppID=?, Coop=?, NumPlayers=?, Tags=?, HLTB_Main=?, ProtonTier=?, SteamTrailer=?, SimilarGames=?, Franchise=?, IGDBTrailer=? WHERE id=?`)
        .run(desc, htmlDesc, descI18n, dev, pub, released, meta, genre, appId || "", coop, players, tags, hltbResult, protonResult, steamTrailerUrl, similarGames, franchise, igdbTrailerId, gameId);

        const sources = [steamSuccess && 'Steam', igdb && 'IGDB'].filter(Boolean).join(' + ');
        return { success: true, message: `Text metadata fetched via ${sources}!` };
    } catch (err) { return { success: false, message: `Scraping error: ${err.message}` }; }
});

ipcMain.handle('download-csv-template', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const { filePath } = await dialog.showSaveDialog(win, {
        title: 'Save CSV Template',
        defaultPath: 'GameManager_Template.csv',
            filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });

    if (filePath) {
        const headers = "Store,FAV,WANT_TO_PLAY,Game,LaunchCommand,GENRE,RELEASED,SteamAppID,ProtonTier,METACRITIC,HLTB_Main,DEV,PUB,Coop,NumPlayers,Tags,SimilarGames,HeroArt,Logo,Icon,SteamTrailer,SteamDesc,Description\n";
        fs.writeFileSync(filePath, headers, 'utf8');
        return { success: true, message: "Template generated successfully!" };
    }
    return { success: false };
});

ipcMain.handle('export-csv', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const { filePath } = await dialog.showSaveDialog(win, {
        title: 'Export Library to CSV',
        defaultPath: 'GameManager_Export.csv',
            filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });

    if (filePath) {
        try {
            const rows = db.prepare("SELECT Store, FAV, WANT_TO_PLAY, Game, LaunchCommand, GENRE, RELEASED, SteamAppID, ProtonTier, METACRITIC, HLTB_Main, DEV, PUB, Coop, NumPlayers, Tags, SimilarGames, HeroArt, Logo, Icon, SteamTrailer, SteamDesc, Description FROM games").all();

            let csvContent = "Store,FAV,WANT_TO_PLAY,Game,LaunchCommand,GENRE,RELEASED,SteamAppID,ProtonTier,METACRITIC,HLTB_Main,DEV,PUB,Coop,NumPlayers,Tags,SimilarGames,HeroArt,Logo,Icon,SteamTrailer,SteamDesc,Description\n";
            rows.forEach(r => {
                const safeStore = `"${(r.Store || '').replace(/"/g, '""')}"`;
                const safeFav = `"${(r.FAV || '').replace(/"/g, '""')}"`;
                const safeWant = `"${(r.WANT_TO_PLAY || '').replace(/"/g, '""')}"`;
                const safeGame = `"${(r.Game || '').replace(/"/g, '""')}"`;
                const safeLaunch = `"${(r.LaunchCommand || '').replace(/"/g, '""')}"`;
                const safeGenre = `"${(r.GENRE || '').replace(/"/g, '""')}"`;
                const safeRel = `"${(r.RELEASED || '').replace(/"/g, '""')}"`;
                const safeAppId = `"${(r.SteamAppID || '').replace(/"/g, '""')}"`;
                const safeProton = `"${(r.ProtonTier || '').replace(/"/g, '""')}"`;
                const safeMeta = `"${(r.METACRITIC || '').replace(/"/g, '""')}"`;
                const safeHltb = `"${(r.HLTB_Main || '').replace(/"/g, '""')}"`;
                const safeDev = `"${(r.DEV || '').replace(/"/g, '""')}"`;
                const safePub = `"${(r.PUB || '').replace(/"/g, '""')}"`;
                const safeCoop = `"${(r.Coop || '').replace(/"/g, '""')}"`;
                const safePlayers = `"${(r.NumPlayers || '').replace(/"/g, '""')}"`;
                const safeTags = `"${(r.Tags || '').replace(/"/g, '""')}"`;
                const safeSimilar = `"${(r.SimilarGames || '').replace(/"/g, '""')}"`;

                const safeHero = `"${(r.HeroArt || '').replace(/"/g, '""')}"`;
                const safeLogo = `"${(r.Logo || '').replace(/"/g, '""')}"`;
                const safeIcon = `"${(r.Icon || '').replace(/"/g, '""')}"`;
                const safeSteamTrailer = `"${(r.SteamTrailer || '').replace(/"/g, '""')}"`;
                const safeSteamDesc = `"${(r.SteamDesc || '').replace(/"/g, '""')}"`;
                const safeDesc = `"${(r.Description || '').replace(/"/g, '""')}"`;

                csvContent += `${safeStore},${safeFav},${safeWant},${safeGame},${safeLaunch},${safeGenre},${safeRel},${safeAppId},${safeProton},${safeMeta},${safeHltb},${safeDev},${safePub},${safeCoop},${safePlayers},${safeTags},${safeSimilar},${safeHero},${safeLogo},${safeIcon},${safeSteamTrailer},${safeSteamDesc},${safeDesc}\n`;
            });

            fs.writeFileSync(filePath, csvContent, 'utf8');
            return { success: true, message: "Library exported successfully!" };
        } catch (err) {
            return { success: false, message: `Export failed: ${err.message}` };
        }
    }
    return { success: false };
});

ipcMain.handle('import-csv', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const { filePaths } = await dialog.showOpenDialog(win, {
        title: 'Import CSV',
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
        properties: ['openFile']
    });

    if (filePaths && filePaths.length > 0) {
        try {
            const fileContent = await fs.promises.readFile(filePaths[0], 'utf8');

            const rows = [];
            let currentRow = [];
            let currentCell = "";
            let insideQuotes = false;

            for (let i = 0; i < fileContent.length; i++) {
                const char = fileContent[i];
                const nextChar = fileContent[i+1];

                if (char === '"' && insideQuotes && nextChar === '"') {
                    currentCell += '"'; i++;
                } else if (char === '"') {
                    insideQuotes = !insideQuotes;
                } else if (char === ',' && !insideQuotes) {
                    currentRow.push(currentCell.trim()); currentCell = "";
                } else if ((char === '\n' || char === '\r') && !insideQuotes) {
                    if (char === '\r' && nextChar === '\n') i++;
                    currentRow.push(currentCell.trim());
                    if (currentRow.length > 1 || currentRow[0] !== "") rows.push(currentRow);
                    currentRow = []; currentCell = "";
                } else {
                    currentCell += char;
                }
            }
            if (currentCell || currentRow.length > 0) {
                currentRow.push(currentCell.trim());
                rows.push(currentRow);
            }

            if (rows.length < 2) return { success: false, message: "CSV file appears empty or invalid." };

            const headers = rows[0].map(h => h.toLowerCase().replace(/ /g, '_'));
            const gameIdx = headers.indexOf('game');
            const storeIdx = headers.indexOf('store');

            if (gameIdx === -1) return { success: false, message: "CSV is missing the required 'Game' header." };

            let added = 0;
            let skipped = 0;

            const existingRows = db.prepare("SELECT LOWER(Game), LOWER(Store) FROM games").all();
            const existingCache = new Set(existingRows.map(r => `${r['LOWER(Game)']}|${r['LOWER(Store)'] || ''}`));

            const insertStmt = db.prepare(`INSERT INTO games (Store, FAV, WANT_TO_PLAY, Game, LaunchCommand, GENRE, RELEASED, SteamAppID, ProtonTier, METACRITIC, HLTB_Main, DEV, PUB, Coop, NumPlayers, Tags, SimilarGames, HeroArt, Logo, Icon, SteamTrailer, SteamDesc, Description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const gameName = row[gameIdx];
                const storeName = storeIdx !== -1 ? row[storeIdx] : '';

                if (!gameName) continue;

                const cacheKey = `${gameName.toLowerCase()}|${storeName.toLowerCase()}`;
                if (existingCache.has(cacheKey)) {
                    skipped++;
                    continue;
                }

                const getVal = (colName) => { const idx = headers.indexOf(colName.toLowerCase()); return idx !== -1 ? row[idx] : ""; };

                insertStmt.run(
                    storeName,
                    getVal('fav'),
                               getVal('want_to_play') || getVal('want to play'),
                               gameName,
                               getVal('launchcommand') || getVal('launch_command'),
                               getVal('genre'),
                               getVal('released') || getVal('released_(year)'),
                               getVal('steamappid') || getVal('steam_app_id'),
                               getVal('protontier') || getVal('protondb_tier') || getVal('proton_tier'),
                               getVal('metacritic') || getVal('metacritic_score'),
                               getVal('hltb_main') || getVal('hltb_(hours)'),
                               getVal('dev') || getVal('developer'),
                               getVal('pub') || getVal('publisher'),
                               getVal('coop') || getVal('co-op'),
                               getVal('numplayers') || getVal('players'),
                               getVal('tags'),
                               getVal('similargames') || getVal('similar_games'),
                               getVal('heroart') || getVal('hero_art'),
                               getVal('logo'),
                               getVal('icon'),
                               getVal('steamtrailer') || getVal('steam_trailer'),
                               getVal('steamdesc') || getVal('steam_desc'),
                               getVal('description')
                );

                added++;
                existingCache.add(cacheKey);
            }

            return { success: true, message: `Imported ${added} new games!\nSkipped ${skipped} duplicates.` };

        } catch (err) {
            return { success: false, message: `Import failed: ${err.message}` };
        }
    }
    return { success: false };
});

// ── PLAYLISTS ─────────────────────────────────────────────────────────────────
ipcMain.handle('get-playlists', () => {
    if (!db) return [];
    return db.prepare('SELECT * FROM playlists ORDER BY name').all();
});
ipcMain.handle('add-playlist', (_, name, rule) => {
    if (!db) return null;
    // A rule turns the playlist smart: members are computed on read, so it keeps up
    // with the library instead of freezing whatever matched on the day it was made.
    const r = _smart.parseRule(rule);
    return db.prepare('INSERT INTO playlists (name, rule) VALUES (?,?)')
             .run(name.trim(), r ? JSON.stringify(r) : null).lastInsertRowid;
});
ipcMain.handle('update-playlist', (_, id, name) => {
    if (!db) return false;
    db.prepare('UPDATE playlists SET name=? WHERE id=?').run(name.trim(), id);
    return true;
});
// Live count while a rule is being built, so "CRPG" shows what it would collect
// before the playlist exists.
ipcMain.handle('preview-playlist-rule', (_, rule) => {
    if (!db) return 0;
    return _smart.ruleCount(db, rule);
});
ipcMain.handle('delete-playlist', (_, id) => {
    if (!db) return false;
    db.prepare('DELETE FROM playlist_games WHERE playlist_id=?').run(id);
    db.prepare('DELETE FROM playlists WHERE id=?').run(id);
    return true;
});
ipcMain.handle('get-playlist-games', (_, playlistId) => {
    // Smart playlists resolve their rule here; manual ones read playlist_games as before.
    return _smart.playlistGames(db, playlistId);
});
ipcMain.handle('add-game-to-playlist', (_, playlistId, gameId) => {
    if (!db) return { ok: false };
    const max = db.prepare('SELECT MAX(sort_order) AS m FROM playlist_games WHERE playlist_id=?').get(playlistId);
    const order = (max?.m ?? -1) + 1;
    try {
        db.prepare('INSERT INTO playlist_games (playlist_id, game_id, sort_order) VALUES (?, ?, ?)').run(playlistId, gameId, order);
        return { ok: true };
    } catch { return { ok: false, error: 'Already in playlist' }; }
});
ipcMain.handle('remove-game-from-playlist', (_, playlistId, gameId) => {
    if (!db) return false;
    db.prepare('DELETE FROM playlist_games WHERE playlist_id=? AND game_id=?').run(playlistId, gameId);
    return true;
});
ipcMain.handle('get-game-playlists', (_, gameId) => {
    if (!db) return [];
    return db.prepare('SELECT playlist_id FROM playlist_games WHERE game_id=?').all(gameId).map(r => r.playlist_id);
});
ipcMain.handle('get-recently-imported', (_, limit) => {
    if (!db) return [];
    return _genreStore.attachGenres(db, db.prepare('SELECT * FROM games WHERE date_added > 0 ORDER BY date_added DESC LIMIT ?').all(limit));
});

// ── COMMAND BAR SHELL LAUNCHER ────────────────────────────────────────────────
ipcMain.handle('run-shell-cmd', async (_, cmdStr) => {
    const { execFileSync } = require('child_process');
    const parts = cmdStr.trim().split(/\s+/);
    const [cmd, ...args] = parts;

    // Verify binary exists in PATH
    let binPath;
    try { binPath = execFileSync('which', [cmd], { encoding: 'utf8' }).trim(); }
    catch { return { ok: false, msg: `not found: ${cmd}` }; }

    // Known TUI apps that need a terminal emulator
    const TUI = new Set([
        'btop','htop','top','bpytop','glances',
        'vim','nvim','nano','micro','emacs',
        'ranger','mc','nnn','lf','vifm',
        'ncdu','lazygit','tig',
        'cmus','ncmpcpp','cava',
        'mutt','neomutt','aerc',
        'weechat','irssi',
        'alsamixer','pulsemixer',
        'neofetch','fastfetch','pfetch',
        'tmux','screen','zellij',
        'bash','zsh','fish','sh',
    ]);

    // Also flag anything with Terminal=true in its .desktop file
    let needsTerm = TUI.has(cmd);
    if (!needsTerm) {
        try {
            const desktopCheck = execFileSync('bash', ['-c',
                `grep -rl "^Exec=.*\\b${cmd}\\b" /usr/share/applications/ 2>/dev/null | xargs grep -l "^Terminal=true" 2>/dev/null | head -1`
            ], { encoding: 'utf8' }).trim();
            if (desktopCheck) needsTerm = true;
        } catch {}
    }

    if (needsTerm) {
        // Detect available terminal emulator
        const candidates = [
            process.env.TERMINAL,
            'xdg-terminal-exec',
            'x-terminal-emulator',
            'alacritty', 'kitty', 'foot',
            'gnome-terminal', 'konsole',
            'xfce4-terminal', 'xterm',
        ].filter(Boolean);

        let term = null;
        for (const t of candidates) {
            try { execFileSync('which', [t], { encoding: 'utf8' }); term = t; break; }
            catch {}
        }
        if (!term) return { ok: false, msg: 'no terminal emulator found' };

        const fullCmd = [cmd, ...args].join(' ');
        // Keep terminal open after the command exits so TUIs that close naturally
        // don't leave a ghost window, drop to an interactive shell instead.
        const bashInvoc = ['bash', '-c', `${fullCmd}; exec bash`];
        let termArgs;
        if (term === 'gnome-terminal') termArgs = ['--', ...bashInvoc];
        else if (term === 'xdg-terminal-exec') termArgs = bashInvoc;
        else if (['kitty', 'foot'].includes(term)) termArgs = bashInvoc;
        else termArgs = ['-e', ...bashInvoc]; // alacritty, xterm, konsole, xfce4-terminal, x-terminal-emulator

        spawn(term, termArgs, { detached: true, stdio: 'ignore' }).unref();
    } else {
        spawn(binPath, args, { detached: true, stdio: 'ignore' }).unref();
    }

    return { ok: true };
});
