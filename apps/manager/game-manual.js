// Per-game manual viewer, ported from EmuLatte. Loaded via loadFile('game-manual.html',
// { query }) so it carries the file path, the game's identity, and the desktop's theme
// colours in the query string.
//
// The one real departure from EmuLatte: there is no Keep/Delete. EmuLatte downloads its
// manuals and so owns them; here the file is the user's own, so the destructive-sounding
// action only unlinks it from the game and never touches the disk.

const params = new URLSearchParams(location.search);
const file   = params.get('file')  || '';
const title  = params.get('title') || 'Manual';
const store  = params.get('store') || '';
const logo   = params.get('logo')  || '';
const gameId = Number(params.get('gameId') || 0);

// Match the desktop's active theme, including its interface font.
try {
    const theme = JSON.parse(params.get('theme') || '{}');
    const root = document.documentElement;
    Object.keys(theme).forEach(k => root.style.setProperty('--' + k, theme[k]));
    if (theme.bg) document.body.style.background = 'var(--bg)';
} catch {}
const font = params.get('font') || '';
if (font) document.documentElement.style.setProperty('--ui-font', `'${font}'`);

// Identity: prefer the game's logo art, fall back to its title.
document.title = 'Manual, ' + title;
const titleEl = document.getElementById('m-title');
const logoEl  = document.getElementById('m-logo');
titleEl.textContent = title;
if (logo) {
    logoEl.onload  = () => { logoEl.style.display = 'block'; titleEl.style.display = 'none'; };
    logoEl.onerror = () => { logoEl.style.display = 'none';  titleEl.style.display = 'block'; };
    logoEl.src = logo;
}
if (store) {
    const badge = document.getElementById('m-store');
    badge.textContent = store;
    badge.style.display = 'inline-block';
}

// Chromium's built-in viewer handles the PDF, page nav, zoom, search and thumbnails
// all come free. The hash options are ignored harmlessly by non-PDF documents.
function show(path) {
    document.getElementById('m-doc').src =
        'file://' + encodeURI(path).replace(/#/g, '%23') + '#toolbar=1&navpanes=0&view=FitH';
}
show(file);

document.getElementById('m-open').onclick  = () => window.api.openManualExternally(file);
document.getElementById('m-min').onclick   = () => window.api.manualWindowMinimize();
document.getElementById('m-close').onclick = () => window.api.manualWindowClose();
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.api.manualWindowClose();
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W')) window.api.manualWindowClose();
});
