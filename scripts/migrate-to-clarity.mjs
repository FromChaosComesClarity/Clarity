#!/usr/bin/env node
/*
 * One-shot local migration: Cafe Neurotico → Clarity.
 *
 * The rebrand changed three things that live OUTSIDE the repo and therefore cannot be
 * fixed by a commit: the Electron userData directories (which Electron derives from
 * app.setName), the on-disk library locations, and the absolute paths recorded inside
 * both databases. Renaming the code without moving these leaves the app pointing at
 * nothing, an empty library beside 335 GB of games it can no longer see.
 *
 * ⚠️ Run this BEFORE the first launch of a Clarity build. Between the code change and
 * this script the two halves disagree, and launching in that window makes the app create
 * fresh empty databases at the new paths, which is then a merge problem rather than a move.
 *
 * Dry run by default, prints every action and changes nothing. Pass --apply to execute.
 * Idempotent: every step checks its own target first, so a half-finished run resumes cleanly.
 */
import { execFileSync } from 'node:child_process';
import fs   from 'node:fs';
import os   from 'node:os';
import path from 'node:path';

const HOME  = os.homedir();
const APPLY = process.argv.includes('--apply');
const H     = p => p.replace(HOME, '~');

let done = 0, skipped = 0, problems = 0;
const act  = m => { console.log(`  ${APPLY ? '✓' : '·'} ${m}`); done++; };
const skip = m => { console.log(`  ─ ${m}`); skipped++; };
const warn = m => { console.log(`  ⚠ ${m}`); problems++; };

// ── Filesystem ───────────────────────────────────────────────────────────────
// Same-filesystem renames are instant regardless of size; a cross-device move would
// copy 335 GB, so it is reported rather than attempted silently.
function move(from, to) {
    if (!fs.existsSync(from)) {
        return fs.existsSync(to) ? skip(`${H(to)} already in place`) : skip(`${H(from)} not present`);
    }
    if (fs.existsSync(to)) return warn(`BOTH exist: ${H(from)} and ${H(to)}, merge by hand`);
    const sameFs = fs.statSync(path.dirname(from)).dev === fs.statSync(path.dirname(to)).dev;
    act(`${H(from)} → ${H(to)}${sameFs ? '' : '  (CROSS-DEVICE: will copy, not rename)'}`);
    if (!APPLY) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
}

function remove(target, why) {
    if (!fs.existsSync(target)) return skip(`${H(target)} already gone`);
    if (fs.statSync(target).isDirectory() && fs.readdirSync(target).length) {
        return warn(`${H(target)} is not empty, left alone`);
    }
    act(`remove ${H(target)} (${why})`);
    if (APPLY) fs.rmSync(target, { recursive: true, force: true });
}

// ── SQLite ───────────────────────────────────────────────────────────────────
const sql = (db, stmt) => execFileSync('sqlite3', [db, stmt], { encoding: 'utf8' }).trim();

function backup(db) {
    const dest = `${db}.pre-clarity-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
    if (fs.existsSync(dest)) return skip(`backup exists: ${H(dest)}`);
    act(`backup ${H(db)} → ${H(dest)}`);
    if (APPLY) sql(db, `VACUUM INTO '${dest.replace(/'/g, "''")}'`);
}

function rewrite(db, table, column, from, to) {
    const n = Number(sql(db, `SELECT count(*) FROM ${table} WHERE ${column} LIKE '%${from}%';`));
    if (!n) return skip(`${table}.${column}: no rows contain "${from}"`);
    act(`${table}.${column}: ${n} rows  "${from}" → "${to}"`);
    if (APPLY) sql(db, `UPDATE ${table} SET ${column} = REPLACE(${column}, '${from}', '${to}') WHERE ${column} LIKE '%${from}%';`);
}

// Settings are stored as key/value rows, so a renamed key orphans its value silently:
// the app reads the new name, finds nothing, and falls back to a default. Nothing errors,
// which is exactly why this is easy to miss.
function renameSettingKey(db, from, to) {
    const has = k => Number(sql(db, `SELECT count(*) FROM settings WHERE key='${k}';`));
    if (has(to))   return skip(`settings: '${to}' already present`);
    if (!has(from)) return skip(`settings: '${from}' not set`);
    act(`settings: '${from}' → '${to}'`);
    if (APPLY) sql(db, `UPDATE settings SET key='${to}' WHERE key='${from}';`);
}

function renameColumn(db, table, from, to) {
    const cols = sql(db, `SELECT group_concat(name) FROM pragma_table_info('${table}');`).split(',');
    if (cols.includes(to))   return skip(`${table}.${to} already renamed`);
    if (!cols.includes(from)) return warn(`${table}.${from} not found, cannot rename`);
    act(`${table}: rename column ${from} → ${to}`);
    if (APPLY) sql(db, `ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to};`);
}

// ── Paths ────────────────────────────────────────────────────────────────────
// Electron derives userData from app.setName, but the ROOT differs per platform:
// ~/.config on Linux, ~/Library/Application Support on macOS. The library and app
// directories are the user's own choice and are laid out the same way on both.
const MAC     = process.platform === 'darwin';
const cfg     = name => MAC ? path.join(HOME, 'Library', 'Application Support', name)
                            : path.join(HOME, '.config', name);
const OLD = {
    manager: cfg('cafeneurotico'),
    engine:  cfg('grinder'),
    couch:   cfg('crema'),
    games:   path.join(HOME, 'Games', 'CafeNeurotico'),
    appDir:  MAC ? path.join(HOME, 'Library', 'Application Support', 'CafeNeurotico')
                 : path.join(HOME, 'Games', 'CNGM'),
    stray:   path.join(HOME, 'CafeNeurotico'),
};
const NEW = {
    manager: cfg('clarity'),
    engine:  cfg('clarity-installer'),
    couch:   cfg('clarity-couch'),
    games:   path.join(HOME, 'Games', 'Clarity'),
    appDir:  MAC ? path.join(HOME, 'Library', 'Application Support', 'Clarity')
                 : path.join(HOME, 'Clarity'),
};

console.log(`\n  Cafe Neurotico → Clarity migration  [${APPLY ? 'APPLYING' : 'DRY RUN, pass --apply to execute'}]  ${MAC ? 'macOS' : 'Linux'}\n`);

// Refuse to run against a live process: moving a userData dir out from under a running
// Electron app corrupts its Local Storage and leaves a stale singleton lock.
let running = [];
try {
    // Anchored to an executable path, because a bare word match also hits any shell whose
    // command line merely mentions the AppImage, including the one running this script.
    running = execFileSync('pgrep', ['-af', '(^|/)(electron|Clarity\\.AppImage|CafeNeurotico\\.AppImage)'], { encoding: 'utf8' })
        .trim().split('\n').filter(Boolean)
        .filter(l => ![process.pid, process.ppid].includes(Number(l.split(/\s+/)[0])))
        .filter(l => !l.includes('migrate-to-clarity'));
} catch { /* pgrep exits 1 when nothing matches. That is the good case */ }
if (running.length) {
    console.log('  ✗ ABORT, the app appears to be running:\n' + running.map(l => '      ' + l).join('\n') + '\n\n  Close it and re-run.\n');
    process.exit(1);
}

console.log('▸ Electron userData directories');
move(OLD.manager, NEW.manager);
move(OLD.engine,  NEW.engine);
move(OLD.couch,   NEW.couch);

console.log('\n▸ Library and application directories');
move(OLD.games,  NEW.games);
move(OLD.appDir, NEW.appDir);
remove(OLD.stray, 'empty leftover deploy dir');

// After the moves above, everything lives at its NEW path. During a dry run nothing has
// actually moved, so each later step must inspect wherever the data still is, otherwise
// the preview reports "not present" for every file and shows none of the database work,
// which is the one thing a preview exists to show.
const live = (newP, oldP) => (fs.existsSync(newP) || !fs.existsSync(oldP)) ? newP : oldP;
const appDir = live(NEW.appDir, OLD.appDir);
const engine = live(NEW.engine, OLD.engine);

console.log('\n▸ Files inside the application directory');
const gmc = path.join(appDir, 'GameManagerConfig');
move(path.join(appDir, 'CREMA_CUSTOM_MUSIC'),        path.join(appDir, 'CUSTOM_MUSIC'));
move(path.join(appDir, 'CafeNeurotico.AppImage'),     path.join(appDir, 'Clarity.AppImage'));
move(path.join(appDir, 'CafeNeurotico_old.AppImage'), path.join(appDir, 'Clarity_old.AppImage'));
move(path.join(gmc, 'grinder-progress.json'),             path.join(gmc, 'installer-progress.json'));

// Companion apps keep their own state inside the shared library directory, so they
// move with it, but their *names* are part of the rebrand too.
console.log('\n▸ Companion app data');
move(path.join(gmc, 'CafeNeuroticoClock'), path.join(gmc, 'ClarityClock'));
move(path.join(gmc, 'CREMA_wallpapers'),   path.join(gmc, 'couch_wallpapers'));
const apps = path.join(HOME, 'Apps');
move(path.join(apps, 'CafeNeuroticoClock.AppImage'), path.join(apps, 'ClarityClock.AppImage'));

console.log('\n▸ Installer database (library.db)');
const libDb = path.join(engine, 'library.db');
for (const ext of ['', '-wal', '-shm']) move(path.join(engine, `grinder.db${ext}`), `${libDb}${ext}`);
for (const f of fs.existsSync(engine) ? fs.readdirSync(engine) : []) {
    if (f.startsWith('grinder.db.bak-')) move(path.join(engine, f), path.join(engine, f.replace('grinder.db.bak-', 'library.db.bak-')));
}
const libDbNow = fs.existsSync(libDb) ? libDb : path.join(engine, 'grinder.db');
if (fs.existsSync(libDbNow)) {
    backup(libDbNow);
    rewrite(libDbNow, 'games', 'install_path', '/Games/CafeNeurotico/', '/Games/Clarity/');
} else skip('library.db not found, nothing to rewrite');

console.log('\n▸ Manager database (games.db)');
const gamesDb = path.join(gmc, 'games.db');
if (fs.existsSync(gamesDb)) {
    backup(gamesDb);
    renameColumn(gamesDb, 'games', 'GrinderGameId', 'InstallerGameId');
    // Both old library roots appear: /Games/CNGM/ held the app and its pico-8 carts,
    // /Games/CafeNeurotico/ held the installed games themselves (manuals point there).
    for (const [t, c] of [['games','LaunchCommand'], ['games','LaunchCommands'], ['game_manuals','path'], ['save_backups','path'], ['settings','value']]) {
        rewrite(gamesDb, t, c, 'grinder://',            'installer://');
        rewrite(gamesDb, t, c, '/Games/CNGM/',          '/Clarity/');
        rewrite(gamesDb, t, c, '/Games/CafeNeurotico/', '/Games/Clarity/');
        rewrite(gamesDb, t, c, 'GOG via GRINDER',       'GOG via Installer');
    }
    for (const [a, b] of [
        ['cngm_theme',            'clarity_theme'],
        ['cngm_ui_scale',         'clarity_ui_scale'],
        ['cngm_ui_scale_screen',  'clarity_ui_scale_screen'],
        ['crema_gallery_sort',    'couch_gallery_sort'],
        ['crema_hide_pico8',      'couch_hide_pico8'],
    ]) renameSettingKey(gamesDb, a, b);

    // Verify rather than assume: re-query for any brand token that should now be gone.
    console.log('\n▸ Post-migration check (games.db)');
    if (APPLY) {
        let residue = 0;
        for (const [t, c] of [['games','LaunchCommand'], ['games','LaunchCommands'], ['game_manuals','path'], ['settings','value']]) {
            for (const tok of ['CafeNeurotico', 'CNGM', 'grinder', 'GRINDER', 'crema', 'CREMA']) {
                const n = Number(sql(gamesDb, `SELECT count(*) FROM ${t} WHERE ${c} LIKE '%${tok}%';`));
                if (n) { warn(`${t}.${c} still has ${n} rows containing "${tok}"`); residue += n; }
            }
        }
        if (!residue) console.log('  ✓ no brand tokens remain in rewritten columns');
    } else console.log('  · runs after --apply');
} else warn(`games.db not found at ${H(gamesDb)}`);

console.log('\n▸ Stale desktop entries');
const appsDir = path.join(HOME, '.local', 'share', 'applications');
for (const f of fs.existsSync(appsDir) ? fs.readdirSync(appsDir) : []) {
    if (/^cafe-neurotico.*\.desktop$/.test(f)) {
        act(`remove ${H(path.join(appsDir, f))}, re-create from the app's "Install to menu"`);
        if (APPLY) fs.rmSync(path.join(appsDir, f));
    }
}

console.log(`\n  ${APPLY ? 'Applied' : 'Would apply'}: ${done}   skipped: ${skipped}   needs attention: ${problems}`);
if (!APPLY) console.log('  Re-run with --apply to execute.');
// Files the user created outside the app's own directories are reported, never renamed:
// reaching into ~/Documents to rewrite someone's archive names is not this script's business.
console.log('\n▸ Review by hand (not touched)');
if (fs.existsSync(gamesDb)) {
    const strays = sql(gamesDb, "SELECT path FROM save_backups WHERE path LIKE '%CafeNeurotico%' OR path LIKE '%CNGM%';").split('\n').filter(Boolean);
    if (strays.length) { strays.forEach(s => console.log(`  · save archive keeps its old name: ${H(s)}`)); console.log('    (rename the file AND its save_backups row together, or leave both as they are)'); }
    else console.log('  ─ no stray save archives');
}

// Desktop integration lives outside this project, so it is checked rather than assumed.
console.log('\n▸ Desktop integration');
for (const [file, label] of [
    [path.join(HOME, '.config', 'hypr', 'bindings.lua'), 'Hyprland binding'],
    [path.join(HOME, '.config', 'omarchy', 'shell.json'), 'Omarchy bar'],
]) {
    try {
        const stale = fs.readFileSync(file, 'utf8').includes('cafeneurotico');
        stale ? warn(`${label}: ${H(file)} still names cafeneurotico, point it at io.github.fromchaoscomesclarity.clarity`)
              : console.log(`  ✓ ${label}: ${H(file)} already on the clarity id`);
    } catch { skip(`${label}: ${H(file)} not present`); }
}
const plugDir = path.join(HOME, '.config', 'omarchy', 'plugins');
try {
    const old = fs.readdirSync(plugDir).filter(d => d.includes('cafeneurotico') && !d.includes('.bak.'));
    old.length ? old.forEach(d => warn(`stale plugin still installed: ${H(path.join(plugDir, d))}`))
               : console.log('  ✓ Omarchy plugin: no cafeneurotico plugin directory remains');
} catch {}
console.log('');
