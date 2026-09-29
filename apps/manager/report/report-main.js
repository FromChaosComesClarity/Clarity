'use strict';
/*
 * The library report, main-process half: gathers the data, resolves art and fonts, and turns the
 * rendered document into the three things a user can keep, a web page, a PDF and images.
 *
 * Preview and export share one renderer but not one asset strategy. The preview is redrawn on
 * every toggle, so it points at art on disk (file:// URLs, instant). Anything saved has to stand
 * alone on another machine or with no network, so exports inline art and fonts as data URLs,
 * scaled down to what the layout can actually show.
 *
 * Images are CAPTURED, not screenshotted: an offscreen window sized to the exact frame renders
 * the card and capturePage() hands back its pixels, so a 1080x1350 card is 1080x1350 whatever
 * the user's screen, scale factor or window size.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { buildReport, EMULATTE_QUERIES } = require('../../../packages/core/library-report.js');
const { renderReport } = require('./report-render.js');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const LOGO_DIR = path.join(__dirname, '..', 'assets', 'logos');

// Every family the report styles can ask for, including the ones "My theme" borrows.
const FONT_FILES = {
    'Sora': [['Sora.ttf', '100 800']],
    'Fraunces': [['Fraunces.ttf', '100 900']],
    'JetBrains Mono': [['JetBrainsMono-Regular.ttf', 400]],
    'Raleway': [['Raleway-Regular.ttf', 400], ['Raleway-Bold.ttf', 700], ['Raleway-Black.ttf', 900]],
    'Inter': [['Inter.ttf', '100 900']],
    'Poppins': [['Poppins-Regular.ttf', 400], ['Poppins-Bold.ttf', 700], ['Poppins-Black.ttf', 900]],
    'Chicago': [['ChicagoFLF.ttf', 400]],
    'PxPlus IBM VGA8': [['PxPlusIBMVGA8.ttf', 400]],
    'BigBlue Terminal': [['BigBlueTerminal.ttf', 400]],
    'C64 Pro Mono': [['C64ProMono.ttf', 400]],
    'White Rabbit': [['WhiteRabbit.ttf', 400]],
    'Press Start 2P': [['PressStart2P-Regular.ttf', 400]],
    'Fira Code': [['FiraCode-Regular.ttf', 400], ['FiraCode-Bold.ttf', 700]],
    'Hack': [['Hack-Regular.ttf', 400]],
};

const STORE_LOGOS = { Steam: 'steam', GOG: 'gog', Epic: 'epic', 'itch.io': 'itch', Flatpak: 'flatpak', 'PICO-8': 'pico8', Emulation: 'emulation', Physical: 'physical', Apps: 'apps', Others: 'others' };

const SIZES = { portrait: { w: 1080, h: 1350 }, square: { w: 1080, h: 1080 }, story: { w: 1080, h: 1920 }, landscape: { w: 1600, h: 900 } };

// The widest each kind of art is ever drawn in a saved report. Anything larger is wasted bytes.
const MAX_WIDTH = { cover: 400, hero: 1500, logo: 820 };

function registerReportIpc({ ipcMain, getDb, baseDir, BrowserWindow, dialog, nativeImage, loadStrings }) {
    const dataUrlCache = new Map();
    const fontCache = new Map();

    const resolveArt = raw => {
        if (!raw) return null;
        let p = String(raw).replace(/\\/g, '/');
        if (/^https?:/i.test(p)) return null;                       // a saved report never reaches the network
        if (p.startsWith('~')) p = path.join(baseDir, p.replace(/^~\/GameAppBuild/, '').replace(/^~/, ''));
        else if (!path.isAbsolute(p)) p = path.join(baseDir, p);
        return fs.existsSync(p) ? p : null;
    };

    const inlineArt = (abs, kind) => {
        const key = `${abs}|${kind}`;
        if (dataUrlCache.has(key)) return dataUrlCache.get(key);
        let out = '';
        try {
            let im = nativeImage.createFromPath(abs);
            if (!im.isEmpty()) {
                const max = MAX_WIDTH[kind] || 1200;
                if (im.getSize().width > max) im = im.resize({ width: max, quality: 'best' });
                // Logos need their transparency; everything else is a photo and compresses as one.
                out = kind === 'logo' ? `data:image/png;base64,${im.toPNG().toString('base64')}`
                    : `data:image/jpeg;base64,${im.toJPEG(80).toString('base64')}`;
            } else {
                const mime = { webp: 'image/webp', avif: 'image/avif', gif: 'image/gif' }[path.extname(abs).slice(1).toLowerCase()];
                if (mime) out = `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
            }
        } catch { out = ''; }
        dataUrlCache.set(key, out);
        return out;
    };

    const fontsFor = inline => {
        const out = {};
        for (const [family, files] of Object.entries(FONT_FILES)) {
            out[family] = files.map(([file, weight]) => {
                const abs = path.join(FONT_DIR, file);
                if (!inline) return { weight, data: pathToFileURL(abs).href };
                if (!fontCache.has(abs)) fontCache.set(abs, `data:font/ttf;base64,${fs.readFileSync(abs).toString('base64')}`);
                return { weight, data: fontCache.get(abs) };
            });
        }
        return out;
    };

    function gather(prefs = {}) {
        const db = getDb();
        if (!db) throw new Error('Library not ready.');
        const rows = db.prepare('SELECT * FROM games').all();
        let achievements = [];
        try { achievements = db.prepare("SELECT app_id, name, date_unlocked, image_unlocked FROM achievements WHERE IFNULL(date_unlocked,'') <> ''").all(); } catch {}
        let hidePico8 = !prefs.includePico8;
        if (prefs.includePico8 == null) {
            try { hidePico8 = db.prepare("SELECT value FROM settings WHERE key='hide_pico8'").get()?.value === '1'; } catch {}
        }
        // EmuLatte's library sits beside this one when both are installed. Read-only, and optional.
        let emulatte = null;
        const emuDb = path.join(baseDir, 'GameManagerConfig', 'EmuLatte', 'emulatte.db');
        if (fs.existsSync(emuDb)) {
            try {
                const Database = require('better-sqlite3');
                const e = new Database(emuDb, { readonly: true, fileMustExist: true });
                try { emulatte = { games: e.prepare(EMULATTE_QUERIES.games).all(), systems: e.prepare(EMULATTE_QUERIES.systems).all() }; }
                finally { e.close(); }
            } catch { emulatte = null; }
        }
        return buildReport(rows, { achievements, emulatte, hidePico8, recentDays: Number(prefs.recentDays) || 30 });
    }

    function render(report, prefs, { layout, inline, only }) {
        const lang = prefs.lang || 'en';
        return renderReport(report, {
            layout, only, dedupe: inline,
            style: prefs.style || 'clarity',
            theme: prefs.theme || {},
            size: SIZES[prefs.size] || SIZES.portrait,
            sections: Array.isArray(prefs.sections) ? prefs.sections : undefined,
            title: prefs.title || '', subtitle: prefs.subtitle || '',
            lang, strings: (loadStrings(lang) || {}).report || {},
            fonts: fontsFor(inline),
            img: (raw, kind) => { const abs = resolveArt(raw); return !abs ? '' : inline ? inlineArt(abs, kind) : pathToFileURL(abs).href; },
            storeLogo: label => { const f = STORE_LOGOS[label]; if (!f) return ''; const abs = path.join(LOGO_DIR, `${f}.png`); return inline ? inlineArt(abs, 'logo') : pathToFileURL(abs).href; },
        });
    }

    // What the picker needs: every section, whether it has data, in report order.
    ipcMain.handle('report-sections', (_e, prefs) => {
        try {
            const report = gather(prefs || {});
            return { ok: true, sections: report.order.map(id => ({ id, available: !!report.sections[id].available })) };
        } catch (e) { return { ok: false, error: e.message }; }
    });

    ipcMain.handle('report-preview', (_e, prefs = {}) => {
        try {
            const report = gather(prefs);
            const layout = prefs.layout === 'cards' ? 'cards-strip' : prefs.layout === 'poster' ? 'poster' : 'document';
            return { ok: true, html: render(report, prefs, { layout, inline: false }), size: SIZES[prefs.size] || SIZES.portrait };
        } catch (e) { return { ok: false, error: e.message }; }
    });

    const stamp = () => new Date().toISOString().slice(0, 10);
    const safeName = s => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

    // Loads a document into a window and waits until it is really drawn: fonts, every image
    // decoded, and two frames, so a capture never catches a half-painted card.
    async function loadAndSettle(win, file) {
        await win.loadFile(file);
        await win.webContents.executeJavaScript(`(async () => {
            await document.fonts.ready;
            await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        })()`);
    }

    ipcMain.handle('report-export', async (event, prefs = {}, format) => {
        const parent = BrowserWindow.fromWebContents(event.sender);
        let tmp = null, work = null;
        try {
            const report = gather(prefs);
            const base = safeName(prefs.title) || 'Clarity Report';

            if (format === 'html' || format === 'pdf') {
                const html = render(report, prefs, { layout: 'document', inline: true });
                if (format === 'html') {
                    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
                        defaultPath: `${base} ${stamp()}.html`, filters: [{ name: 'Web page', extensions: ['html'] }] });
                    if (canceled || !filePath) return { ok: false, canceled: true };
                    fs.writeFileSync(filePath, html);
                    return { ok: true, path: filePath };
                }
                const { canceled, filePath } = await dialog.showSaveDialog(parent, {
                    defaultPath: `${base} ${stamp()}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
                if (canceled || !filePath) return { ok: false, canceled: true };
                tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-report-'));
                const file = path.join(tmp, 'report.html');
                fs.writeFileSync(file, html);
                work = new BrowserWindow({ show: false, width: 1180, height: 1600, webPreferences: { offscreen: true, javascript: true } });
                await loadAndSettle(work, file);
                // Printed at 72% so the page lays out at desktop width (about 1100 CSS px on A4): the
                // sections keep their two-column layouts instead of collapsing to one narrow column.
                const pdf = await work.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, scale: 0.72 });
                fs.writeFileSync(filePath, pdf);
                return { ok: true, path: filePath };
            }

            if (format === 'png') {
                const size = SIZES[prefs.size] || SIZES.portrait;
                const poster = prefs.layout === 'poster';
                const picked = (Array.isArray(prefs.sections) ? prefs.sections : report.order).filter(id => report.sections[id] && report.sections[id].available);
                if (!picked.length) return { ok: false, error: 'nothing_selected' };

                let target;
                if (poster) {
                    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
                        defaultPath: `${base} ${stamp()}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] });
                    if (canceled || !filePath) return { ok: false, canceled: true };
                    target = filePath;
                } else {
                    const { canceled, filePaths } = await dialog.showOpenDialog(parent, { properties: ['openDirectory', 'createDirectory'] });
                    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
                    target = path.join(filePaths[0], `${base} ${stamp()}`);
                    fs.mkdirSync(target, { recursive: true });
                }

                tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clarity-report-'));
                work = new BrowserWindow({ show: false, useContentSize: true, width: size.w, height: size.h, enableLargerThanScreen: true,
                    webPreferences: { offscreen: true, javascript: true } });
                work.webContents.setFrameRate(30);
                const capture = async (html, out) => {
                    const file = path.join(tmp, 'frame.html');
                    fs.writeFileSync(file, html);
                    await loadAndSettle(work, file);
                    let image = await work.webContents.capturePage();
                    const got = image.getSize();
                    if (got.width !== size.w || got.height !== size.h) image = image.resize({ width: size.w, height: size.h, quality: 'best' });
                    fs.writeFileSync(out, image.toPNG());
                };

                if (poster) {
                    await capture(render(report, prefs, { layout: 'poster', inline: true }), target);
                    return { ok: true, path: target };
                }
                const names = (loadStrings(prefs.lang || 'en') || {}).report?.r || {};
                const written = [];
                for (let i = 0; i < picked.length; i++) {
                    const out = path.join(target, `${String(i + 1).padStart(2, '0')} ${safeName(names[picked[i]] || picked[i])}.png`);
                    await capture(render(report, { ...prefs, sections: picked }, { layout: 'cards', inline: true, only: i }), out);
                    written.push(out);
                }
                return { ok: true, path: target, count: written.length };
            }
            return { ok: false, error: `Unknown format "${format}".` };
        } catch (e) {
            return { ok: false, error: e.message };
        } finally {
            try { if (work && !work.isDestroyed()) work.destroy(); } catch {}
            try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
        }
    });
}

module.exports = { registerReportIpc, SIZES };
