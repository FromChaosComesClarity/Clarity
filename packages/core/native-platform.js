'use strict';
/*
 * ── Is the installed build native Linux, or a Windows one? ───────────────────
 *
 * The gallery badge answers one narrow question: what is actually sitting in the
 * folder on this disk. Not what the store page advertises, not what ProtonDB
 * scores, not whether a Linux build exists somewhere. Only what was downloaded.
 *
 * That distinction matters because the obvious shortcuts are all wrong. A store's
 * "Linux supported" flag describes the catalogue, not the install. ProtonTier is
 * about Windows games by definition. And the launch command only reports what
 * Clarity decided to wrap the game in, which is circular: it is derived from the
 * answer we are looking for.
 *
 * So this reads the files. ELF magic means a Linux build, MZ means a PE. The walk
 * is shallow and stops at the first ELF it can prove, because a game folder can
 * hold tens of thousands of files and the entry point is never buried deep.
 *
 * ⚠️ Plenty of games ship both, Unity ones especially: Game.exe and Game.x86_64
 * sit in the same folder. An ELF present wins, because Steam prefers the native
 * depot whenever a game has one, and a bundled Linux binary that is never run is
 * far rarer than a Unity game that ships the pair.
 */

const fs = require('fs');
const path = require('path');

// Never the game's own entry point, and several of them are full of Windows
// redistributables that would otherwise answer "windows" for a native game.
// Never the game's own entry point, and several of them actively mislead. The
// redistributable folders are full of Windows installers and would answer "windows"
// for a native game. pnacl/ is the opposite trap: it is Chromium's Portable Native
// Client toolchain, which every NW.js and Electron game carries on every platform,
// and it is a pile of real Linux ELF executables (pnacl_public_x86_64_ld_nexe and
// the rest). 8-Bit Adventures 2 is a Windows build that looked native entirely
// because of it. Skipping the folder lets the binary beside it decide.
const SKIP_DIRS = /^(\$?_{0,2}(common)?redists?|redistributables?|directx|dotnet|vcredist|openal|drivers?|docs?|manuals?|soundtracks?|extras?|saves?|screenshots?|support|tools|p?nacl|swiftshader)$/i;

// Files worth opening. Anything else with an extension is data, and reading the
// first four bytes of every .png in a game folder is a waste of a thousand seeks.
const MAYBE_ELF = /\.(x86_64|x86|bin|elf|out|run|aarch64|amd64|i386|appimage)$/i;
const IS_PE     = /\.(exe|dll)$/i;

/*
 * A Linux *runtime* library shipped inside the game folder. Weaker than finding the
 * executable, but it settles the cases where the executable is not a native binary
 * at all: an FNA or MonoGame title ships Game.exe as a managed assembly and runs it
 * under Mono, so the folder holds a PE and is still the Linux build. What gives it
 * away is libSDL2-2.0.so.0 beside it. 80's OVERDRIVE is exactly this shape, and
 * carries no executable of any kind.
 *
 * ⚠️ A runtime list, not "any .so", and the difference is not pedantry. Bloody Spell
 * is a Windows game that bundles the whole Steamworks SDK: libsteam_api.so and
 * libsteam_api64.so sit right next to steam_api64.dll, and a libsteam_api.dylib too,
 * which is the tell. Nobody ships macOS libraries in a Linux depot. A shim that a
 * developer copied in wholesale says nothing about the build; a library the game
 * cannot start without says everything.
 */
const IS_LINUX_RUNTIME_SO = /^(libSDL2|libopenal\.so|libFNA3D|libFAudio|libMonoPosixHelper|libmonosgen|libmono-|UnityPlayer\.so|libcoreclr\.so|libGLESv2\.so|libEGL\.so)/i;

/*
 * '' | 'pe' | 'elf-obj' | 'elf-exec'.
 *
 * ⚠️ The ELF answer is split by e_type, at offset 16, because the magic alone is not
 * enough. 8-Bit Adventures 2 is a Windows NW.js game that bundles Google's NaCl
 * toolchain, and that toolchain is a heap of Linux .o files: pnacl_public_x86_32_-
 * crtbegin_o and friends all start with \x7fELF and would otherwise prove a native
 * build that does not exist. Relocatable objects (type 1) are build leftovers.
 * Only an executable (2) or a shared object / PIE (3) is something you can run.
 */
function magicOf(file) {
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        const b = Buffer.alloc(18);
        const n = fs.readSync(fd, b, 0, 18, 0);
        if (n < 4) return '';
        if (b[0] === 0x4d && b[1] === 0x5a) return 'pe';                                  // MZ
        if (!(b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46)) return ''; // \x7fELF
        if (n < 18) return 'elf-obj';
        const eType = b[5] === 2 ? b.readUInt16BE(16) : b.readUInt16LE(16);               // EI_DATA: 2 = big-endian
        return (eType === 2 || eType === 3) ? 'elf-exec' : 'elf-obj';
    } catch {
        return '';
    } finally {
        try { if (fd !== undefined) fs.closeSync(fd); } catch {}
    }
}

/*
 * 'linux' | 'windows' | '' (nothing conclusive in there).
 *
 * Returns '' rather than guessing: an empty answer is retried on a later scan,
 * whereas a wrong one would be cached and shown under a cover for good.
 */
function detectPlatform(dir, { maxDepth = 2 } = {}) {
    if (!dir) return '';
    let sawPe = false;
    let sawLinuxSo = false;

    const walk = (d, depth) => {
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return false; }

        // Files before directories: an answer at this level beats descending for one.
        for (const e of entries) {
            if (!e.isFile() && !e.isSymbolicLink()) continue;
            if (IS_LINUX_RUNTIME_SO.test(e.name)) { sawLinuxSo = true; continue; }
            if (/\.so(\.\d+)*$/i.test(e.name)) continue;   // some other .so: proves nothing either way
            if (IS_PE.test(e.name)) { sawPe = true; continue; }
            const hasExt = /\.[A-Za-z0-9]{1,8}$/.test(e.name);
            if (hasExt && !MAYBE_ELF.test(e.name)) continue;
            if (magicOf(path.join(d, e.name)) === 'elf-exec') return true;
        }

        if (depth >= maxDepth) return false;
        for (const e of entries) {
            if (!e.isDirectory() || SKIP_DIRS.test(e.name)) continue;
            if (walk(path.join(d, e.name), depth + 1)) return true;
        }
        return false;
    };

    /*
     * Finding a native executable is the strong answer and wins outright.
     *
     * Failing that, a Windows executable settles it. The runtime-library signal only
     * gets to speak when the folder holds no executable at all, which is a genuinely
     * odd shape and the one 80's OVERDRIVE has. It is deliberately last, because
     * Baldur's Gate 3 ships bin/libSDL2.so beside bin/bg3.exe and has no Linux build
     * at all; letting the library outrank the executable badges it native.
     */
    if (walk(dir, 0)) return 'linux';
    if (sawPe) return 'windows';
    return sawLinuxSo ? 'linux' : '';
}

module.exports = { detectPlatform, magicOf };
