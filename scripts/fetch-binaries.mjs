#!/usr/bin/env node
'use strict';
/*
 * Fetches the prebuilt helper binaries (ffmpeg, ffprobe, yt-dlp, gogdl, legendary, comet)
 * that the suite needs at runtime but that are too large to keep in git. They live as one
 * checksum-pinned tarball per host on a GitHub Release of this repo.
 *
 * Idempotent: if all binaries are already present it does nothing, so local builds never
 * re-download. Runs from `postinstall` and before `dist`.
 *
 * Which directory they land in comes from the platform backend, so build tooling and the
 * running app can never disagree about where they are.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

let host;
try { host = require('../packages/core/platform/index.js'); }
catch (e) { console.error(`\n✗ ${e.message}`); process.exit(1); }

const BIN_DIR  = join(__dirname, '..', 'assets', 'bin', host.binDirName);
const REQUIRED = ['ffmpeg', 'ffprobe', 'yt-dlp', 'gogdl', 'legendary', 'comet'];

// Pinned release asset + its SHA256, per host. Bump the tag and hash together when a
// binary set changes.
//
// gogdl in both tarballs is OUR BUILD, from the fork, it carries fixes that are not in
// upstream 1.2.1 (CDN failover on a corrupt chunk, bounded secure-link retries, non-blocking
// telemetry, API timeouts). These binaries are gitignored, so the tarball is the only place
// they live: point this at the upstream build and a clean checkout would quietly lose all of
// it. Rebuild from the fork and publish a new binaries-vN before bumping. On macOS, PyInstaller
// cannot cross-compile, so that half has to be built on a Mac:
//   python3 -m PyInstaller --onefile --name gogdl installer_entry.py --clean --noconfirm
// (see docs/mac-port-handoff.md, Phase B.6). Shipping upstream's darwin build instead is NOT a
// stopgap: 1.3.0 picked up our CDN rotation but still verifies the chunk checksum outside the
// retry loop, still blocks on the telemetry queue, and still recurses without a limit in
// get_secure_link while dropping `root`. That is three known download-hanging bugs.
//
// The archive is expected to contain the six names in REQUIRED exactly. Upstream calls its
// macOS builds gogdl_macos_arm64 / legendary_macOS_arm64 / comet-aarch64-apple-darwin /
// yt-dlp_macos, rename them when building that tarball rather than branching here.
const SOURCES = {
    linux: {
        url:    'https://github.com/FromChaosComesClarity/Clarity/releases/download/binaries-v2/clarity-binaries-v2.tar.gz',
        sha256: '876eecaeda3228ee24288c1fae0b87b8f2ed9b1775b1ce48c2d5ad47cc93b3bf',
    },
    darwin: {
        url:    'https://github.com/FromChaosComesClarity/Clarity/releases/download/binaries-mac-v2/clarity-binaries-mac-v2.tar.gz',
        sha256: '892a251259ba6474cfee8860c26068430bbb27b24aba28d82e6447b5e06559c3',
    },
};

// What a given tarball is expected to deliver. A source may deliberately provide less than
// the full set (see darwin), in which case the shortfall is reported every run rather than
// being retried as a failed download for ever.
const expectedOf  = source => source?.provides || REQUIRED;
const presentIn   = names => names.every(name => existsSync(join(BIN_DIR, name)));
const reportGaps  = source => {
    for (const [name, how] of Object.entries(source?.missing || {})) {
        if (existsSync(join(BIN_DIR, name))) continue;
        console.warn(`\n⚠ ${name} is not in this tarball, ${how}\n`);
    }
};
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

function main() {
    const source = SOURCES[host.id];

    if (source && presentIn(expectedOf(source))) {
        console.log(`• helper binaries already present (${host.binDirName}), skipping fetch`);
        reportGaps(source);
        return;
    }

    if (!source) {
        console.warn(
            `\n⚠ No helper-binary tarball published for "${host.id}" yet.\n` +
            `  Build one containing ${REQUIRED.join(', ')} and add it to SOURCES in this file.\n` +
            `  The suite will not be able to download or launch store games until then.\n`);
        return;   // deliberately not fatal: lets a fresh checkout install its deps first
    }

    console.log(`• fetching helper binaries for ${host.id} …`);
    mkdirSync(BIN_DIR, { recursive: true });
    const tmp = join(tmpdir(), `clarity-binaries-${host.id}.tar.gz`);

    try {
        execFileSync('curl', ['-fL', '--retry', '3', '-o', tmp, source.url], { stdio: 'inherit' });
    } catch {
        console.error(`\n✗ download failed: ${source.url}\n  Check the release exists, then re-run \`npm run fetch-bin\`.`);
        process.exit(1);
    }

    const got = sha256(tmp);
    if (got !== source.sha256) {
        rmSync(tmp, { force: true });
        console.error(`\n✗ checksum mismatch\n  expected ${source.sha256}\n  got      ${got}`);
        process.exit(1);
    }

    execFileSync('tar', ['-xzf', tmp, '-C', BIN_DIR], { stdio: 'inherit' });
    // Only what this tarball actually delivered, chmod on an absent name would abort here.
    const landed = expectedOf(source).filter(n => existsSync(join(BIN_DIR, n)));
    if (landed.length) execFileSync('chmod', ['+x', ...landed.map(n => join(BIN_DIR, n))]);
    rmSync(tmp, { force: true });

    const shortfall = expectedOf(source).filter(n => !existsSync(join(BIN_DIR, n)));
    if (shortfall.length) {
        console.error(`\n✗ extraction completed but these are still missing: ${shortfall.join(', ')}`);
        process.exit(1);
    }
    console.log('• helper binaries ready');
    reportGaps(source);
}

main();
