// ── Omarchy theme bridge ─────────────────────────────────────────────────────
// Omarchy has a first-class theme system: one directory per theme, and a `colors.toml`
// inside it declaring the palette in named roles — background, foreground, accent, and the
// usual ANSI set. Every app on the system is themed from that one file.
//
// The suite's own themes are the same shape (bg / accent / text / border), which means the
// right integration is not "pick whichever of our 93 themes looks closest" — it is to build
// a theme from the user's actual palette, so Clarity matches their desktop exactly
// and keeps matching when they switch. That is what toCafeTheme() does.
//
// The key simplification: `~/.local/state/omarchy/current/theme` is the *materialised*
// current theme — Omarchy copies the resolved theme there whichever of the stock or user
// directories it came from. Reading that one path means never having to resolve a display
// name ("Thegreek") against a slug ("thegreek"), or stock against user overlay. It also
// means a theme with no colors.toml simply reports unavailable rather than half-working.
//
// Node builtins only — this file is meant to be copied into EmuLatte unchanged.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_DIR = path.join(os.homedir(), '.local', 'state', 'omarchy', 'current');
const THEME_DIR = path.join(STATE_DIR, 'theme');
const NAME_FILE = path.join(STATE_DIR, 'theme.name');
const COLORS     = path.join(THEME_DIR, 'colors.toml');

function currentThemeName() {
    try { return fs.readFileSync(NAME_FILE, 'utf8').trim(); } catch {}
    // Older layouts had no theme.name; the directory's own name is the next best answer.
    try { return path.basename(fs.realpathSync(THEME_DIR)); } catch {}
    return '';
}

function hasTheme() { try { return fs.statSync(COLORS).isFile(); } catch { return false; } }

// A deliberately small TOML reader. colors.toml is flat `key = "value"` with `#` comments
// and no tables, arrays or multi-line strings — a real TOML parser would be a dependency
// bought for nothing. Anything it does not understand is skipped rather than guessed at,
// so a future file with structure in it degrades to "missing keys" instead of wrong ones.
function parseFlatToml(text) {
    const out = {};
    for (const raw of String(text).split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('[')) continue;
        const eq = line.indexOf('=');
        if (eq < 1) continue;
        const key = line.slice(0, eq).trim();
        if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
        let val = line.slice(eq + 1).trim();
        const hash = val.indexOf(' #');
        if (hash > -1 && !val.startsWith('"')) val = val.slice(0, hash).trim();
        val = val.replace(/^["'](.*)["']$/, '$1').trim();
        out[key] = val;
    }
    return out;
}

function readColors() {
    if (!hasTheme()) return null;
    try { return parseFlatToml(fs.readFileSync(COLORS, 'utf8')); } catch { return null; }
}

// ── Colour helpers ───────────────────────────────────────────────────────────
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function normHex(v) {
    if (typeof v !== 'string') return '';
    const m = String(v).trim().match(HEX);
    if (!m) return '';
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length === 8) h = h.slice(0, 6);          // drop alpha; we apply our own
    return '#' + h.toLowerCase();
}

function rgb(hex) {
    const h = normHex(hex);
    if (!h) return null;
    return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

function rgba(hex, alpha) {
    const c = rgb(hex);
    if (!c) return '';
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

// Perceived brightness, 0–255. Used only to decide light vs dark when the theme does not
// say — `mode` is authoritative when present.
function luma(hex) {
    const c = rgb(hex);
    if (!c) return 0;
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

// First key that resolves to a real colour, or '' if none of them are declared.
function pick(colors, ...keys) {
    for (const k of keys) {
        const h = normHex(colors[k]);
        if (h) return h;
    }
    return '';
}

// Linear blend, t=0 → a, t=1 → b.
function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    if (!x || !y) return normHex(a) || normHex(b) || '';
    const f = n => Math.round(x[n] + (y[n] - x[n]) * t);
    return '#' + [f('r'), f('g'), f('b')].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

// ── The mapping ──────────────────────────────────────────────────────────────
// Clarity's theme shape, filled from Omarchy's roles. The roles line up almost
// exactly, which is why this is a mapping and not an approximation:
//
//   bg          ← background            the window behind everything
//   bg_menu     ← dark_background       menus and bars, a step deeper than the page
//   bg_panel    ← lighter_background    translucent panels over artwork
//   accent      ← accent                the theme's own accent, unchanged
//   text_main   ← bright_foreground     primary text
//   text_sec    ← foreground            secondary text
//   text_dim    ← dark_foreground       disabled/among-others text
//   border      ← accent @ low alpha    hairlines that should read as the accent
//   border_solid← muted / selection     opaque dividers
//
// ⚠️ Light themes exist (catppuccin-latte, flexoki-light). The role names still mean the
// same thing there — `background` is light and `foreground` is dark — so the mapping holds
// without inverting anything. What does change is *direction*: "a step deeper than the page"
// is darker on a dark theme and also darker on a light one, but by a much smaller amount,
// because a light UI separates its layers with far less contrast than a dark one does.
//
// ⚠️ **Only three roles are guaranteed.** Measured across all 46 themes shipped and
// installed on a real Omarchy 4 box: `accent`, `background` and `foreground` appear in all
// 37 that have a colors.toml at all, while the richer roles (dark_background, muted,
// bright_foreground, …) appear in only 23–24, and `mode` in 24. Falling back to a preference
// chain therefore collapses roles into each other — on a minimal theme every text tier
// resolved to the same colour and menus became invisible against the page. So a declared
// role is always preferred, and anything absent is *derived* from the three that are not.
function toCafeTheme(colors = readColors()) {
    if (!colors) return null;

    const bg = pick(colors, 'background', 'dark_background', 'darker_background');
    const fg = pick(colors, 'foreground', 'bright_foreground', 'light_foreground');
    if (!bg || !fg) return null;                // without these two there is no theme

    const declared = String(colors.mode || '').toLowerCase();
    const isLight = (declared === 'light' || declared === 'dark') ? declared === 'light' : luma(bg) > 128;
    const accent = pick(colors, 'accent', 'blue', 'bright_blue', 'cyan') || fg;

    // Layers. On a dark theme the menu sits distinctly deeper than the page; on a light one
    // the same separation would look like a hole, so it is a fraction of the distance.
    // ⚠️ A declared role is preferred but not trusted blindly: some themes set
    // dark_background to the same value as background (tokyoled does), which would make
    // menus vanish into the page. A role that carries no information is treated as absent.
    //
    // ⚠️ And "deeper" is not always available. tokyoled's background is pure #000000, so
    // darkening it returns black again and the menu disappears anyway. Derive toward
    // whichever end actually has room: away from black when the page is already black.
    const deeper = isLight ? 0.07 : 0.45;
    const bgLuma = luma(bg);
    const towardEdge = bgLuma < 12 ? '#ffffff' : bgLuma > 243 ? '#000000' : '#000000';
    const step = bgLuma < 12 ? 0.14 : deeper;
    const declaredMenu = pick(colors, 'dark_background', 'darker_background');
    const menu = (declaredMenu && declaredMenu !== bg) ? declaredMenu : mix(bg, towardEdge, step);
    // The panel floats *over* artwork, so it wants to be a lift on dark and a settle on
    // light — either way it is translucent, and the alpha is what makes it read as glass.
    // ⚠️ A declared surface role is preferred but never trusted blindly — the same lesson as
    // tokyoled's dark_background, one step further. `selection` is the sharp case: it is the
    // text-selection highlight, so it is a proper dark surface in some themes (city-783 uses
    // #2b2f37) and pure white in others (Crimson). Taken on faith it produced a floating panel
    // of rgba(255,255,255,0.62) over a #1a1621 page — near-white rows carrying light-grey
    // secondary text, which is unreadable, and pure-white borders to match.
    //
    // So the role is kept in the chain and *validated* instead of dropped: a candidate surface
    // has to sit on the correct side of the page and stay near it. One that would invert the
    // layer relationship is treated as absent, and the value is derived. Dropping `selection`
    // outright was worse — it cost city-783 its declared surface and pushed contrast down.
    const surfaceOk = (hex) => {
        if (!hex) return false;
        const d = luma(hex) - bgLuma;
        return isLight ? (d <= 24 && d > -70) : (d >= -24 && d < 70);
    };
    const panelPick = ['lighter_background', 'selection', 'muted'].map(k => pick(colors, k)).find(surfaceOk);
    const panel  = panelPick
        || mix(bg, isLight ? '#000000' : '#ffffff', isLight ? 0.06 : 0.10);

    // Text tiers, each a measured step from full foreground toward the background.
    const main = pick(colors, 'bright_foreground', 'light_foreground') || fg;
    const sec  = pick(colors, 'foreground') !== main ? pick(colors, 'foreground') || mix(main, bg, 0.28)
                                                    : mix(main, bg, 0.28);
    const dim  = pick(colors, 'dark_foreground', 'muted') || mix(main, bg, 0.55);

    // Borders take the same treatment: a white `selection` here drew pure-white rules
    // across a dark page.
    const solidPick = ['muted', 'selection'].map(k => pick(colors, k)).find(surfaceOk);
    const solid = solidPick || mix(accent, bg, 0.55);

    return {
        bg,
        bg_panel: rgba(panel, isLight ? 0.55 : 0.62),
        bg_menu: menu,
        accent,
        accent_menu: accent,
        text_main: main,
        text_sec: sec,
        text_dim: dim,
        border: rgba(accent, 0.22),
        border_solid: solid,
    };
}

// What the picker shows. The name is Omarchy's own display name so the user recognises it,
// and `mode` lets the UI hint light/dark without re-deriving it.
function describe() {
    const colors = readColors();
    const theme = toCafeTheme(colors);
    if (!theme) return { available: false, name: currentThemeName(), theme: null, mode: '' };
    const declared = String(colors.mode || '').toLowerCase();
    return {
        available: true,
        name: currentThemeName(),
        mode: declared === 'light' || declared === 'dark' ? declared
            : (luma(theme.bg) > 128 ? 'light' : 'dark'),
        theme,
    };
}

function isSupported() { return hasTheme(); }

// ── Following the user's theme ───────────────────────────────────────────────
// Omarchy can install a `theme-set` hook, but writing into the user's system to learn about
// their system is the wrong trade for a game launcher — it survives uninstalling us, and it
// needs a shell script on disk. Watching the state directory costs nothing and needs no
// permission: `omarchy theme set` rewrites theme.name and repopulates theme/, so a watch on
// the directory sees every switch.
//
// ⚠️ The rewrite is not atomic — name and colours land separately, and a naive watcher fires
// two or three times mid-switch and can read a half-written palette. Hence the debounce, and
// hence re-reading everything on each fire rather than trusting the event's filename.
function watch(onChange, { debounceMs = 250 } = {}) {
    if (typeof onChange !== 'function') return () => {};
    let timer = null;
    let last = '';
    let watcher = null;

    const fire = () => {
        timer = null;
        const d = describe();
        const sig = d.available ? d.name + '|' + JSON.stringify(d.theme) : 'unavailable';
        if (sig === last) return;              // a switch back and forth is not a change
        last = sig;
        try { onChange(d); } catch {}
    };

    try {
        watcher = fs.watch(STATE_DIR, { persistent: false }, () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(fire, debounceMs);
        });
        watcher.on('error', () => {});         // the directory can vanish; that is not fatal
    } catch { return () => {}; }

    last = (() => { const d = describe(); return d.available ? d.name + '|' + JSON.stringify(d.theme) : 'unavailable'; })();
    return () => {
        if (timer) clearTimeout(timer);
        try { watcher && watcher.close(); } catch {}
    };
}

module.exports = {
    STATE_DIR, THEME_DIR, COLORS,
    currentThemeName, hasTheme, readColors, parseFlatToml,
    toCafeTheme, describe, isSupported, watch,
    normHex, rgba, luma,
};
