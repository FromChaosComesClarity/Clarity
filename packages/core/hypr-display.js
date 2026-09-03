'use strict';
/*
 * @clarity/core — "which screen games open on", for Hyprland.
 *
 * The same feature as kwin-display.js and deliberately the same interface, so the
 * Control Panel card that already exists starts working here without a line of UI
 * changing: configure / isSupported / listDisplays / currentDisplay / setGameDisplay
 * / apply. linux.js picks whichever of the two reports isSupported().
 *
 * ⚠️ Why this is a window RULE rather than anything inside the game: umu gives every
 * non-Steam Proton title the same window class (`steam_app_0`), and a game cannot be
 * told where to open by the launcher that starts it. The compositor is the only place
 * that knows. Same conclusion kwin-display.js reached on KWin, for the same reason.
 *
 * ⚠️ Why `hyprctl eval` and not `hyprctl keyword`: on Omarchy 4 (Hyprland 0.56 with
 * Omarchy's Lua config) the keyword form does not work at all. It answers
 *   "keyword can't work with non-legacy parsers. Use eval."
 * on STDOUT, with exit status 0 — so a naive success check counts the refusal as a
 * success. Phase 1 hit exactly this with the float rules. Both forms are tried and
 * both are checked for a literal `ok`, so a plain Arch + Hyprland box (legacy parser,
 * no Lua helper) still works through the keyword path.
 *
 * ⚠️ Nothing is written to the user's Hyprland config. Rules set at runtime are
 * session-scoped, which is why the stored choice is re-applied on every app start —
 * the same restraint, and the same consequence, as the KWin script.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Games launched through umu/Proton all arrive as steam_app_*; the rest are the native
// engines the custom installers set up. Kept in step with omarchy.js's GAME_CLASS_RE.
const GAME_CLASS_RE = '^(steam_app_.*|dosbox.*|scummvm|openbor|gzdoom|uzdoom|ironwail|vkquake|quake.*|raze|buildgdx|ecwolf|cannonball)$';

let _configDir = path.join(os.homedir(), 'GameManagerConfig');

function configure(dir) { if (dir) _configDir = dir; }
const choiceFile = () => path.join(_configDir, 'game-display-hypr.json');

function which(bin) {
    const r = spawnSync('which', [bin], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
}
function hyprctl(args) {
    const bin = which('hyprctl');
    if (!bin) return null;
    const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    return r.status === 0 ? String(r.stdout || '') : null;
}
function hyprctlJson(args) {
    const out = hyprctl(['-j', ...args]);
    if (!out) return null;
    try { return JSON.parse(out); } catch { return null; }
}

function isSupported() {
    if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return false;
    return !!which('hyprctl');
}

// ⚠️ A rotated monitor reports its UNrotated width/height with a transform flag, so the
// label has to swap them — otherwise Jose's portrait 1440x900 panel is described as
// landscape and is the hardest one to pick out of a list. Odd transforms are the 90°
// and 270° rotations.
function listDisplays() {
    const list = hyprctlJson(['monitors']);
    if (!Array.isArray(list)) return [];
    return list
        .filter(m => m && m.name && !m.disabled)
        .map((m, i) => {
            const rotated = [1, 3, 5, 7].includes(Number(m.transform) || 0);
            const w = rotated ? Number(m.height) : Number(m.width);
            const h = rotated ? Number(m.width) : Number(m.height);
            return {
                index: i,
                name: String(m.name),
                mode: w && h ? `${w}x${h}` : '',
                hz: m.refreshRate ? Math.round(Number(m.refreshRate)) : null,
                type: String(m.description || '').split(' ')[0] || '',
                x: m.x ?? null, y: m.y ?? null,
                // Hyprland has no "primary"; the focused monitor is the closest analogue
                // and is what a user reading the list will recognise as their main screen.
                primary: !!m.focused,
            };
        });
}

function readChoice() {
    try { return JSON.parse(fs.readFileSync(choiceFile(), 'utf8')); } catch { return null; }
}

// Resolved by NAME, never by the stored index: unplugging a monitor renumbers the list,
// and a stale index would silently point at a different screen. Same rule as KWin's.
function currentDisplay() {
    const choice = readChoice();
    if (!choice || !choice.name) return null;
    const found = listDisplays().find(d => d.name === choice.name);
    return found ? found.index : null;
}

/*
 * ⚠️ The compositor rule is only half the answer, and the smaller half.
 *
 * Hyprland's XWayland starts with NO primary output — measured: `xrandr --query` prints no
 * `primary` on a stock Omarchy 4 desk. An X11 game (which on Proton is nearly all of them)
 * then asks RandR which screen to use and takes the first one listed, which is the output
 * nearest the origin of the X screen — on a desk where a small panel sits left of the main
 * monitor, that is the small panel. The game sizes itself to it and keeps that size, so
 * sending the window fullscreen afterwards only scales a small picture up.
 *
 * Setting the primary costs one xrandr call, is session-scoped exactly like the window rules,
 * and points at the screen the user has already said their games should open on — so it
 * makes X agree with a choice they made rather than making a new one for them. Nothing is
 * touched when no choice is set.
 *
 * ⚠️ Best-effort and verified by reading it back: a name that XWayland does not know is
 * skipped rather than guessed at, and the whole thing is skipped when there is no X server
 * to talk to (a pure-Wayland session, where the problem does not exist either).
 */
function xwaylandOutputs() {
    if (!process.env.DISPLAY || !which('xrandr')) return null;
    const r = spawnSync('xrandr', ['--query'], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    const out = [];
    for (const line of String(r.stdout || '').split('\n')) {
        const m = line.match(/^(\S+) connected( primary)?/);
        if (m) out.push({ name: m[1], primary: !!m[2] });
    }
    return out;
}

function setXwaylandPrimary(name) {
    const outputs = xwaylandOutputs();
    if (!outputs) return { ok: false, reason: 'no X server' };
    const target = outputs.find(o => o.name === name);
    if (!target) return { ok: false, reason: `XWayland does not know a monitor called ${name}` };
    if (target.primary) return { ok: true, already: true };
    spawnSync('xrandr', ['--output', name, '--primary'], { encoding: 'utf8' });
    // Read it back rather than trusting the exit status: xrandr against XWayland warns on
    // stderr and still exits 0 for things it did not do.
    const after = xwaylandOutputs();
    const ok = !!after?.find(o => o.name === name && o.primary);
    return { ok, reason: ok ? '' : 'xrandr accepted the call but the primary did not change' };
}

// Sends every window matching the game classes to one monitor, and tells X11 games that the
// same monitor is the primary one. `apply()` is also called at startup, so both survive the
// logout that clears session rules.
function apply() {
    if (!isSupported()) return { ok: false, applied: 0 };
    const choice = readChoice();
    if (!choice || !choice.name) return { ok: true, applied: 0 };   // "Default" — nothing to set
    const name = choice.name;
    const lua = `o.window({ class = "${GAME_CLASS_RE}" }, { monitor = "${name}" })`;
    let out = hyprctl(['eval', lua]);
    if (!out || !/^ok\b/i.test(out.trim())) {
        out = hyprctl(['keyword', 'windowrulev2', `monitor ${name}, class:${GAME_CLASS_RE}`]);
    }
    const ok = !!(out && /^ok\b/i.test(out.trim()));
    const xPrimary = setXwaylandPrimary(name);
    // ⚠️ `display` is the display OBJECT, not its name — kwin-display.js returns the
    // object and the Control Panel reads `res.display.name`. Returning a bare string
    // here would have printed "undefined" on Hyprland and nowhere else.
    const obj = listDisplays().find(d => d.name === name) || { name };
    return { ok, applied: ok ? 1 : 0, display: obj, xPrimary };
}

function setGameDisplay(index) {
    if (!isSupported()) return { ok: false, error: 'This needs a running Hyprland session with hyprctl.' };

    if (index === null || index === undefined || index < 0) {
        try { fs.rmSync(choiceFile(), { force: true }); } catch {}
        // ⚠️ A Hyprland rule cannot be withdrawn once set for a session. Clearing the
        // choice stops it being re-applied on the next start, and the UI says so rather
        // than pretending the current session changed.
        return { ok: true, display: null, needsRestart: true };
    }

    const target = listDisplays().find(d => d.index === index);
    if (!target) return { ok: false, error: 'That screen is no longer connected.' };

    try {
        fs.mkdirSync(_configDir, { recursive: true });
        fs.writeFileSync(choiceFile(), JSON.stringify({ name: target.name }), 'utf8');
    } catch (e) {
        return { ok: false, error: `Could not save the choice: ${e.message}` };
    }
    const r = apply();
    return { ok: true, display: target, applied: r.applied, xPrimary: r.xPrimary };
}

module.exports = { configure, isSupported, listDisplays, currentDisplay, setGameDisplay, apply, xwaylandOutputs, setXwaylandPrimary, GAME_CLASS_RE };
