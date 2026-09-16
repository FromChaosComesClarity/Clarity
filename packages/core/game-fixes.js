// ── Fixes for individual games ───────────────────────────────────────────────
// Most games that misbehave under Proton are fixed by something general: a shipped wrapper
// DLL that Wine was shadowing, a working directory, a missing runtime. Those belong in the
// engine, and they are there.
//
// This file is for the rest, the ones where the fix is knowledge about one specific game
// and nothing else will do. Every entry here was found the hard way, on a real machine,
// and the point of writing it down is that the next person never has to.
//
// A fix is one of three things, and an entry may carry any of them:
//   • env    , variables the game needs at launch. Applied every time it starts.
//   • settings, keys in the game's own configuration file. Written once, then left
//                alone: these are the user's files, and someone who changes a value back
//                meant to. Only keys we know are wrong get touched, never the whole file.
//   • wrapperExceptions, DLLs this game ships that must stay shadowed by the runtime's
//                own. The engine normally hands a game the wrapper it shipped with, which
//                is right nearly every time; a game listed here is one where that wrapper
//                cannot survive the runtime, so the exception has to be named.
//
// ⚠️ Nothing here fires on a guess. Each entry matches on the executable's own name, so a
// fix cannot land on a game that merely shares a folder or a title.
'use strict';

const fs = require('fs');
const path = require('path');

const FIXES = [
    {
        id: 'outrun2006',
        title: 'OutRun 2006: Coast 2 Coast',
        exe: 'or2006c2c.exe',
        // What the player sees when this is wrong, so a bug report can be matched to it.
        symptom: 'Starts to a white screen and appears to hang on the SEGA logo.',
        why:
            "The game's intro is a sequence of Bink logo videos, and under Proton it can sit " +
            "on the white SEGA frame for a minute or more before the menu appears, long " +
            "enough that everyone kills it first. OutRun2006Tweaks can skip the sequence " +
            "outright, which removes the wait and the thing that stalls in it. Its own " +
            "SingleCoreAffinity option is left alone: it is that mod's remedy for launch " +
            "freezes on multi-core machines and costs only load time.",
        // The mod is an ASI loader named dinput8.dll, which Wine shadows with its builtin
        // unless told otherwise. The engine's wrapper list covers this for every game; it is
        // named here too so the fix stands on its own if that list ever changes.
        env: { WINEDLLOVERRIDES: 'dinput8=n,b' },
        settings: [
            { file: 'OutRun2006Tweaks.ini', key: 'SkipIntroLogos', value: 'true', was: 'false' },
        ],
    },
    {
        id: 'biohazard2',
        title: 'Biohazard 2 / Resident Evil 2 (Classic REbirth)',
        exe: null,                       // matched by its patch DLL rather than an exe name
        requiresFile: 'ddraw.dll',
        symptom: 'Runs untranslated and stops at a Japanese error box, or crashes at once.',
        why:
            "Classic REbirth is a ddraw.dll wrapper sitting beside the game. Wine loads its " +
            "own builtin ddraw first, so the patch never runs. The override has to be n,b " +
            "rather than a bare n, the wrapper forwards what it does not implement to the " +
            "builtin, and with nothing behind it the game dies on a null pointer at 0x0.",
        // Handled generally by the engine's shipped-wrapper detection; recorded here so the
        // game appears in the list of what the suite knows how to fix.
        env: {},
        settings: [],
        handledBy: 'shipped-wrapper detection',
    },
    {
        id: 'arcanum',
        title: 'Arcanum: Of Steamworks and Magick Obscura (GOG)',
        exe: 'arcanum.exe',
        symptom: 'Closes the instant it is launched. No window, no error.',
        why:
            "GOG's build ships DDrawCompat as ddraw.dll, a wrapper that fixes this 2001 game " +
            "on modern Windows by hooking DirectDraw's own internals. The engine hands a game " +
            "the wrapper it shipped with, which is the right call for Classic REbirth and for " +
            "Quake's 3dfx driver, but DDrawCompat cannot survive those hooks under Wine and " +
            "takes the game down before a window appears. Wine's own ddraw runs Arcanum " +
            "properly, so this is the one game so far that has to keep it. Measured on this " +
            "machine, same prefix, same Proton build: with the shipped wrapper the game never " +
            "produced a window in 26 seconds; with Wine's builtin it ran with a visible " +
            "window for 22 of those 26. DDrawCompat.ini is left on disk untouched, so the " +
            "file is still there for anyone who wants it back on Windows.",
        wrapperExceptions: ['ddraw.dll'],
        // Named as well as excepted: the exception decides what the engine does not force,
        // and this says out loud which library the game is meant to run on.
        env: { WINEDLLOVERRIDES: 'ddraw=b' },
        settings: [],
    },
];

// Everything the suite knows how to fix, for the Control Panel and the manual.
function listFixes() {
    return FIXES.map(f => ({
        id: f.id, title: f.title, symptom: f.symptom, why: f.why,
        handledBy: f.handledBy || 'per-game fix',
        wrapperExceptions: f.wrapperExceptions || [],
    }));
}

// Matched on the executable's own filename and nothing else. An entry without one, a game
// the engine already handles generally, recorded here so it shows up in the list, never
// matches, because a fix that fires on a shared filename like ddraw.dll would land on half
// the library.
function fixFor(resolvedExe) {
    if (!resolvedExe) return null;
    const exeName = path.basename(resolvedExe).toLowerCase();
    return FIXES.find(f => f.exe && exeName === f.exe) || null;
}

// Variables to merge into the launch environment. Empty for a game with no fix, which is
// almost all of them.
function envFor(resolvedExe, installPath) {
    const fix = fixFor(resolvedExe, installPath);
    return fix && fix.env ? { ...fix.env } : {};
}

// Write the settings a game needs, once. Returns what changed so the caller can say so.
//
// ⚠️ Only rewrites a key that still holds the exact value known to be wrong. A player who
// has set it to something else, or the mod author who changes the default, is left alone,
// and a second call after the first does nothing.
function applySettings(resolvedExe, installPath) {
    const fix = fixFor(resolvedExe, installPath);
    if (!fix || !fix.settings || !fix.settings.length) return { applied: [], fix: fix ? fix.id : null };

    const dir = (resolvedExe && path.dirname(resolvedExe)) || installPath;
    const applied = [];
    for (const s of fix.settings) {
        const file = path.join(dir, s.file);
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }

        const wrong = new RegExp(`^(\\s*${s.key}\\s*=\\s*)${s.was}\\s*$`, 'mi');
        if (!wrong.test(text)) continue;                     // already right, or deliberately different
        try {
            fs.writeFileSync(file, text.replace(wrong, `$1${s.value}`), 'utf8');
            applied.push(`${s.file}: ${s.key} = ${s.value}`);
        } catch {}
    }
    return { applied, fix: fix.id };
}

// Shipped wrapper DLLs this game must NOT be handed, lowercased. The engine asks before it
// decides to override anything, so a game with no entry keeps the normal behaviour.
function wrapperExceptions(resolvedExe, installPath) {
    const fix = fixFor(resolvedExe, installPath);
    return new Set((fix && fix.wrapperExceptions ? fix.wrapperExceptions : []).map(n => n.toLowerCase()));
}

module.exports = { listFixes, fixFor, envFor, applySettings, wrapperExceptions, FIXES };
