#!/usr/bin/env node
/*
 * Embed AppImage update information, and build the .zsync beside it.
 *
 * AppImageHub's test on our catalog entry said:
 *
 *   The AppImage contains no update information, so users cannot update it with
 *   AppImageUpdate or similar tools.
 *
 * It was right, and electron-builder cannot fix it: both of its AppImage paths
 * finish at appendBlockmap(), which writes electron-updater's own .blockmap and
 * has nothing to do with AppImage update information. The strings "zsync" and
 * "upd_info" do not appear anywhere in app-builder-lib. Adding a `publish`
 * provider does not help either; the .upd_info section stays all zeros.
 *
 * So we write it ourselves, which is all appimagetool -u does: the AppImage runtime
 * reserves a section called .upd_info, and AppImageUpdate reads the string in it to
 * learn where newer builds live. The format for GitHub releases is
 *
 *   gh-releases-zsync|<owner>|<repo>|latest|<asset name>.zsync
 *
 * ⚠️ The section offset is read out of the ELF header every time rather than
 * hardcoded. It moves whenever the bundled runtime changes, and electron-builder
 * changes runtimes between versions (we moved from the fuse2 one to the static one
 * in this very release), so a fixed offset would quietly corrupt the runtime.
 *
 * The .zsync is generated last, because zsyncmake hashes the finished file: build it
 * before the update information goes in and every block checksum is wrong.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const OWNER = 'FromChaosComesClarity';
const REPO = 'Clarity';
const FILE = 'Clarity.AppImage';

const appImage = path.resolve('dist', FILE);
const updateInfo = `gh-releases-zsync|${OWNER}|${REPO}|latest|${FILE}.zsync`;

if (!fs.existsSync(appImage)) {
    console.log(`• no ${FILE} in dist/, nothing to stamp`);
    process.exit(0);
}

/* Find a section by name in an ELF64 file, returning where it lives. */
function findSection(fd, wanted) {
    const eh = Buffer.alloc(64);
    fs.readSync(fd, eh, 0, 64, 0);
    if (eh.toString('latin1', 0, 4) !== '\x7fELF') throw new Error('not an ELF file');
    if (eh[4] !== 2) throw new Error('not 64-bit ELF');

    const shoff = Number(eh.readBigUInt64LE(0x28));
    const shentsize = eh.readUInt16LE(0x3a);
    const shnum = eh.readUInt16LE(0x3c);
    const shstrndx = eh.readUInt16LE(0x3e);
    if (!shoff || !shnum) throw new Error('no section headers');

    const readHeader = (i) => {
        const b = Buffer.alloc(shentsize);
        fs.readSync(fd, b, 0, shentsize, shoff + i * shentsize);
        return { name: b.readUInt32LE(0), offset: Number(b.readBigUInt64LE(0x18)), size: Number(b.readBigUInt64LE(0x20)) };
    };

    // The section names live in their own section, named by e_shstrndx.
    const strtab = readHeader(shstrndx);
    const names = Buffer.alloc(strtab.size);
    fs.readSync(fd, names, 0, strtab.size, strtab.offset);

    for (let i = 0; i < shnum; i++) {
        const s = readHeader(i);
        const end = names.indexOf(0, s.name);
        if (names.toString('latin1', s.name, end === -1 ? undefined : end) === wanted) return s;
    }
    return null;
}

let section;
const fd = fs.openSync(appImage, 'r+');
try {
    section = findSection(fd, '.upd_info');
    if (!section) throw new Error('this AppImage runtime has no .upd_info section');

    const payload = Buffer.from(updateInfo, 'utf8');
    if (payload.length + 1 > section.size) {
        throw new Error(`update information is ${payload.length} bytes, section holds ${section.size}`);
    }
    // Pad with NULs: the runtime reads a C string, and a shorter new value must not
    // leave the tail of an older, longer one behind it.
    const block = Buffer.alloc(section.size, 0);
    payload.copy(block);
    fs.writeSync(fd, block, 0, block.length, section.offset);
} finally {
    fs.closeSync(fd);
}
console.log(`• update information written at 0x${section.offset.toString(16)}: ${updateInfo}`);

const zsyncmake = spawnSync('sh', ['-c', 'command -v zsyncmake'], { encoding: 'utf8' }).stdout.trim();
if (!zsyncmake) {
    console.log('• zsyncmake not found, skipping the .zsync (install the "zsync" package)');
    process.exit(0);
}

// -u is the URL AppImageUpdate fetches the AppImage from once the .zsync tells it
// what changed. It has to match where the asset actually ends up.
const url = `https://github.com/${OWNER}/${REPO}/releases/latest/download/${FILE}`;
const out = `${appImage}.zsync`;
const r = spawnSync(zsyncmake, ['-u', url, '-o', out, appImage], { encoding: 'utf8', cwd: path.dirname(appImage) });
if (r.status !== 0) {
    console.log(`• zsyncmake failed: ${(r.stderr || '').trim().split('\n').pop()}`);
    process.exit(0);   // a missing .zsync must never fail the build
}
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`• built ${path.basename(out)} (${kb} KB)`);
