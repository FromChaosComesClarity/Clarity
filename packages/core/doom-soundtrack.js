// ── Doom soundtracks ─────────────────────────────────────────────────────────
// Swap the music a Doom mod plays without touching the mod. Brutal Doom on Andrew
// Hulshult's IDKFA is the case this exists for, and the interesting part is where the
// music comes from: not a download, but the DOOM + DOOM II re-release the user already
// owns. That release ships both of its alternate soundtracks inside extras.wad as ogg
// lumps, prefixed by which recording they belong to:
//
//   H_*   IDKFA, Andrew Hulshult's re-recording. 44 tracks, Doom and Doom II.
//   O_*   the original Bobby Prince score, re-recorded for the re-release. 87 tracks,
//         and it reaches further, into Sigil, TNT and Plutonia.
//
// So the whole feature is a rename. H_E1M1 is the same song as D_E1M1, and a PWAD whose
// lumps carry the D_ names overrides the IWAD's music the way every music replacement
// WAD has since 1994. Nothing is downloaded, nothing is decoded, and the bytes stay the
// bytes the user paid for.
//
// What stops it being *only* a rename is that a music lump's NAME does not tell you which
// song it holds. That varies per IWAD, so it is worked out by hashing the user's own
// files rather than from a table written once here:
//
//   - Doom reuses songs. Doom II's MAP16 asks for D_RUNNI2, which in doom2.wad is
//     byte-for-byte D_RUNNIN. Replace only D_RUNNIN and MAP16 drops back to MIDI while
//     MAP01 plays IDKFA, which sounds broken.
//   - The same name means different songs in different IWADs. tnt.wad's D_RUNNIN is not
//     Doom II's D_RUNNIN, it is TNT's own music. Going by name, IDKFA looks like a 74%
//     match for TNT and would put the wrong song on nearly every map.
//   - And the reuse runs across games. Nearly all of plutonia.wad's music turns out to be
//     Doom *1* songs: its D_RUNNIN is the song doom.wad files as D_E1M2. So Plutonia is
//     genuinely covered, 26 of its 27 songs, but only if you follow the bytes.
//
// So every lump is identified by content against the re-release's own doom.wad and
// doom2.wad, and pointed at the matching recording through GZDoom's $musicalias.
//
// Hence the shape on disk: one big audio WAD, shared by every IWAD and every mod on the
// engine, plus a tiny alias WAD per IWAD holding nothing but a SNDINFO lump. Copying
// 336MB once per IWAD to say the same thing three times would be silly.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Where the built soundtracks live, beside the engine and shared by every mod on it,
// the same argument that keeps one GZDoom for four mods.
const SOUNDTRACK_DIR = 'soundtracks';

const SOUNDTRACKS = [
    {
        id: 'idkfa',
        prefix: 'H_',
        title: 'IDKFA, by Andrew Hulshult',
        blurb: 'The re-recorded metal soundtrack, from your DOOM + DOOM II re-release.',
    },
    {
        id: 'remaster',
        prefix: 'O_',
        title: 'The original score, re-recorded',
        blurb: 'Bobby Prince\'s music as the re-release plays it, real instruments instead of MIDI.',
    },
];

const getSoundtrack = (id) => SOUNDTRACKS.find(s => s.id === id) || null;

// ── WAD reading ──────────────────────────────────────────────────────────────
// The format is a 12-byte header and a flat directory of 16-byte entries, which is why
// this is 20 lines and not a dependency.
function readWadDirectory(file) {
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        const head = Buffer.alloc(12);
        if (fs.readSync(fd, head, 0, 12, 0) !== 12) return [];
        const magic = head.toString('latin1', 0, 4);
        if (magic !== 'IWAD' && magic !== 'PWAD') return [];
        const count = head.readInt32LE(4);
        const tableAt = head.readInt32LE(8);
        if (count <= 0 || count > 200000 || tableAt <= 0) return [];

        const table = Buffer.alloc(count * 16);
        if (fs.readSync(fd, table, 0, table.length, tableAt) !== table.length) return [];
        const out = [];
        for (let i = 0; i < count; i++) {
            const at = i * 16;
            out.push({
                offset: table.readInt32LE(at),
                size: table.readInt32LE(at + 4),
                // Lump names are 8 bytes, NUL-padded rather than NUL-terminated.
                name: table.toString('latin1', at + 8, at + 16).replace(/\0.*$/, '').toUpperCase(),
            });
        }
        return out;
    } catch { return []; }
    finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

// The music lumps an IWAD actually contains, de-duplicated by name. A name can appear
// twice in one WAD (the re-release's doom.wad does exactly that) and the last one wins
// at load time, which is also the one we want to hash.
function musicLumps(wadFile) {
    const byName = new Map();
    for (const l of readWadDirectory(wadFile)) {
        if (!l.name.startsWith('D_') || l.size <= 0) continue;
        byName.set(l.name, l);
    }
    return byName;
}

// Hashing a WAD's music is the one costly step here, and the launch dialog asks for it
// once per IWAD beside the engine every time it opens. Keyed on size and mtime so a
// replaced IWAD is re-read rather than remembered wrongly.
const _hashCache = new Map();
function hashMusicCached(wadFile) {
    let st;
    try { st = fs.statSync(wadFile); } catch { return new Map(); }
    const key = `${wadFile}|${st.size}|${st.mtimeMs}`;
    if (!_hashCache.has(key)) _hashCache.set(key, hashMusic(wadFile));
    return _hashCache.get(key);
}

// Every music lump in a WAD, hashed. The hash is the song; the name is only what this
// particular IWAD happens to file it under.
function hashMusic(wadFile) {
    const lumps = musicLumps(wadFile);
    const out = new Map();                           // name -> sha1
    if (!lumps.size) return out;
    let fd;
    try {
        fd = fs.openSync(wadFile, 'r');
        for (const [name, l] of lumps) {
            const buf = Buffer.alloc(l.size);
            if (fs.readSync(fd, buf, 0, l.size, l.offset) !== l.size) continue;
            out.set(name, crypto.createHash('sha1').update(buf).digest('hex'));
        }
    } catch { return new Map(); }
    finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
    return out;
}

// ── What a track is actually called ──────────────────────────────────────────
// The recordings are named after Doom and Doom II's lump names, so the only question
// that matters for any given IWAD is "which of those songs is this lump?". Answered by
// content, against the re-release's own doom.wad and doom2.wad, which sit beside
// extras.wad and are the originals these recordings were made from.
//
// Doing it by content rather than by name is what makes the whole thing correct:
//
//   - It resolves reuse for free. Doom II's D_RUNNI2 hashes to the same song as
//     D_RUNNIN, so it lands on the same replacement without a table of exceptions.
//   - It refuses the games the recordings do not cover. TNT and Plutonia file their own
//     music under Doom II's names, so tnt.wad's D_RUNNIN is a completely different song.
//     By name it looks like a 74% match and every map would get the wrong music; by
//     content almost nothing resolves, and the soundtrack is correctly not offered.
function referenceIndex(extrasWad) {
    const dir = path.dirname(extrasWad);
    const index = new Map();                         // sha1 -> canonical D_ name
    for (const base of ['doom.wad', 'doom2.wad']) {
        let file = null;
        try { file = fs.readdirSync(dir).find(n => n.toLowerCase() === base); } catch {}
        if (!file) continue;
        for (const [name, h] of hashMusicCached(path.join(dir, file))) {
            if (!index.has(h)) index.set(h, name);
        }
    }
    return index;
}

// For one IWAD: which of its music lump names map to which canonical track. Names that
// resolve to nothing are songs these recordings never covered, and are left alone so the
// IWAD's own music still plays there.
function resolveTracks(extrasWad, iwadFile) {
    const ref = referenceIndex(extrasWad);
    const out = new Map();                           // iwad lump name -> canonical name
    const songs = new Set();
    for (const [name, h] of hashMusicCached(iwadFile)) {
        songs.add(h);
        const canonical = ref.get(h);
        if (canonical) out.set(name, canonical);
    }
    return { map: out, songs: songs.size };
}

// ── The source ───────────────────────────────────────────────────────────────
// extras.wad only ships with the 2024 re-release, so finding it is also the proof that
// the user owns the recording. Matched on the file and its contents, never on the title
// of a library row, for the same reason the data specs probe rather than trust.
const RE_RELEASE_TITLES = [/doom \+ doom ii/i, /doom (i|ii) enhanced/i, /doom.*re-?release/i];

function sourceIn(root) {
    if (!root) return null;
    let names = [];
    try { names = fs.readdirSync(root); } catch { return null; }
    const hit = names.find(n => n.toLowerCase() === 'extras.wad');
    if (!hit) return null;
    const file = path.join(root, hit);
    // A file called extras.wad proves nothing on its own. The prefixed lumps do.
    const have = new Set(readWadDirectory(file).map(l => l.name.slice(0, 2)));
    return SOUNDTRACKS.some(s => have.has(s.prefix)) ? file : null;
}

// The re-release in the user's library, if it is installed. Returns the path to its
// extras.wad, or null, which is not an error: it just means this engine gets no
// soundtrack options and the dialog says nothing about them.
function findSource(dataRows) {
    for (const g of (dataRows || [])) {
        if (!g.installed || !g.install_path) continue;
        if (!RE_RELEASE_TITLES.some(rx => rx.test(String(g.title || '')))) continue;
        const hit = sourceIn(g.install_path);
        if (hit) return { file: hit, title: g.title };
    }
    return null;
}

// ── Coverage ─────────────────────────────────────────────────────────────────
// Which of the soundtracks are worth offering for a given IWAD, worked out by asking how
// much of that IWAD's music the recording actually replaces.
//
// This is what keeps IDKFA off TNT and Plutonia without a list of exceptions: their music
// resolves against the reference almost not at all. Offering it there would not be a
// smaller soundtrack, it would be the wrong songs on the wrong maps. Anything under half
// an IWAD's songs is treated as "not for this game" rather than shown as a partial fit.
const COVERAGE_FLOOR = 0.5;

function coverageFor(extrasWad, iwadFile) {
    const lumps = readWadDirectory(extrasWad);
    const have = new Map(lumps.map(l => [l.name, l.size]));
    const { map, songs } = resolveTracks(extrasWad, iwadFile);
    if (!songs) return [];

    return SOUNDTRACKS.map(s => {
        // Count distinct songs, not lump names, so an IWAD that files one song under
        // three names is not reported as three tracks of coverage.
        const covered = new Set();
        for (const canonical of map.values()) {
            if (have.has(s.prefix + canonical.slice(2))) covered.add(canonical);
        }
        // What building it would cost, which is the whole recording rather than only the
        // part this IWAD uses: the audio WAD is shared by every Doom on this engine.
        let bytes = 0;
        for (const l of lumps) if (l.name.startsWith(s.prefix)) bytes += l.size;
        return { ...s, covered: covered.size, total: songs, ratio: covered.size / songs, bytes };
    }).filter(s => s.ratio >= COVERAGE_FLOOR);
}

// ── Building ─────────────────────────────────────────────────────────────────
// lumps are either { name, buf } for something we built in memory, or
// { name, from: { file, offset, size } } to copy a slice of another WAD straight through.
//
// Async, and deliberately so: the audio half is a third of a gigabyte, and doing that
// synchronously on Electron's main process is a third of a gigabyte of frozen window.
// Awaiting each chunk hands the event loop back between slices.
async function writeWad(outFile, lumps, onProgress) {
    const out = await fs.promises.open(outFile, 'w');
    const total = lumps.reduce((n, l) => n + (l.buf ? l.buf.length : l.from.size), 0);
    let written = 0;
    // Throttled: a 336MB build is ~45 slices, but reporting every one of them down an IPC
    // channel to redraw the same bar is noise. Only tell the caller when the number moves.
    let lastPct = -1;
    const tick = () => {
        if (!onProgress) return;
        const pct = total ? Math.round(written * 100 / total) : 100;
        if (pct === lastPct) return;
        lastPct = pct;
        onProgress({ done: written, total, pct });
    };
    try {
        let at = 12;
        const dir = [];
        await out.write(Buffer.alloc(12), 0, 12, 0);   // header rewritten at the end

        for (const l of lumps) {
            if (l.buf) {
                await out.write(l.buf, 0, l.buf.length, at);
                dir.push({ name: l.name, offset: at, size: l.buf.length });
                at += l.buf.length;
                written += l.buf.length;
                tick();
            } else {
                // Streamed in 8MB slices: these are whole songs at 320kbps, so the set
                // never all sits in memory.
                const src = await fs.promises.open(l.from.file, 'r');
                try {
                    const chunk = Buffer.alloc(Math.min(8 * 1024 * 1024, l.from.size));
                    let done = 0;
                    while (done < l.from.size) {
                        const want = Math.min(chunk.length, l.from.size - done);
                        const { bytesRead } = await src.read(chunk, 0, want, l.from.offset + done);
                        if (bytesRead <= 0) break;
                        await out.write(chunk, 0, bytesRead, at + done);
                        done += bytesRead;
                        written += bytesRead;
                        tick();
                    }
                    dir.push({ name: l.name, offset: at, size: done });
                    at += done;
                } finally { await src.close(); }
            }
        }

        const table = Buffer.alloc(dir.length * 16);
        dir.forEach((d, i) => {
            table.writeInt32LE(d.offset, i * 16);
            table.writeInt32LE(d.size, i * 16 + 4);
            table.write(d.name.slice(0, 8).padEnd(8, '\0'), i * 16 + 8, 8, 'latin1');
        });
        await out.write(table, 0, table.length, at);

        const head = Buffer.alloc(12);
        head.write('PWAD', 0, 4, 'latin1');
        head.writeInt32LE(dir.length, 4);
        head.writeInt32LE(at, 8);
        await out.write(head, 0, 12, 0);
    } finally { await out.close(); }
}

const audioWadPath = (engineRoot, id) => path.join(engineRoot, SOUNDTRACK_DIR, `${id}.wad`);
const aliasWadPath = (engineRoot, id, iwadFile) =>
    path.join(engineRoot, SOUNDTRACK_DIR, `${id}-${path.basename(iwadFile, path.extname(iwadFile)).toLowerCase()}.wad`);

// The audio half: every track the recording has, under the D_ name the engine asks for.
// Shared by every IWAD and every mod on this engine, and built once.
async function buildAudio({ extrasWad, engineRoot, id, onProgress }) {
    const spec = getSoundtrack(id);
    if (!spec) return { ok: false, error: `Unknown soundtrack "${id}".` };
    if (!fs.existsSync(extrasWad)) return { ok: false, error: 'The re-release data is no longer where it was.' };

    const tracks = readWadDirectory(extrasWad)
        .filter(l => l.name.startsWith(spec.prefix) && l.size > 0)
        .map(l => ({ name: 'D_' + l.name.slice(2), from: { file: extrasWad, offset: l.offset, size: l.size } }));
    if (!tracks.length) return { ok: false, error: `No ${spec.title} tracks were found in ${path.basename(extrasWad)}.` };

    const out = audioWadPath(engineRoot, id);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // Written to a temp name and moved into place, so an interrupted build never leaves a
    // half-written WAD that looks installed and plays silence.
    const tmp = out + '.part';
    const total = tracks.reduce((n, t) => n + t.from.size, 0);
    fs.rmSync(tmp, { force: true });
    try {
        await writeWad(tmp, tracks, onProgress);
    } catch (e) {
        fs.rmSync(tmp, { force: true });
        return { ok: false, error: `Could not build the soundtrack: ${e.message}` };
    }
    fs.rmSync(out, { force: true });
    fs.renameSync(tmp, out);
    return { ok: true, file: out, tracks: tracks.length, bytes: total };
}

// The alias half: one SNDINFO lump telling the engine that D_RUNNI2 is D_RUNNIN, for
// every group of names this IWAD uses for one song. Tiny, and specific to the IWAD it was
// derived from, which is why it is a separate file from the audio.
async function buildAliases({ extrasWad, engineRoot, id, iwadFile }) {
    const spec = getSoundtrack(id);
    if (!spec) return { ok: false, error: `Unknown soundtrack "${id}".` };

    const have = new Set(readWadDirectory(extrasWad).map(l => l.name));
    const lines = [
        `// Built by Clarity from ${path.basename(extrasWad)} for ${path.basename(iwadFile)}.`,
        `// ${spec.title}. Each line points a music name this IWAD uses at the track that`,
        '// replaces it, so a song reused under several names stays replaced everywhere.',
    ];
    let aliased = 0;
    for (const [name, canonical] of resolveTracks(extrasWad, iwadFile).map) {
        if (name === canonical) continue;            // the audio WAD already answers to this
        if (!have.has(spec.prefix + canonical.slice(2))) continue;   // nothing replaces it
        lines.push(`$musicalias ${name} ${canonical}`);
        aliased++;
    }

    const out = aliasWadPath(engineRoot, id, iwadFile);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await writeWad(out, [{ name: 'SNDINFO', buf: Buffer.from(lines.join('\n') + '\n', 'latin1') }]);
    return { ok: true, file: out, aliased };
}

// What a launch line needs for this soundtrack on this IWAD, built if it is not there
// yet. The audio is the expensive half and is reused; the aliases are rebuilt every time,
// because they cost nothing and a stale one would be a wrong-music bug nobody could find.
async function ensureBuilt({ extrasWad, engineRoot, id, iwadFile, onProgress }) {
    const audio = audioWadPath(engineRoot, id);
    const fresh = !fs.existsSync(audio);
    if (fresh) {
        const r = await buildAudio({ extrasWad, engineRoot, id, onProgress });
        if (!r.ok) return r;
    }
    const files = [audio];
    // Without an IWAD there is nothing to derive aliases from, which is the "ask me at
    // launch" case. The tracks still answer to their own names, so the soundtrack still
    // plays; only the songs this IWAD files under a second name fall back to the original.
    if (iwadFile && fs.existsSync(iwadFile)) {
        const a = await buildAliases({ extrasWad, engineRoot, id, iwadFile });
        if (a.ok && a.aliased) files.push(a.file);
    }
    return { ok: true, built: fresh, files: files.map(f => path.relative(engineRoot, f)) };
}

// Editing the launch line itself lives with the rest of that work, in custom-installers,
// beside withIwad. This module knows about music; that one knows about command lines.
module.exports = {
    SOUNDTRACKS, SOUNDTRACK_DIR, getSoundtrack,
    readWadDirectory, hashMusic, referenceIndex, resolveTracks,
    findSource, sourceIn, coverageFor,
    buildAudio, buildAliases, ensureBuilt,
    audioWadPath, aliasWadPath,
};
