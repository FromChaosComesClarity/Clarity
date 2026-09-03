#!/usr/bin/env node
/*
 * postdist — put the freshly built AppImage where it actually gets run.
 *
 * The suite is portable: `GameManagerConfig/` lives BESIDE the AppImage, not in ~/.config.
 * So the AppImage and its library are a pair, and dropping a new build into a directory that
 * has no config beside it produces a build that opens on an empty library — which is exactly
 * what had been happening on the Omarchy laptop, where every `npm run dist` landed in
 * ~/Games/Clarity (two AppImages, no config) while the real 930-game library sat in
 * ~/Clarity next to yesterday's build.
 *
 * Hence: deploy next to the config, rather than to a path that happens to be typed here.
 * Candidates are tried in order and the first one with a GameManagerConfig wins; if none has
 * one, the first that exists at all is used, which keeps a fresh machine working. Nothing is
 * created — this step is a convenience and must never be the thing that fails a build.
 *
 * ⚠️ Machine-specific paths. CLARITY_DEPLOY_DIR overrides everything, which is the
 * escape hatch for a machine that keeps its library somewhere else entirely.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const FILE = 'Clarity.AppImage';
const BUILT = path.resolve('dist', FILE);

const CANDIDATES = [
    process.env.CLARITY_DEPLOY_DIR,
    path.join(HOME, 'Clarity'),
].filter(Boolean);

function hasConfig(dir) {
    try { return fs.statSync(path.join(dir, 'GameManagerConfig')).isDirectory(); } catch { return false; }
}
function exists(dir) {
    try { return fs.statSync(dir).isDirectory(); } catch { return false; }
}

if (!fs.existsSync(BUILT)) {
    console.log(`• no ${FILE} in dist/ — nothing to deploy`);
    process.exit(0);
}

const target = CANDIDATES.find(hasConfig) || CANDIDATES.find(exists);
if (!target) {
    console.log(`• no deploy directory found (looked in: ${CANDIDATES.join(', ')}) — skipping`);
    process.exit(0);
}

const dest = path.join(target, FILE);
try {
    // Keep the previous build rather than overwriting it: it is the only way back if the new
    // one is broken, and on this project a bad build has shipped before.
    if (fs.existsSync(dest)) fs.renameSync(dest, path.join(target, 'Clarity_old.AppImage'));
    fs.copyFileSync(BUILT, dest);
    fs.chmodSync(dest, 0o755);
    const mb = (fs.statSync(dest).size / 1048576).toFixed(1);
    console.log(`• deployed ${FILE} (${mb} MB) → ${target}${hasConfig(target) ? ' (library found beside it)' : ' (⚠ no GameManagerConfig here yet)'}`);
} catch (e) {
    console.log(`• could not deploy to ${target}: ${e.message}`);
}
