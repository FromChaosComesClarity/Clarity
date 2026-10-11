'use strict';
/*
 * ── What must not outlive Clarity, and how to take it down ───────────────────
 *
 * Electron exiting does not kill what it spawned. Children are reparented to init and
 * carry on with nothing on screen and nobody watching. The comet achievements daemon
 * is the clearest case: it is only reaped when the game it shadows exits, and that
 * handler lives inside Clarity, so if Clarity goes first the daemon is orphaned for
 * good.
 *
 * Three kinds, because they do not deserve the same fate:
 *
 *   helper    Clarity's own machinery. Nobody asked for it and nobody will miss it,
 *             so it is always reaped and never mentioned.
 *   game      Deliberately detached and left alive when Clarity quits, see the note
 *             on spawnGame in installer-engine.js. Only ever touched if the user
 *             explicitly says so.
 *   download  Clarity's own work, but losing it costs real time, so it gets asked
 *             about rather than assumed either way.
 *
 * ⚠️ A game is a tree, not a process. umu-run forks pressure-vessel, which forks
 * Proton, which forks wine, and signalling the wrapper leaves the rest running. That
 * is not theoretical: a leftover Electron from a headless run is what makes the next
 * launch meet the single-instance lock and appear to do nothing at all. So the process
 * *group* is signalled, and whether doing so is safe is read out of /proc rather than
 * taken on trust from the caller.
 *
 * ⚠️ No electron import, deliberately. installer-engine.js runs headless under the
 * Installer's CLI (launch/install/uninstall-headless/setup), where there is no app and
 * no window, and it registers its children here like everything else.
 */

const fs = require('fs');

const KINDS = ['helper', 'game', 'download'];

/* pid → { pid, kind, label }. Keyed by pid so a double-track is harmless. */
const records = new Map();

/*
 * The process group of a live pid, or 0 when it cannot be read.
 *
 * ⚠️ The comm field sits in parentheses and may itself contain spaces and parentheses
 * (wine happily produces things like "(gzdoom (x86))"), so the fields after it are
 * found from the LAST ')' in the line. Splitting the whole line on whitespace is the
 * classic way to read the wrong number here.
 */
function pgidOf(pid) {
    try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const tail = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
        const pgid = Number(tail[2]);          // state, ppid, pgrp
        return Number.isInteger(pgid) && pgid > 0 ? pgid : 0;
    } catch {
        return 0;
    }
}

/*
 * ⚠️ A dead child is not gone: it stays a zombie until its parent waits on it, and these
 * are all our children. `process.kill(pid, 0)` succeeds on a zombie, so using it alone
 * reports a process we have just SIGKILLed as still running, which would both make reap
 * lie about the result and, worse, let a finished game turn up in the "still running"
 * prompt. The state field in /proc settles it: 'Z' means it has already exited.
 *
 * The fallback is for when there is no /proc entry at all. EPERM there means something
 * exists that is not ours to signal, which still counts as alive, because treating it
 * as gone would have us claim a clean shutdown over something still running.
 */
function alive(pid) {
    try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        return stat.slice(stat.lastIndexOf(')') + 1).trim()[0] !== 'Z';
    } catch {
        try { process.kill(pid, 0); return true; }
        catch (e) { return e && e.code === 'EPERM'; }
    }
}

/* Clarity's own group, read once. Never signalled, see signalOne. */
const OWN_PGID = pgidOf(process.pid);

function track(proc, { kind = 'helper', label = '' } = {}) {
    if (!proc || !proc.pid || !KINDS.includes(kind)) return proc;
    const pid = proc.pid;
    records.set(pid, { pid, kind, label: String(label || '') });
    /*
     * Forget it the moment it dies. Without this a long session accumulates dead pids,
     * and worse, the kernel eventually reuses one: a stale record would then point at
     * an unrelated process that we would happily SIGKILL on the way out.
     */
    const forget = () => records.delete(pid);
    try { proc.once('exit', forget); proc.once('error', forget); } catch {}
    return proc;
}

/* Live records of the given kind(s), pruning anything that has since exited. */
function live(kinds) {
    const want = kinds ? [].concat(kinds) : KINDS;
    const out = [];
    for (const rec of [...records.values()]) {
        if (!want.includes(rec.kind)) continue;
        if (!alive(rec.pid)) { records.delete(rec.pid); continue; }
        out.push(rec);
    }
    return out;
}

/*
 * The group form is used only when the child genuinely leads its own group, which is
 * what `detached: true` produces, and never when that group turns out to be Clarity's
 * own. The guard is not paranoia: killing our own group mid-shutdown would take the
 * app down before the remaining steps ran, and with SIGKILL nothing after it happens.
 */
function signalOne(rec, sig) {
    const pgid = pgidOf(rec.pid);
    const asGroup = pgid === rec.pid && pgid !== OWN_PGID;
    try { process.kill(asGroup ? -rec.pid : rec.pid, sig); return true; }
    catch { return false; }
}

/*
 * SIGTERM everything of these kinds, give it a moment, then SIGKILL whatever is left.
 *
 * The grace period is bounded and short because this runs while the user is waiting to
 * see the window disappear. A child that ignores SIGTERM is exactly the leftover this
 * module exists to prevent, so it does not get to veto the shutdown.
 */
async function reap(kinds, { graceMs = 2500, stepMs = 100 } = {}) {
    let targets = live(kinds);
    const terminated = targets.length;
    if (!terminated) return { terminated: 0, killed: 0 };

    for (const rec of targets) signalOne(rec, 'SIGTERM');

    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
        targets = targets.filter(rec => alive(rec.pid));
        if (!targets.length) return { terminated, killed: 0 };
        await new Promise(r => setTimeout(r, stepMs));
    }
    const killed = targets.length;
    for (const rec of targets) signalOne(rec, 'SIGKILL');
    /*
     * Brief confirmation pass so the returned count is something a caller can trust
     * rather than a count of signals posted. SIGKILL cannot be blocked, so this settles
     * almost at once; the ceiling is here only so a wedged pid cannot stall the quit.
     */
    const hard = Date.now() + 300;
    while (Date.now() < hard && targets.some(rec => alive(rec.pid))) {
        await new Promise(r => setTimeout(r, stepMs));
    }
    return { terminated, killed };
}

module.exports = { KINDS, track, live, reap };
