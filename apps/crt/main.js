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
 * the shared omarchy-theme bridge, and starting a game is handed back to the
 * suite rather than reinvented (see 'crt-play' below).
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { spawn } = require('child_process');

const host = require('../../packages/core/platform/index.js');
const { registerSharedHandlers } = require('../../packages/core/shared-ipc.js');
const desktopDescriptor = require('../../packages/core/desktop-descriptor.js');

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
            SELECT id, Game, Installed, LastPlayed, GENRE, RELEASED, CoverArt, LaunchCommand
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
 * Starting a game.
 *
 * ⚠️ Handed back to the suite as --play=<id> rather than run from here. What
 * "play" actually means is a decision tree the Manager owns: the multi-store
 * picker, which engine, which Doom, whether it is even installed, and the
 * last-played write. Couch has its own copy of the launch plumbing and that is
 * already one copy more than ideal; a third would be correct on the day it was
 * written and wrong by the next release.
 */
ipcMain.on('crt-play', (event, gameId) => {
    if (!gameId) return;
    openFace([`--play=${gameId}`]);
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
