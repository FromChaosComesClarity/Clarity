// ── Custom installers ─────────────────────────────────────────────────────────
// Fan games, source ports and custom engines, installed from the file the user already
// downloaded. Deliberately a catalogue of *specific* recipes rather than one clever
// generic importer: the folders these projects ship are not consistent enough for a
// heuristic to get right, and getting it wrong is invisible. Brutal Doom is the example
// that settles the argument — the .bat beside gzdoom.exe carries the whole mod command
// line, so a generic "find the exe" importer launches vanilla Doom and looks like it
// worked.
//
// Two halves, and only the second one is ours to be clever about:
//   1. The port itself — the user downloads it. We say exactly where to get it and what
//      the file is called, then identify and unpack whatever they hand us.
//   2. The game data — this is the part worth automating. A source port is useless
//      without id1/pak0.pak, and the user very likely already owns Quake in the library
//      CN is already managing. We find it and wire it up rather than asking.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// ── The catalogue ────────────────────────────────────────────────────────────
// `archive` matches the file the user drops on us, so a mis-dropped download is caught
// before anything is unpacked. `entry` finds the executable inside whatever folder shape
// the project happens to ship this release. Both are deliberately loose on version
// numbers and tight on everything else.
const RECIPES = [
    {
        id: 'ironwail',
        hosts: ['linux'],
        title: 'Ironwail',
        kind: 'Source port',
        game: 'Quake',
        blurb: 'A fast, modern Quake engine — high frame rates, widescreen, and the original look kept intact.',
        source: {
            name: 'GitHub — andrei-drexler/ironwail',
            url: 'https://github.com/andrei-drexler/ironwail/releases/latest',
            hint: 'On the Releases page, download the Windows zip — it is named like ironwail-0.8.2-win64.zip.',
        },
        archive: /ironwail.*\.(zip|7z)$/i,
        samples: ['ironwail-0.8.2-win64.zip'],
        dirName: 'Ironwail',
        entry: { exe: /^ironwail\.exe$/i, platform: 'windows' },
        data: 'quake',
    },
    {
        id: 'vkquake',
        hosts: ['linux'],
        title: 'vkQuake',
        kind: 'Source port',
        game: 'Quake',
        blurb: 'Vulkan-based Quake port with modern rendering, water warp and scaling fixes.',
        source: {
            name: 'GitHub — Novum/vkQuake',
            url: 'https://github.com/Novum/vkQuake/releases/latest',
            hint: 'On the Releases page, download the Windows zip — it is named like vkQuake-1.35.0_windows_x64.zip.',
        },
        archive: /vkquake(?![-_]rt).*\.(zip|7z)$/i,
        samples: ['vkQuake-1.35.0_windows_x64.zip'],
        dirName: 'vkQuake',
        entry: { exe: /^vkquake\.exe$/i, platform: 'windows' },
        data: 'quake',
    },
    {
        id: 'quake-rt',
        hosts: ['linux'],
        title: 'Quake: Ray Traced',
        kind: 'Source port',
        game: 'Quake',
        blurb: 'Quake with full path tracing. Wants a ray-tracing capable GPU.',
        source: {
            name: 'GitHub — sultim-t/vkquake-rt',
            url: 'https://github.com/sultim-t/vkquake-rt/releases/latest',
            hint: 'On the Releases page, download the Windows zip — it is named like quake-rt-1_0_1.zip.',
        },
        archive: /(quake[-_]rt|vkquake[-_]rt).*\.(zip|7z)$/i,
        samples: ['quake-rt-1_0_1.zip'],
        dirName: 'Quake Ray Traced',
        entry: { exe: /^(vkquake|quake[-_]?rt)\.exe$/i, platform: 'windows' },
        data: 'quake',
    },
    {
        id: 'gzdoom',
        hosts: ['linux'],
        title: 'GZDoom',
        kind: 'Source port',
        game: 'Doom',
        blurb: 'The Doom engine everything else is built on — mouselook, high resolutions, and the engine nearly every Doom mod expects.',
        source: {
            name: 'GitHub — ZDoom/gzdoom',
            url: 'https://github.com/ZDoom/gzdoom/releases/latest',
            hint: 'On the Releases page, download the Windows zip — it is named like gzdoom-4-14-2-windows.zip.',
        },
        archive: /gzdoom.*\.(zip|7z)$/i,
        samples: ['gzdoom-4-14-2-windows.zip'],
        dirName: 'GZDoom',
        entry: { exe: /^gzdoom\.exe$/i, platform: 'windows' },
        data: 'doom',
    },
    {
        id: 'uzdoom',
        hosts: ['linux'],
        title: 'UZDoom',
        kind: 'Source port',
        game: 'Doom',
        blurb: 'A fork of GZDoom made in late 2025, continuing the same 4.x line. Same command line and the same mods — GZDoom still has the larger ecosystem, so either works.',
        source: {
            name: 'GitHub — UZDoom/UZDoom',
            url: 'https://github.com/UZDoom/uzdoom/releases/latest',
            hint: 'On the Releases page, download the Windows zip — it is named like Windows-UZDoom-4.14.3.zip.',
        },
        archive: /uzdoom.*\.(zip|7z)$/i,
        samples: ['Windows-UZDoom-4.14.3.zip'],
        dirName: 'UZDoom',
        entry: { exe: /^uzdoom\.exe$/i, platform: 'windows' },
        data: 'doom',
    },
    {
        id: 'minidoom2',
        hosts: ['linux'],
        title: 'Mini Doom 2',
        kind: 'Fan game',
        game: '',
        blurb: 'A standalone Doom-flavoured action platformer. Complete in itself — no Doom data needed.',
        source: {
            name: 'ModDB — Mini Doom 2',
            url: 'https://www.moddb.com/games/mini-doom-2/downloads',
            hint: 'Download the Windows build; the file is named like miniDoom2 v3-1.zip.',
        },
        archive: /^minidoom[\s_-]*2.*\.(zip|7z|rar)$/i,
        samples: ['miniDoom2 v3-1.zip'],
        dirName: 'Mini Doom 2',
        entry: { exe: /^mini\s*doom[\s_-]*2.*\.exe$/i, platform: 'windows' },
        data: null,
    },
    {
        id: 'minidoom1',
        hosts: ['linux'],
        title: 'Mini Doom',
        kind: 'Fan game',
        game: '',
        blurb: 'The original standalone Mini Doom. Complete in itself — no Doom data needed.',
        source: {
            name: 'ModDB — MiniDoom',
            url: 'https://www.moddb.com/games/mini-doom/downloads',
            hint: 'Download the Windows build; the file is named like MiniDoom_v1_3.zip.',
        },
        // The lookahead is load-bearing: without it this also matched miniDoom2's download
        // and installed the sequel under the first game's name, which is exactly what
        // happened. Two recipes whose patterns overlap silently mislabel each other.
        archive: /^minidoom(?![\s_-]*2).*\.(zip|7z|rar)$/i,
        samples: ['MiniDoom_v1_3.zip'],
        dirName: 'Mini Doom',
        entry: { exe: /^mini\s*doom(?![\s_-]*2).*\.exe$/i, platform: 'windows' },
        data: null,
    },
    {
        id: 'ecwolf',
        hosts: ['linux'],
        title: 'ECWolf',
        kind: 'Source port',
        game: 'Wolfenstein 3D',
        blurb: 'Wolfenstein 3D and Spear of Destiny with modern resolutions, mouselook and mod support, built on the ZDoom lineage.',
        source: {
            name: 'maniacsvault.net — ECWolf',
            url: 'https://maniacsvault.net/ecwolf/download.php',
            hint: 'Download the Windows x86-64 zip — it is named like ecwolf-1.4.1_x64.zip.',
        },
        archive: /ecwolf.*\.(zip|7z)$/i,
        samples: ['ecwolf-1.4.1_x64.zip'],
        dirName: 'ECWolf',
        entry: { exe: /^ecwolf\.exe$/i, platform: 'windows' },
        data: 'wolf3d',
    },
    {
        id: 'raze',
        hosts: ['linux'],
        title: 'Raze',
        kind: 'Source port',
        game: 'Build engine games',
        blurb: 'One engine for Duke Nukem 3D, Blood, Shadow Warrior, Redneck Rampage and Powerslave — from the GZDoom team. Install it once; the games below then install separately, each with its own entry. Opening this entry shows Raze\'s game picker once you have more than one Build game — with a single one it just starts it, and holding Shift as it launches forces the picker. Raze\'s settings live in the in-game menu, reachable from any of the games.',
        source: {
            name: 'GitHub — ZDoom/Raze',
            url: 'https://github.com/ZDoom/Raze/releases/latest',
            hint: 'On the Releases page, download the Windows zip — it is named like Raze-1.11.0b-windows.zip.',
        },
        archive: /raze.*\.(zip|7z)$/i,
        samples: ['Raze-1.11.0b-windows.zip'],
        dirName: 'Raze',
        entry: { exe: /^raze\.exe$/i, platform: 'windows' },
        // No data. The engine entry is the engine — clicking it opens Raze's own front end,
        // where the options live. Games are separate entries (see BUILD_GAMES below), each
        // in its own folder, which is also the only way two Build games can coexist without
        // fighting over tiles000.art. Linking data here made "Raze" boot straight into
        // whichever game happened to be linked, which is not what an engine entry is for.
        data: null,
    },
    {
        id: 'buildgdx',
        hosts: ['linux'],
        title: 'BuildGDX',
        kind: 'Source port',
        game: 'Build engine games',
        blurb: 'Java port covering the Build games Raze does not, including Witchaven I and II, TekWar and Legend of the Seven Paladins. It asks you to point it at each game folder itself the first time.',
        source: {
            name: 'm210.duke4.net — BuildGDX',
            url: 'https://m210.duke4.net/index.php/downloads/download/8-java/53-buildgdx',
            hint: 'Download the Windows build — the bundle with a JRE included is named like BuildGDX_with_JRE.zip.',
        },
        archive: /buildgdx.*\.(zip|7z)$/i,
        samples: ['BuildGDX_with_JRE.zip'],
        dirName: 'BuildGDX',
        entry: { exe: /^buildgdx\.exe$/i, platform: 'windows' },
        // No data linking: BuildGDX browses for each game folder on first run, and the one
        // Build game installed here (Witchaven II) keeps its data inside a 275MB ISO rather
        // than as loose files, so there is nothing to link even if we wanted to.
        data: null,
    },
    {
        id: 'cannonball',
        hosts: ['linux'],
        title: 'CannonBall',
        kind: 'Custom engine',
        game: 'OutRun',
        blurb: 'OutRun rewritten in C++ — 60fps, true widescreen, time trial and continuous modes. Not an emulator.',
        source: {
            name: 'GitHub — djyt/cannonball',
            url: 'https://github.com/djyt/cannonball/releases',
            hint: 'Download the Windows build from the Releases page. It needs the original OutRun arcade ROM set, which you must place in the folder yourself — nothing in a game library provides it.',
        },
        archive: /cannonball.*\.(zip|7z|rar)$/i,
        samples: ['cannonball.zip'],
        dirName: 'CannonBall',
        entry: { exe: /^cannonball\.exe$/i, platform: 'windows' },
        // Requiring the ROMs is what stops this installing into something that opens and
        // closes in the same second. Nothing in a game library provides them, so the
        // install asks for a folder — which is the only honest answer here.
        data: 'outrun',
    },
    {
        id: 'swos2020',
        hosts: ['linux'],
        title: 'SWOS 2020',
        kind: 'Fan game',
        game: '',
        blurb: 'Sensible World of Soccer rebuilt for modern machines by SWOS United — widescreen, USB controllers and updated team data.',
        source: {
            name: 'sensiblesoccer.de — SWOS 2020',
            url: 'https://sensiblesoccer.de/swos-2020',
            hint: 'Download the Windows build from the SWOS 2020 page — it is an installer named like swos2020_v7.7_setup.exe. It is unpacked rather than run, so no wizard.',
        },
        // Shipped as an NSIS setup.exe, not an archive — see findExtractor.
        archive: /swos.*\.(zip|7z|rar|exe)$/i,
        samples: ['swos2020_v7.7_setup.exe'],
        dirName: 'SWOS 2020',
        // Six executables ship here and most are traps — a DLC manager, a database browser,
        // an uninstaller, a VC redistributable. Only gameLauncher.exe starts the game.
        entry: { exe: /^gameLauncher\.exe$/i, platform: 'windows' },
        data: null,
    },
    // Quake mods are folders — pak0.pak, progs.dat, maps — loaded with `-game <folder>`
    // from the engine's own directory. Hundreds exist and they all work the same way, so
    // one entry serves them all rather than a recipe per mod. Generic, so it is only ever
    // chosen deliberately and never claims someone else's download.
    {
        id: 'quake-mod',
        hosts: ['linux'],
        title: 'Any Quake mod or episode',
        kind: 'Mod',
        game: 'Quake',
        engine: ['ironwail', 'vkquake', 'quake-rt'],
        onEngine: true,
        needsArchive: true,
        generic: true,
        blurb: 'Dwell, Arcane Dimensions, Alkaline, Copper — any mod that ships as a folder. It gets its own entry with Quake\'s data and every installed Quake engine beside it, so you pick the engine when you press Play.',
        source: {
            name: 'Quaddicted / ModDB / Slipseer',
            url: 'https://www.quaddicted.com/reviews/',
            hint: 'Download the mod archive — dwellv2p2.zip, ad_v1_80final.zip and so on. The folder inside it is what the engine loads.',
        },
        archive: /\.(zip|7z|rar|pak)$/i,
        dirName: 'Quake Mod',
        data: 'quake',
    },
    // A folder you already have, rather than a download. The catalogue lists it so it is
    // findable — Decadence, Duake and an assembled Dwell setup are all self-contained
    // folders with their own engine, and no recipe can improve on simply registering them.
    {
        id: 'folder',
        hosts: ['linux'],
        title: 'A game folder you already have',
        kind: 'Folder',
        game: '',
        folder: true,
        blurb: 'Point at any folder holding a Windows game and it joins your library, staying where it is. Best for anything self-contained — a fan game that ships its own engine, a mod setup you assembled yourself, or a port with no recipe here yet. Nothing is copied or moved.',
        source: {
            name: 'Your own disk',
            url: '',
            hint: 'Clarity scans three levels deep, sorts the likely entry point first, and lets you choose and name it.',
        },
        archive: null,
        dirName: '',
        data: null,
    },
    // ── Build games, one entry each ─────────────────────────────────────────
    // Filled in below from BUILD_GAMES so the list and the data specs cannot drift apart.
    // ── Mods ────────────────────────────────────────────────────────────────
    // These are what people actually want to play. Nobody sets out to install GZDoom;
    // they set out to install Brutal Doom, and the engine is a means to that end. So a
    // mod recipe owns its whole stack: it will install the engine for you if you have
    // not got one, link the IWAD out of your library, and register itself as its own
    // library entry carrying the -file line that loads it. The engine is shared rather
    // than copied per mod, because that is how GZDoom is designed to work.
    {
        id: 'brutaldoom',
        hosts: ['linux'],
        title: 'Brutal Doom',
        kind: 'Mod',
        game: 'Doom',
        engine: ['gzdoom', 'uzdoom'],
        blurb: 'The famous overhaul — reworked weapons, gore and enemy behaviour, on top of the original maps.',
        source: {
            name: 'ModDB — Brutal Doom',
            url: 'https://www.moddb.com/mods/brutal-doom/downloads',
            hint: 'Download the latest release; the file is named like brutalv22.zip, and a bare .pk3 works too.',
        },
        // Excludes Black Edition, whose download is also called Brutal_Doom_something.
        // Sibling recipes must be mutually exclusive or they silently mislabel each other.
        archive: /^brutal(?!.*black).*\.(zip|7z|rar|pk3)$/i,
        samples: ['brutalv22.zip', 'brutal22test6.zip', 'brutalv21.pk3'],
        modFile: /\.(pk3|wad)$/i,
        dirName: 'Brutal Doom',
        iwad: /^doom2\.wad$/i,
        data: 'doom',
    },
    {
        id: 'brutaldoom-black',
        hosts: ['linux'],
        title: 'Brutal Doom: Black Edition',
        kind: 'Mod',
        game: 'Doom',
        engine: ['gzdoom', 'uzdoom'],
        blurb: 'A darker, heavily reworked take on Brutal Doom, with its own lighting and effects.',
        source: {
            name: 'ModDB — Brutal Doom: Black Edition',
            url: 'https://www.moddb.com/mods/brutal-doom/downloads/brutal-doom-v20b-black-edition',
            hint: 'Download the latest release; the file is named like BDBE_v3.5.zip.',
        },
        archive: /^(bdbe|brutal.*black).*\.(zip|7z|rar|pk3)$/i,
        samples: ['Brutal_Doom_Black_Edition.52.zip'],
        modFile: /\.(pk3|wad)$/i,
        dirName: 'Brutal Doom Black Edition',
        iwad: /^doom2\.wad$/i,
        data: 'doom',
    },
    // A shape rather than a title, and honest about it. There is no single "DOOM Ultra HD"
    // download — HD texture work is spread across DHTP, Hoover1979's pack, brightmap and
    // sprite projects, and most people end up with an assembled folder of numbered .pk3s.
    // A recipe naming one of those would be pretending to a precision it does not have, so
    // this one accepts any Doom mod archive, shows what is inside, and lets the user choose
    // and order what loads. Excluded from filename detection because it would otherwise
    // claim every archive; it only ever runs when the user picks it deliberately.
    {
        id: 'doom-mod',
        hosts: ['linux'],
        title: 'Any Doom mod or texture pack',
        kind: 'Mod',
        game: 'Doom',
        engine: ['gzdoom', 'uzdoom'],
        generic: true,
        blurb: 'For anything else that loads into GZDoom or UZDoom — HD texture packs like DHTP, brightmaps, sprite fixes, map sets. Pick the archive and choose which .pk3 and .wad files to load; several can be stacked and they load in name order.',
        source: {
            name: 'ModDB — Doom mods',
            url: 'https://www.moddb.com/games/doom/mods',
            hint: 'Any .zip, .7z, .rar, .pk3 or .wad. You will be shown everything loadable inside it and can tick as many as you want.',
        },
        archive: /\.(zip|7z|rar|pk3|wad)$/i,
        modFile: /\.(pk3|wad)$/i,
        dirName: 'Doom Mods',
        data: 'doom',
    },
    // Not a title but a shape. Every OpenBOR game is the same engine renamed, sitting
    // beside Paks/<game>.pak — so one recipe covers all of them, and the archive is
    // identified by what is inside rather than by whatever the download was called.
    // This is the same argument that made native DOSBox worth supporting: one engine,
    // one rigid layout, nothing to curate per game.
    {
        id: 'openbor',
        hosts: ['linux'],
        title: 'OpenBOR game',
        kind: 'OpenBOR',
        game: '',
        dynamic: true,
        blurb: 'Any OpenBOR game — Streets of Rage X, Streets of Vendetta and the rest. Drop in the archive you downloaded and the name is taken from the game itself.',
        source: {
            name: 'ChronoCrash — the OpenBOR community',
            url: 'https://www.chronocrash.com/forum/resources/',
            hint: 'Download the Windows build of any OpenBOR game — a zip or rar containing the game exe and a Paks folder.',
        },
        archive: /\.(zip|7z|rar)$/i,
        contains: { pak: /(^|\/)Paks\/[^/]+\.pak$/i },
        dirName: 'OpenBOR',
        entry: { exe: /\.exe$/i, platform: 'windows' },
        data: null,
        category: 'OpenBOR',
    },
];

// ── Game data the ports need ─────────────────────────────────────────────────
// A data spec says which folders the engine expects and the file that proves a candidate
// folder is the real thing. Probing for the file rather than trusting the title is what
// makes this safe: a library row can be named anything, but only a genuine Quake install
// has id1/pak0.pak in it.
const DATA_SPECS = {
    quake: {
        label: 'Quake (the original 1996 release)',
        // Ports look for lowercase names; GOG ships Id1/PAK0.PAK. Resolution is
        // case-insensitive on both sides and the links we create use the lowercase
        // names the engines actually ask for.
        dirs: [
            { name: 'id1',      probe: /^pak0\.pak$/i, required: true },
            { name: 'hipnotic', probe: /^pak0\.pak$/i },   // Scourge of Armagon
            { name: 'rogue',    probe: /^pak0\.pak$/i },   // Dissolution of Eternity
        ],
        // Narrow the candidates by name, then confirm by probing. Quake Enhanced is
        // excluded on purpose: it is the KEX remaster and its data is not id1 paks.
        titles: [/^quake(:? the offering)?$/i, /^quake the offering/i],
        exclude: [/enhanced/i, /\bii\b|^quake ?2/i],
        owned: 'You own Quake but it is not installed. Install it first and this will find it automatically.',

        // The soundtrack, from a *different* product. The 1996 release keeps its music on
        // the CD, which is why GLQuake is silent and why every port ships a note about
        // needing external tracks. The 2021 re-release ships the same music as ogg — so a
        // player who owns both (very common: GOG bundles them) already has, legitimately
        // on disk, exactly the files these engines want.
        //
        // Not a nicety: vkQuake-RT refuses to start cleanly without id1/music/track02..11
        // and offers to go copy them out of a Steam install. Providing them up front is
        // the difference between a clean launch and a dialog the user has to interpret.
        extras: [{
            id: 'quake-music',
            label: 'Quake soundtrack (from the re-release)',
            titles: [/quake.*enhanced|enhanced.*quake|quake.*re-?release/i],
            // Both the GOG re-release layout (id1/music) and Steam's (rerelease/id1/music).
            roots: ['', 'rerelease'],
            subdir: 'music',
            match: /^track\d+\.ogg$/i,
        }],
    },

    // Named by file rather than by folder: every storefront nests the IWAD somewhere
    // different (GOG's classic releases put it at the root, the 2024 re-release hides it
    // under rerelease/), and they move it between releases. Searching for the file itself
    // is what lets one spec survive all of those layouts.
    doom: {
        label: 'Doom or Doom II',
        files: [{ find: /^(doom|doom2|doomu|tnt|plutonia)\.wad$/i, into: '' }],
        requireAny: true,
        titles: [/^(the ultimate )?doom$/i, /^doom \+ doom ii/i, /^doom ii/i, /^final doom$/i, /^doom (i|ii) enhanced$/i, /^doom$/i],
        exclude: [/doom 3|doom 64|eternal|dark ages|\(2016\)|resurrection|phobos|akalabeth/i],
        owned: 'You own Doom but it is not installed. Install it first and this will find the IWAD automatically.',
    },

    // Wolfenstein's whole data set shares one extension per release — VSWAP, MAPHEAD,
    // GAMEMAPS, AUDIOHED, AUDIOT, VGAHEAD, VGADICT, VGAGRAPH are all .WL6 for the full
    // game, .WL1 for shareware, .SOD/.SD1-3 for Spear of Destiny. So one pattern per
    // release takes the complete set and there is no list of filenames to get wrong.
    wolf3d: {
        label: 'Wolfenstein 3D or Spear of Destiny',
        files: [{ find: /\.(wl6|wl1|sod|sd[123])$/i, into: '' }],
        requireAny: true,
        titles: [/wolfenstein\s*3-?d/i, /spear of destiny/i],
        // The modern shooters share the name and have nothing to do with this.
        exclude: [/new order|old blood|new colossus|youngblood|cyberpilot|enemy territory|return to castle/i],
        owned: 'You own Wolfenstein 3D but it is not installed. Install it first and this will find the data automatically.',
    },

    // Build games keep everything in one or two big containers: DUKE3D.GRP, SW.GRP,
    // BLOOD.RFF and its companions. Blood is the fussy one — it wants its .ART tiles and
    // BLOOD.INI beside the RFF — so those are taken too when present.
    build: {
        label: 'a Build engine game (Duke 3D, Blood, Shadow Warrior, Powerslave…)',
        files: [
            { find: /\.(grp|rff)$/i, into: '' },
            { find: /\.art$/i,       into: '' },
            { find: /^blood\.ini$/i, into: '' },
        ],
        requireAny: true,
        titles: [/duke nukem 3d/i, /^blood/i, /shadow warrior classic/i, /^powerslave$|^exhumed$/i, /redneck rampage/i, /nam$|^nam\b/i, /wwii gi/i],
        // PowerSlave *Exhumed* is Nightdive's 2022 KEX remaster and carries no Build data,
        // the same trap as Quake Enhanced. The probe would reject it anyway, but naming it
        // in "you own…" would send someone to install 3GB that cannot help.
        exclude: [/powerslave exhumed|exhumed \(2022\)/i,
                  /forever|manhattan|blood west|blood omen|bloodstained|bloodlines|shadow warrior \(?20(13|16)|shadow warrior [23]/i],
        owned: 'You own a Build engine game but it is not installed. Install it first and this will find the data automatically.',
    },
};

// One spec per Build game, because each is its own library entry now. They share a shape:
// a main container file that proves the game is there, plus whatever loose art and config
// sits beside it. Blood is the fussy one and needs all three.
const BUILD_GAMES = {
    blood: {
        label: 'Blood', main: /^blood\.rff$/i, extra: [/\.rff$/i, /\.art$/i, /^blood\.ini$/i],
        titles: [/^blood:?\s*(fresh supply|one unit whole blood)?$/i, /^blood\b/i],
        exclude: [/west|omen|bloodstained|bloodlines|rayne|money|dragon/i],
    },
    duke3d: {
        label: 'Duke Nukem 3D', main: /^duke3d\.grp$/i, extra: [/\.grp$/i, /\.art$/i, /^duke3d\.def$/i],
        titles: [/duke nukem 3d/i],
        exclude: [/forever|manhattan|megaton.*soundtrack/i],
    },
    shadowwarrior: {
        label: 'Shadow Warrior (1997)', main: /^sw\.grp$/i, extra: [/\.grp$/i, /\.art$/i],
        titles: [/shadow warrior classic/i, /shadow warrior \(1997\)/i],
        exclude: [/\(?20(13|16)\)?|shadow warrior [23]/i],
    },
    powerslave: {
        // The DOS original keeps everything in STUFF.DAT. Nightdive's 2022 remaster is a
        // different game entirely and is excluded — it has no Build data at all.
        label: 'PowerSlave / Exhumed (the 1996 DOS game)', main: /^stuff\.dat$/i, extra: [/\.dat$/i, /\.art$/i],
        titles: [/^powerslave$/i, /^exhumed$/i],
        exclude: [/exhumed|remaster/i],
    },
    redneck: {
        label: 'Redneck Rampage', main: /^redneck\.grp$/i, extra: [/\.grp$/i, /\.art$/i],
        titles: [/redneck rampage/i], exclude: [],
    },
    // Witchaven never used a .GRP — its data is loose files, and GOG never unpacks them:
    // the release is a DOSBox setup around a 275MB .iso. Only BuildGDX plays these, and
    // only once the disc has been opened, which is what `imageDir` is for.
    witchaven: {
        label: 'Witchaven', main: /^tiles000\.art$/i, extra: [/\.art$/i, /\.dat$/i, /\.map$/i],
        titles: [/^witchaven$/i, /witchaven i\b/i, /witchaven i ?& ?ii/i],
        exclude: [/witchaven ii|witchaven 2/i],
        dataDir: /^WHAVEN$/i, imageDir: /^WHAVEN\//i, engines: ['buildgdx'], gdxApp: 'WitchavenGDX', gdxGame: 'Witchaven',
    },
    witchaven2: {
        label: 'Witchaven II: Blood Vengeance', main: /^tiles000\.art$/i, extra: [/\.art$/i, /\.dat$/i, /\.map$/i],
        titles: [/witchaven ii/i, /witchaven 2/i, /witchaven i ?& ?ii/i],
        exclude: [],
        dataDir: /^WHAVEN2$/i, imageDir: /^WHAVEN2\//i, engines: ['buildgdx'], gdxApp: 'Witchaven2GDX', gdxGame: 'Witchaven II',
    },
};

// CannonBall wants OutRun **Revision B** specifically, and it is all-or-nothing: a set
// missing one ROM starts and closes in the same second, with no message. So the whole
// manifest is checked up front and the missing names are reported. This is CannonBall's
// own roms.txt list, verbatim.
const OUTRUN_REV_B = [
    'epr-10187.88', 'epr-10327a.76', 'epr-10328a.75', 'epr-10329a.58', 'epr-10330a.57',
    'epr-10380b.133', 'epr-10381a.132', 'epr-10382b.118', 'epr-10383b.117',
    'mpr-10371.9', 'mpr-10372.13', 'mpr-10373.10', 'mpr-10374.14',
    'mpr-10375.11', 'mpr-10376.15', 'mpr-10377.12', 'mpr-10378.16',
    'opr-10185.11', 'opr-10186.47', 'opr-10188.71', 'opr-10189.70', 'opr-10190.69',
    'opr-10191.68', 'opr-10192.67', 'opr-10193.66', 'opr-10230.104', 'opr-10231.103',
    'opr-10232.102', 'opr-10266.101', 'opr-10267.100', 'opr-10268.99',
];

DATA_SPECS.outrun = {
    label: 'the OutRun Revision B arcade ROM set',
    mainFile: /^epr-1038\d[a-z]?\.\d+$/i,
    requireAllOf: OUTRUN_REV_B,
    // Everything matching comes along, so the optional Japanese-course ROMs and the fixed
    // audio ROM are carried over too when the user has them. CannonBall reads from roms/,
    // per its own config.xml.
    files: [{ find: /^(epr|mpr|opr)-\d+[a-z]?\.[\w.]+$/i, into: 'roms' }],
    requireAny: true,
    titles: [],          // no storefront sells these; the folder picker is the only route
    exclude: [],
    userSupplied: true,
    owned: 'CannonBall needs the original OutRun Revision B arcade ROM set. No game library provides it — point at the folder holding your own copy.',
};

// Each Build game is its own catalogue entry, running on whichever engine is installed.
// Nobody wants "Raze" in their library; they want Blood, and Duke Nukem 3D, each with its
// own name and its own cover.
const BUILD_BLURB = {
    blood: 'Monolith\'s 1997 shooter — cultists, a pitchfork, and the best voice acting of the era. Runs on Raze.',
    duke3d: 'Hail to the king. The 1996 original with all four episodes, running on Raze.',
    shadowwarrior: 'Lo Wang, katanas and sticky bombs — the 1997 original, running on Raze.',
    powerslave: 'The 1996 DOS original (Exhumed in Europe), not the 2022 remaster. Egyptian tombs and a genuinely strange structure.',
    redneck: 'Cuss, Bubba and a hillbilly arsenal, from 1997.',
    witchaven: 'The 1995 sword-and-sorcery Build game. GOG never unpacks it — the data is lifted straight out of the disc image. Plays on BuildGDX.',
    witchaven2: 'The 1996 sequel, bloodier and better lit. Data lifted out of the disc image; plays on BuildGDX.',
};
for (const [id, g] of Object.entries(BUILD_GAMES)) {
    RECIPES.push({
        id: `build-game-${id}`,
        hosts: ['linux'],
        title: g.label.replace(/ \(.*\)$/, ''),
        kind: 'Game',
        game: 'Build engine games',
        engine: g.engines || ['raze', 'buildgdx'],
        onEngine: true,                       // no download of its own — engine + data
        blurb: BUILD_BLURB[id],
        source: {
            name: 'GitHub — ZDoom/Raze',
            url: 'https://github.com/ZDoom/Raze/releases/latest',
            hint: 'No download needed for the game itself. If Raze is not installed yet you will be asked for its Windows zip once, and every Build game after that reuses it.',
        },
        dirName: g.label.replace(/ \(.*\)$/, '').replace(/[/\\:*?"<>|]/g, ''),
        gdxApp: g.gdxApp || null,
        gdxGame: g.gdxGame || null,
        data: `build-${id}`,
    });
}

// Expand the compact table above into full data specs.
for (const [id, g] of Object.entries(BUILD_GAMES)) {
    DATA_SPECS[`build-${id}`] = {
        label: g.label,
        // The container proves the game is really there. Without this a folder holding one
        // stray .art would pass as Blood, and the install would produce an empty shell.
        mainFile: g.main,
        dataDir: g.dataDir || null,
        imageDir: g.imageDir || null,
        files: [{ find: g.main, into: '' }, ...g.extra.map(rx => ({ find: rx, into: '' }))],
        requireAny: true,
        titles: g.titles,
        exclude: g.exclude,
        owned: `You own ${g.label} but it is not installed. Install it, or point at a folder holding your own copy of the game files.`,
    };
}

// ── Catalogue self-check ─────────────────────────────────────────────────────
// Two mistakes have cost real installs here, and both were invisible at the time: a
// pattern that also matched a sibling's download (Mini Doom 2 installed as Mini Doom;
// Black Edition matching Brutal Doom too), and a pattern anchored to an asset name that
// was guessed rather than checked (UZDoom ships Windows-UZDoom-4.14.3.zip, so /^uzdoom/
// rejected the only file it was meant to accept).
//
// So every recipe carries `samples` — filenames actually observed from that project —
// and this asserts each one matches its own recipe and nothing else. Run it whenever a
// recipe is added or a pattern changed.
function selfCheck() {
    const problems = [];
    for (const r of RECIPES) {
        // Every recipe declares the hosts it is valid on. The catalogue is a Linux one today
        // — each entry points at a Windows download run through a compatibility layer — and a
        // macOS catalogue built from native source-port releases will live alongside it here
        // rather than in a fork. An untagged recipe would silently be offered on both.
        if (!Array.isArray(r.hosts) || !r.hosts.length) { problems.push(`${r.id}: no hosts declared`); continue; }
        if (r.contains || r.generic || r.onEngine || r.folder) continue;   // no archive of their own
        if (!r.samples || !r.samples.length) { problems.push(`${r.id}: no samples to check`); continue; }
        for (const s of r.samples) {
            const m = detectRecipe(s);
            if (!m.includes(r.id))  problems.push(`${r.id}: its own sample "${s}" does not match its pattern`);
            if (m.length > 1)       problems.push(`"${s}" matches several recipes: ${m.join(' + ')}`);
        }
    }
    return problems;
}

// ── Small helpers ────────────────────────────────────────────────────────────

function resolveCaseInsensitive(dir, name) {
    try {
        const hit = fs.readdirSync(dir, { withFileTypes: true })
            .find(e => e.name.toLowerCase() === String(name).toLowerCase());
        return hit ? path.join(dir, hit.name) : '';
    } catch { return ''; }
}

function dirHasProbe(dir, probe) {
    try { return fs.readdirSync(dir).some(f => probe.test(f)); }
    catch { return false; }
}

// bsdtar first: one binary that reads zip, 7z, rar and tar alike. unzip is the fallback
// and only covers zip.
//
// Windows installers are the exception. Plenty of projects ship a setup.exe rather than an
// archive — SWOS 2020 is an NSIS installer — and bsdtar cannot read those at all, while 7z
// unpacks them happily without running anything. Running the installer under Proton would
// be the alternative, and it would mean a wizard, an install path we do not control, and a
// registry write for something that is meant to sit in its own folder.
function findExtractor(archivePath) {
    const ext = path.extname(archivePath).toLowerCase();
    const sevenZip = which('7z') || which('7za') || which('7zz');
    if (ext === '.exe') {
        return sevenZip ? { cmd: sevenZip, args: (a, d) => ['x', '-y', `-o${d}`, a] } : null;
    }
    const bsdtar = which('bsdtar');
    if (bsdtar) return { cmd: bsdtar, args: (a, d) => ['-xf', a, '-C', d] };
    if (sevenZip) return { cmd: sevenZip, args: (a, d) => ['x', '-y', `-o${d}`, a] };
    if (ext === '.zip') {
        const unzip = which('unzip');
        if (unzip) return { cmd: unzip, args: (a, d) => ['-q', '-o', a, '-d', d] };
    }
    return null;
}

// Installer plumbing that is never the game: NSIS's own scratch folder and the
// redistributables setups bundle for the benefit of Windows.
// The leading $ is required, not optional. NSIS names its scratch folders $PLUGINSDIR and
// $TEMP; a plain "temp" is the game's own working directory and deleting it breaks the
// game — SWOS writes its pitch and background data there and refuses to start without it.
const INSTALLER_JUNK = /^\$(PLUGINSDIR|TEMP)$|^(vc_?redist|dxwebsetup|dotnet).*\.exe$/i;
const INSTALLER_JUNK_PATH = /(^|\/)\$(PLUGINSDIR|TEMP)\//i;

// Unpack a Windows installer by naming the members we want. Asking 7z for the whole thing
// fails on NSIS-2 with E_NOTIMPL partway through — it stumbles over the installer's own
// script and scratch entries — but extracting the payload by name succeeds cleanly. So:
// list, drop the plumbing, take the rest.
function extractInstaller(archivePath, target) {
    const sevenZip = which('7z') || which('7za') || which('7zz');
    if (!sevenZip) return { ok: false, error: 'Unpacking a Windows installer needs 7z (p7zip).' };

    const members = inspectArchive(archivePath)
        .filter(m => !INSTALLER_JUNK_PATH.test(m) && !INSTALLER_JUNK.test(path.basename(m)));
    if (!members.length) return { ok: false, error: 'Nothing usable was found inside that installer.' };

    const res = spawnSync(sevenZip, ['x', '-y', `-o${target}`, archivePath, ...members],
                          { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    // 7z still reports a non-zero status for the entries it skipped; what matters is
    // whether anything actually landed.
    let got = [];
    try { got = fs.readdirSync(target); } catch {}
    if (!got.length) {
        return { ok: false, error: `Could not unpack that installer: ${(res.stderr || res.stdout || '').trim().slice(0, 200)}` };
    }
    return { ok: true };
}

// An installer often carries the payload as a second archive inside itself — SWOS 2020's
// setup.exe holds an 83MB data.7z. One level of unwrapping, and only when the first pass
// produced no executable, so this never fires for a normal download.
function unwrapNestedArchive(dir) {
    let inner = [];
    try {
        inner = fs.readdirSync(dir, { withFileTypes: true })
            .filter(e => e.isFile() && /\.(7z|zip|rar|tar|gz|xz|cab)$/i.test(e.name))
            .map(e => path.join(dir, e.name));
    } catch { return false; }
    if (!inner.length) return false;

    // The payload is the big one; a small extra zip beside it is usually documentation.
    inner.sort((a, b) => {
        try { return fs.statSync(b).size - fs.statSync(a).size; } catch { return 0; }
    });
    const ex = findExtractor(inner[0]);
    if (!ex) return false;
    const res = spawnSync(ex.cmd, ex.args(inner[0], dir), { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (res.status !== 0) return false;
    try { fs.unlinkSync(inner[0]); } catch {}
    return true;
}

// Strip the installer's own scaffolding so it cannot be mistaken for the game.
function dropInstallerJunk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        if (!INSTALLER_JUNK.test(e.name)) continue;
        try { fs.rmSync(path.join(dir, e.name), { recursive: true, force: true }); } catch {}
    }
}

function which(bin) {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (!dir) continue;
        const p = path.join(dir, bin);
        try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
    }
    return '';
}

// Projects are inconsistent about whether the zip has a top-level folder. Collapse one if
// it is the only thing there, so every recipe below can assume a flat install directory.
function flattenSingleRoot(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.length !== 1 || !entries[0].isDirectory()) return;
    const inner = path.join(dir, entries[0].name);
    for (const name of fs.readdirSync(inner)) {
        fs.renameSync(path.join(inner, name), path.join(dir, name));
    }
    try { fs.rmdirSync(inner); } catch {}
}

// List an archive without unpacking it, so a download can be identified by what is inside
// rather than by what someone named the file. OpenBOR needs this: every one of its games is
// a differently-named archive around an identical layout.
function inspectArchive(archivePath) {
    // A Windows installer is not something bsdtar can read; 7z can list it. -slt gives one
    // "Path = …" per entry, which beats parsing the column layout.
    if (path.extname(archivePath).toLowerCase() === '.exe') {
        const sevenZip = which('7z') || which('7za') || which('7zz');
        if (!sevenZip) return [];
        const r = spawnSync(sevenZip, ['l', '-slt', archivePath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        if (r.status !== 0) return [];
        return r.stdout.split('\n')
            .filter(l => l.startsWith('Path = '))
            .map(l => l.slice(7).trim())
            .filter(p => p && p !== archivePath);
    }
    const bsdtar = which('bsdtar');
    if (bsdtar) {
        const r = spawnSync(bsdtar, ['-tf', archivePath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        if (r.status === 0) return r.stdout.split('\n').filter(Boolean);
    }
    const unzip = which('unzip');
    if (unzip && path.extname(archivePath).toLowerCase() === '.zip') {
        const r = spawnSync(unzip, ['-Z1', archivePath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        if (r.status === 0) return r.stdout.split('\n').filter(Boolean);
    }
    return [];
}

// Depth-limited recursive search for data files. Used by the specs that name a file
// (DOOM.WAD) rather than a folder, because storefronts nest those differently and often
// move them between releases — searching is what makes one spec survive all the layouts.
function findFiles(root, pattern, maxDepth = 4) {
    const out = [];
    const walk = (dir, depth) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            // A Dirent for a symlink reports neither isFile nor isDirectory, so following
            // it matters: this feature links data in with symlinks itself, and a user's
            // own folder can perfectly well be one.
            let isFile = e.isFile(), isDir = e.isDirectory();
            if (e.isSymbolicLink()) {
                try { const st = fs.statSync(p); isFile = st.isFile(); isDir = st.isDirectory(); }
                catch { continue; }   // broken link
            }
            if (isFile && pattern.test(e.name)) out.push(p);
            else if (isDir && depth < maxDepth) walk(p, depth + 1);
        }
    };
    walk(root, 0);
    return out;
}

// Depth-limited hunt for the entry point. Shallow on purpose — an .exe buried four levels
// down is a redistributable or a tool, not the game.
// The executable that lives beside a marker directory. OpenBOR's engine is renamed to the
// game, so position is the only thing that identifies it.
function findEntryBesideDir(root, dirPattern, exePattern, maxDepth = 3) {
    const walk = (dir, depth) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ''; }
        if (entries.some(e => e.isDirectory() && dirPattern.test(e.name))) {
            const exe = entries.find(e => e.isFile() && exePattern.test(e.name));
            if (exe) return path.join(dir, exe.name);
        }
        if (depth >= maxDepth) return '';
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const hit = walk(path.join(dir, e.name), depth + 1);
            if (hit) return hit;
        }
        return '';
    };
    return walk(root, 0);
}

function findEntry(root, pattern, maxDepth = 3) {
    const walk = (dir, depth) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ''; }
        for (const e of entries) {
            if (e.isFile() && pattern.test(e.name)) return path.join(dir, e.name);
        }
        if (depth >= maxDepth) return '';
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const hit = walk(path.join(dir, e.name), depth + 1);
            if (hit) return hit;
        }
        return '';
    };
    return walk(root, 0);
}

// ── Public API ───────────────────────────────────────────────────────────────

function listRecipes() {
    return RECIPES.map(r => ({
        id: r.id, title: r.title, kind: r.kind, game: r.game, blurb: r.blurb,
        source: r.source, dirName: r.dirName, dynamic: !!r.dynamic, generic: !!r.generic,
        // needsArchive must travel with onEngine: an engine-based recipe normally has
        // nothing to download, and a Quake mod is the exception that does.
        onEngine: !!r.onEngine, needsArchive: !!r.needsArchive, folder: !!r.folder,
        data: r.data ? { id: r.data, label: DATA_SPECS[r.data]?.label || r.data } : null,
    }));
}

function getRecipe(id) { return RECIPES.find(r => r.id === id) || null; }

// Which recipe does this download belong to? Returned as a list because a user could
// plausibly have a file that two recipes would both accept.
// Shape-based recipes are excluded: their archive pattern is deliberately "any archive",
// so including them here would have every download claimed by OpenBOR. Those are matched
// by content at install time instead.
function detectRecipe(fileName) {
    const base = path.basename(String(fileName || ''));
    return RECIPES.filter(r => !r.contains && !r.generic && r.archive && r.archive.test(base)).map(r => r.id);
}

// Find the user's own copy of the data a recipe needs.
//   { ok: true, path }                     → found, on disk, probed and confirmed
//   { ok: false, owned: [...], message }   → they own it but it is not installed
//   { ok: false, message }                 → nothing in the library matches
// `rows` is library.db's games table; passing it in keeps this module free of any
// database handle of its own.
// ── Data sealed inside a disc image ──────────────────────────────────────────
// GOG ships several of its DOSBox releases as an .iso the bundled DOSBox mounts, so the
// game's files never exist loose on disk — Witchaven II is 275MB of exactly that. A source
// port cannot mount an image, so the files have to come out of it. bsdtar reads ISO9660
// directly, which means no mounting, no root, and no loop device.
const DISC_IMAGE = /\.(iso|cue|bin|gog|img|mdf)$/i;

// The disc image inside `root` that holds `mainFile`, or ''. Listing an image is cheap;
// this only runs when the loose files are absent.
function findDataImage(root, spec, maxDepth = 3) {
    const mainFile = spec instanceof RegExp ? spec : spec.mainFile;
    const imageDir = spec instanceof RegExp ? null : spec.imageDir;
    for (const img of findFiles(root, DISC_IMAGE, maxDepth)) {
        const entries = inspectArchive(img);
        // When the spec names a directory inside the disc, that is what identifies the
        // game. Checking only the container file would let Witchaven II's disc satisfy
        // Witchaven I, since TILES000.ART is generic Build data present in both.
        if (imageDir) { if (entries.some(e => imageDir.test(e))) return img; continue; }
        if (mainFile && entries.some(e => mainFile.test(path.basename(e)))) return img;
    }
    return '';
}

// Pull every file a spec wants out of a disc image. Real copies, not symlinks — there is
// nothing on disk to point at. Extracted flat: these images are one game per disc and the
// engine expects its data beside it.
function extractFromImage(img, spec, target) {
    const entries = inspectArchive(img).filter(e => !e.endsWith('/'));
    const bsdtar = which('bsdtar');
    if (!bsdtar) return { ok: false, error: 'bsdtar (libarchive) is needed to read disc images.' };

    // A disc usually holds the whole game directory — Witchaven's WHAVEN2/ carries its
    // maps, palettes and sound banks in subfolders. When the spec names that directory,
    // take it entire and keep its shape; picking files out flat would strip the folders
    // the game reads its sounds from. Otherwise fall back to matching by filename.
    const inDir = spec.imageDir ? entries.filter(e => spec.imageDir.test(e)) : [];
    const wanted = inDir.length ? inDir
                                : entries.filter(e => (spec.files || []).some(f => f.find.test(path.basename(e))));
    if (!wanted.length) return { ok: false, error: `Nothing matching ${spec.label} was found inside ${path.basename(img)}.` };

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-iso-'));
    try {
        const res = spawnSync(bsdtar, ['-xf', img, '-C', tmp, ...wanted], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        if (res.status !== 0) return { ok: false, error: `Could not read ${path.basename(img)}: ${(res.stderr || '').trim().slice(0, 200)}` };

        const out = [];
        if (inDir.length) {
            // Strip the disc's own top folder so the data lands beside the engine.
            const prefix = inDir[0].split('/')[0] + '/';
            for (const rel of inDir) {
                const src = path.join(tmp, rel);
                if (!fs.existsSync(src)) continue;
                const dst = path.join(target, rel.startsWith(prefix) ? rel.slice(prefix.length) : path.basename(rel));
                fs.mkdirSync(path.dirname(dst), { recursive: true });
                fs.copyFileSync(src, dst);
                out.push(path.basename(rel));
            }
        } else {
            const seen = new Set();
            for (const rel of wanted.sort((a, b) => a.split('/').length - b.split('/').length)) {
                const name = path.basename(rel).toLowerCase();
                if (seen.has(name)) continue;
                const src = path.join(tmp, rel);
                if (!fs.existsSync(src)) continue;
                seen.add(name);
                fs.copyFileSync(src, path.join(target, name));
                out.push(name);
            }
        }
        return out.length ? { ok: true, linked: out } : { ok: false, error: `Could not extract ${spec.label} from ${path.basename(img)}.` };
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ── Games whose data is a whole directory ────────────────────────────────────
// Some games are not one container file but a folder of loose parts. Witchaven's are
// TILES000.ART, TABLES.DAT, PALETTE.DAT, LOOKUP.DAT, the LEVEL*.MAP set, and two
// extension-less files named SONGS and JOESND — so any spec written as a list of
// extensions misses half of it, which is precisely what BuildGDX reported.
//
// Naming the directory solves the other half too. TILES000.ART is generic Build data and
// appears in every one of these games, so it cannot tell Witchaven from Witchaven II —
// both specs happily accepted the other's files. WHAVEN/ and WHAVEN2/ can.
function findDataDir(root, spec, maxDepth = 4) {
    if (!spec.dataDir) return '';
    const walk = (dir, depth) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ''; }
        for (const e of entries) {
            if (!e.isDirectory() && !e.isSymbolicLink()) continue;
            const p = path.join(dir, e.name);
            if (spec.dataDir.test(e.name) && (!spec.mainFile || dirHasProbe(p, spec.mainFile))) return p;
            if (depth < maxDepth) { const hit = walk(p, depth + 1); if (hit) return hit; }
        }
        return '';
    };
    // The directory may itself be what was handed to us.
    if (spec.dataDir.test(path.basename(root)) && (!spec.mainFile || dirHasProbe(root, spec.mainFile))) return root;
    return walk(root, 0);
}

// Reproduce a directory tree: symlink each entry, or copy it when the source is the
// user's own folder and might not stay where it is.
function mirrorTree(src, dst, copy) {
    fs.mkdirSync(dst, { recursive: true });
    const out = [];
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path.join(src, e.name);
        const to = path.join(dst, e.name.toLowerCase());
        try { fs.rmSync(to, { recursive: true, force: true }); } catch {}
        let isDir = e.isDirectory();
        if (e.isSymbolicLink()) { try { isDir = fs.statSync(from).isDirectory(); } catch { continue; } }
        if (copy) {
            if (isDir) fs.cpSync(from, to, { recursive: true });
            else fs.copyFileSync(from, to);
        } else {
            fs.symlinkSync(from, to);
        }
        out.push(e.name);
    }
    return out;
}

// Does this folder actually hold the data a spec needs? The same test whether the folder
// came from the library or the user pointed at it — a shelf of DOS files they still have
// is every bit as valid a source as a storefront install, and quite often the only one.
function folderSatisfies(spec, root) {
    if (!root || !fs.existsSync(root)) return false;
    // Folder-shaped: every required folder must exist and hold its proving file.
    const dirsOk = (spec.dirs || []).filter(d => d.required).every(d => {
        const dir = resolveCaseInsensitive(root, d.name);
        return dir && dirHasProbe(dir, d.probe);
    });
    // An all-or-nothing set: every named file must be there, or the game starts and dies
    // without a word. Reported by name so the gap is actionable.
    if (spec.requireAllOf) return dirsOk && missingFrom(spec, root).length === 0;

    // A named data directory is the strictest test and the one that tells sibling games
    // apart, so it wins when a spec has one — on disk, or inside a disc image.
    if (spec.dataDir) {
        return dirsOk && (!!findDataDir(root, spec) || !!findDataImage(root, spec));
    }

    // A named container settles it on its own when the spec has one — loose on disk, or
    // sealed inside a disc image the release never unpacked.
    if (spec.mainFile) {
        return dirsOk && (findFiles(root, spec.mainFile).length > 0 || !!findDataImage(root, spec));
    }
    // Otherwise: at least one of the named files must turn up somewhere inside.
    const filesOk = spec.files ? spec.files.some(f => findFiles(root, f.find).length > 0) : true;
    return dirsOk && filesOk;
}

// Which files of an all-or-nothing set are absent from a folder.
function missingFrom(spec, root) {
    if (!spec.requireAllOf) return [];
    const have = new Set(findFiles(root, /./, 4).map(f => path.basename(f).toLowerCase()));
    return spec.requireAllOf.filter(n => !have.has(n.toLowerCase()));
}

// Validate a folder the user chose themselves, so the failure is reported before anything
// is unpacked and says which files were expected rather than just "no".
function resolveDataFolder(dataId, folder) {
    const spec = DATA_SPECS[dataId];
    if (!spec) return { ok: false, message: `Unknown data requirement "${dataId}".` };
    if (!folder || !fs.existsSync(folder)) return { ok: false, message: 'That folder no longer exists.' };
    if (!folderSatisfies(spec, folder)) {
        if (spec.requireAllOf) {
            const missing = missingFrom(spec, folder);
            // A near-complete set is a different problem from the wrong folder entirely,
            // and deserves a different sentence.
            return { ok: false, message: missing.length === spec.requireAllOf.length
                ? `No part of ${spec.label} is in that folder.`
                : `That set is incomplete — ${missing.length} of ${spec.requireAllOf.length} ROMs are missing: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? `, and ${missing.length - 6} more` : ''}. CannonBall needs the full Revision B set or it will not start.` };
        }
        const want = (spec.files || []).map(f => f.find.source.replace(/[\\^$()?:]/g, '').replace(/\|/g, ', '))
            .concat((spec.dirs || []).filter(d => d.required).map(d => `${d.name}/`)).join(' or ');
        return { ok: false, message: `That folder does not contain ${spec.label}. Looking for ${want}. Point at the folder holding the game's own data files.` };
    }
    return { ok: true, path: folder, paths: [folder], title: path.basename(folder) };
}

function resolveGameData(dataId, rows) {
    const spec = DATA_SPECS[dataId];
    if (!spec) return { ok: false, message: `Unknown data requirement "${dataId}".` };

    const named = (rows || []).filter(g => {
        const t = String(g.title || '');
        if (spec.exclude && spec.exclude.some(rx => rx.test(t))) return false;
        return spec.titles.some(rx => rx.test(t));
    });

    const hits = [];
    for (const g of named.filter(g => g.installed && g.install_path)) {
        if (folderSatisfies(spec, g.install_path)) hits.push({ path: g.install_path, title: g.title });
    }
    // File-shaped specs take from *every* matching product rather than the first, so
    // owning Ultimate Doom, Final Doom and both Enhanced releases puts doom.wad, doom2.wad,
    // tnt.wad and plutonia.wad side by side and the engine can offer the choice.
    if (hits.length) {
        return spec.files
            ? { ok: true, path: hits[0].path, paths: hits.map(h => h.path), title: hits.map(h => h.title).join(', ') }
            : { ok: true, path: hits[0].path, paths: [hits[0].path], title: hits[0].title };
    }

    const owned = named.map(g => g.title);
    if (owned.length) return { ok: false, owned, message: spec.owned || 'Install it first.' };
    // Some data was never sold in a form a library can hold — arcade ROMs, files off an
    // old disc. Reporting that as a failed library search reads like something is wrong
    // and invites the user to go looking for a purchase that does not exist.
    if (spec.userSupplied) return { ok: false, userSupplied: true, message: spec.owned || `You provide ${spec.label} yourself.` };
    return { ok: false, message: `No copy of ${spec.label} found in your library.` };
}

// A second product in the library that can contribute optional files — the re-release's
// ogg soundtrack being the case this exists for. Returns null when nothing suitable is
// installed, which is never an error: the port still works, it is just quieter.
function resolveExtra(extra, rows) {
    for (const g of (rows || [])) {
        if (!g.installed || !g.install_path) continue;
        if (!extra.titles.some(rx => rx.test(String(g.title || '')))) continue;
        for (const rel of extra.roots) {
            const base = rel ? resolveCaseInsensitive(g.install_path, rel) : g.install_path;
            if (!base) continue;
            // Confirm by looking for the files themselves under a known dir, not by trusting
            // the layout: the two storefronts nest this differently.
            const id1 = resolveCaseInsensitive(base, 'id1');
            const music = id1 && resolveCaseInsensitive(id1, extra.subdir);
            if (music && dirHasProbe(music, extra.match)) return { path: base, title: g.title };
        }
    }
    return null;
}

// Link the data into the port's own folder rather than pointing the engine at the original
// install. Symlinking the pak files (not the folders) means the port writes its configs and
// saves into its own id1/ while the multi-gigabyte data stays in one place — and the game
// CN installed for you is never written into by something else.
// `copy` decides how data is attached, and the rule is about who owns the source, not
// about size. Data resolved from the library lives in a folder Clarity installed
// and manages, so a symlink is safe and saves duplicating gigabytes. Data the user pointed
// at is theirs — a USB stick, a folder they extracted to look inside, somewhere they will
// tidy up next week — so it is copied. A game that stops working because a folder moved is
// not a game that was really installed.
function linkGameData(dataId, sourceRoot, targetRoot, extraSource, { copy = false } = {}) {
    const spec = DATA_SPECS[dataId];
    if (!spec) return { ok: false, error: `Unknown data requirement "${dataId}".` };

    const roots = Array.isArray(sourceRoot) ? sourceRoot : [sourceRoot];
    const link = (from, to) => {
        try { fs.unlinkSync(to); } catch {}
        if (copy) fs.copyFileSync(from, to);
        else fs.symlinkSync(from, to);
    };

    const linked = [];

    // A whole-directory game: take everything in it, structure and all. Selecting by
    // extension would drop the parts with no extension at all.
    if (spec.dataDir) {
        for (const root of roots) {
            const dir = findDataDir(root, spec);
            if (!dir) continue;
            return { ok: true, linked: mirrorTree(dir, targetRoot, copy), fromDir: path.basename(dir) };
        }
    }

    // Nothing loose to link, but a disc image that holds it — extract instead. Copies, not
    // symlinks, because there is no file on disk to point at.
    if (spec.mainFile && !roots.some(r => findFiles(r, spec.mainFile).length)) {
        for (const root of roots) {
            const img = findDataImage(root, spec);
            if (!img) continue;
            const got = extractFromImage(img, spec, targetRoot);
            if (!got.ok) return got;
            return { ok: true, linked: got.linked, fromImage: path.basename(img) };
        }
    }

    // File-shaped specs: link each named file it finds beside the executable, which is
    // where these engines look. Deduplicated by target name across every source, so
    // owning four Doom products does not produce four fights over doom.wad.
    const seen = new Set();
    for (const f of (spec.files || [])) {
        for (const root of roots) {
            // Shallowest wins. Blood: Fresh Supply keeps the base game's tiles at its root
            // and Cryptic Passage's replacements in addons/, under the same filenames — so
            // whichever the directory walk happened to reach first would silently decide
            // which tileset the game loads. Depth is the rule that gets it right.
            const found = findFiles(root, f.find)
                .sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
            for (const hit of found) {
                const name = path.basename(hit).toLowerCase();
                if (seen.has(name)) continue;
                seen.add(name);
                const dstDir = path.join(targetRoot, f.into || '');
                fs.mkdirSync(dstDir, { recursive: true });
                link(hit, path.join(dstDir, name));
                linked.push(name);
            }
        }
    }
    if (spec.requireAny && !linked.length) {
        return { ok: false, error: `No ${spec.label} data files were found in ${sourceRoot}.` };
    }

    const extra = spec.extras && spec.extras[0];
    for (const d of (spec.dirs || [])) {
        // Search every root, not the parameter — callers pass an array of them now, and
        // resolving a folder against an array silently finds nothing. This is why a Quake
        // port could no longer link id1: the check failed on the array itself.
        let src = '';
        for (const root of roots) {
            const hit = resolveCaseInsensitive(root, d.name);
            if (hit && dirHasProbe(hit, d.probe)) { src = hit; break; }
        }
        if (!src) {
            if (d.required) return { ok: false, error: `${roots.join(', ')} has no ${d.name}/ with the expected data.` };
            continue;
        }
        const dst = path.join(targetRoot, d.name);   // lowercase: what engines ask for
        fs.mkdirSync(dst, { recursive: true });
        for (const f of fs.readdirSync(src)) {
            if (!/\.pak$/i.test(f)) continue;
            link(path.join(src, f), path.join(dst, f.toLowerCase()));
        }
        linked.push(d.name);

        // Same episode folder, other product: id1's music comes from the re-release's id1,
        // hipnotic's from its hipnotic, and so on.
        if (!extraSource || !extra) continue;
        const eDir = resolveCaseInsensitive(extraSource.path, d.name);
        const eMusic = eDir && resolveCaseInsensitive(eDir, extra.subdir);
        if (!eMusic) continue;
        const mDst = path.join(dst, extra.subdir);
        fs.mkdirSync(mDst, { recursive: true });
        let n = 0;
        for (const f of fs.readdirSync(eMusic)) {
            if (!extra.match.test(f)) continue;
            link(path.join(eMusic, f), path.join(mDst, f.toLowerCase()));
            n++;
        }
        if (n) linked.push(`${d.name}/${extra.subdir} (${n})`);
    }
    return { ok: true, linked };
}

// ── Where installs are allowed to land ───────────────────────────────────────
// ⚠️ `installRoot` arrives from a user setting, and that setting is stored the way it was
// typed — `~/Games/Clarity`. path.join() does not know what a tilde is, so an
// unexpanded root produced a real directory literally named "~" inside the home folder:
//
//     /home/jose/~/Games/Clarity/GZDoom/gzdoom.exe
//
// The install then reported success, because from its point of view it had unpacked
// everything correctly. The launcher expands the tilde properly, looked in
// ~/Games/Clarity/GZDoom, found nothing, and said "Executable not found" for a file
// that was sitting on disk the whole time under a nonsense path. 218 MB of it.
//
// Expanded here rather than at the call sites: this module is the thing that creates
// directories, so it is the thing that must never create that one.
function resolveRoot(root) {
    const r = String(root || '').trim();
    if (!r) return r;
    if (r === '~') return os.homedir();
    if (r.startsWith('~/')) return path.join(os.homedir(), r.slice(2));
    return r;
}

// Unpack a download into its own folder under `installRoot` and work out how to start it.
// Does not touch any database — the caller decides how to register the result.
function installFromArchive({ recipeId, archivePath, installRoot, dataRows, dataPath, reserved = [], overwrite = false }) {
    installRoot = resolveRoot(installRoot);   // never create a literal "~" directory
    const recipe = getRecipe(recipeId);
    if (!recipe) return { ok: false, error: `Unknown recipe "${recipeId}".` };
    if (!archivePath || !fs.existsSync(archivePath)) return { ok: false, error: 'That file no longer exists.' };

    if (!recipe.archive.test(path.basename(archivePath))) {
        return { ok: false, error: `That file does not look like ${recipe.title}. ${recipe.source.hint}` };
    }

    // Shape-based recipes are identified by what is inside, because the filename carries
    // nothing: every OpenBOR game is a differently-named archive around the same layout.
    // The game's own name comes from the pak, which is the only place it is written down.
    let title = recipe.title;
    let dirName = recipe.dirName;
    let key = recipe.id;
    if (recipe.contains) {
        const entries = inspectArchive(archivePath);
        if (!entries.length) return { ok: false, error: 'Could not read that archive. Install bsdtar (libarchive) if it is a .rar.' };
        const pak = entries.find(e => recipe.contains.pak.test(e));
        if (!pak) return { ok: false, error: `That archive does not look like an OpenBOR game — it has no Paks folder inside. ${recipe.source.hint}` };
        title = path.basename(pak).replace(/\.pak$/i, '').replace(/[_]+/g, ' ').trim() || recipe.title;
        dirName = title.replace(/[/\\:*?"<>|]/g, '').trim().slice(0, 64) || recipe.dirName;
        key = `${recipe.id}_${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    }

    // Resolve the data before unpacking anything: an install that cannot be played is
    // worse than a refusal, and this is the failure the user can actually act on.
    // A folder the user pointed at wins over the library — they know which copy they meant,
    // and for anything the storefronts never sold (their own DOS files) it is the only way.
    let data = null;
    if (recipe.data) {
        data = dataPath ? resolveDataFolder(recipe.data, dataPath) : resolveGameData(recipe.data, dataRows);
        if (!data.ok) {
            return { ok: false, error: data.message, owned: data.owned || [],
                     userSupplied: !!data.userSupplied,
                     needsData: recipe.data, dataLabel: DATA_SPECS[recipe.data]?.label || recipe.data };
        }
    }

    const picked = safeTarget(installRoot, dirName, reserved);
    const target = picked.target;
    if (fs.existsSync(target) && fs.readdirSync(target).length) {
        if (!overwrite) return { ok: false, error: `${target} already exists and is not empty.`, exists: true };
        const cleared = clearTarget(target, reserved);
        if (!cleared.ok) return cleared;
    }
    fs.mkdirSync(target, { recursive: true });

    if (path.extname(archivePath).toLowerCase() === '.exe') {
        const got = extractInstaller(archivePath, target);
        if (!got.ok) return got;
    } else {
        const ex = findExtractor(archivePath);
        if (!ex) return { ok: false, error: 'No archive tool available. Install bsdtar (libarchive) or unzip.' };
        const res = spawnSync(ex.cmd, ex.args(archivePath, target), { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        if (res.status !== 0) {
            return { ok: false, error: `Could not unpack the archive: ${(res.stderr || '').trim().slice(0, 300)}` };
        }
    }

    dropInstallerJunk(target);
    flattenSingleRoot(target);

    // Nothing runnable yet, but an archive inside — an installer carrying its payload as a
    // second archive. Unwrap once and look again.
    if (!recipe.contains && !findEntry(target, recipe.entry.exe) && unwrapNestedArchive(target)) {
        dropInstallerJunk(target);
        flattenSingleRoot(target);
    }

    // For a shape-based recipe the entry point is defined by position, not by name: the
    // OpenBOR engine is renamed per game, so the only reliable rule is "the exe that sits
    // beside Paks/". A name-matching search would just pick the first .exe it tripped over.
    const exe = recipe.contains ? findEntryBesideDir(target, /^Paks$/i, recipe.entry.exe)
                                : findEntry(target, recipe.entry.exe);
    if (!exe) {
        return { ok: false, error: recipe.contains
            ? 'Unpacked, but no game executable was found next to the Paks folder.'
            : `Unpacked, but no matching executable was found inside. The download may be the wrong file.` };
    }

    let linked = null;
    let extra = null;
    if (recipe.data) {
        const spec = DATA_SPECS[recipe.data];
        if (spec && spec.extras) extra = resolveExtra(spec.extras[0], dataRows);
        // Link beside the executable — that is the engine's basedir, which is not always
        // the top of the archive.
        linked = linkGameData(recipe.data, data.paths || data.path, path.dirname(exe), extra, { copy: !!dataPath });
        if (!linked.ok) return { ok: false, error: linked.error };
    }

    return {
        ok: true,
        recipeId: recipe.id,
        key,
        category: recipe.category || '',
        title,
        installPath: target,
        executable: path.relative(target, exe) || path.basename(exe),
        platform: recipe.entry.platform,
        dataFrom: data && data.ok ? { path: data.path, title: data.title, linked: linked.linked } : null,
        extraFrom: extra ? extra.title : null,
    };
}

// ── Adding a Windows game from a folder already on disk ──────────────────────
// The other half of the same problem: plenty of things arrive as a folder you have already
// unpacked, and until now the only route was Installer's importer, which scans one level deep
// and so finds nothing in the many releases that put the executable in a subfolder.
//
// Nothing is copied or moved — the folder is registered where it sits.

// Executables that are never the game. Not used to hide anything, only to sort: the aim is
// to put the right answer at the top, not to decide for the user and be wrong about SWOS,
// whose real entry point is called gameLauncher.exe.
const NOT_THE_GAME = /^(unins|uninst|setup|install|vc_?redist|dxwebsetup|directx|dotnet|oalinst|openal|crash|report|.*ded(icated)?|console|versionmaintainer|dlcmanager|databasebrowser|benchmark|editor|mapper|server)/i;

function scanFolderEntries(folder, maxDepth = 3) {
    const out = [];
    const walk = (dir, depth) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isFile() && /\.(exe|bat|cmd|sh|jar)$/i.test(e.name)) {
                let size = 0;
                try { size = fs.statSync(p).size; } catch {}
                const rel = path.relative(folder, p);
                out.push({
                    rel, name: e.name, dir: path.dirname(rel) === '.' ? '' : path.dirname(rel),
                    size, junk: NOT_THE_GAME.test(e.name),
                    // A .bat beside an .exe usually *is* the entry point — it carries the
                    // command line the game needs (Brutal Doom's launcher, DOSBox wrappers).
                    bat: /\.(bat|cmd)$/i.test(e.name),
                    depth,
                });
            } else if (e.isDirectory() && depth < maxDepth && !/^(__redist|redist|_?commonredist|directx|dotnet|vcredist)$/i.test(e.name)) {
                walk(p, depth + 1);
            }
        }
    };
    walk(folder, 0);

    // Best guess first: never-the-game last, then shallower, then bigger. Depth beats
    // everything because the real entry point lives at the top of a release far more often
    // than not — sorting batch files first instead put SWOS's sysinfo.bat above its actual
    // gameLauncher.exe. Batch files are flagged rather than promoted: sometimes the .bat is
    // the game (Brutal Doom's launcher carries the whole -iwad/-file line) and sometimes it
    // is a utility, so the list says which is which and lets the user decide.
    return out.sort((a, b) =>
        (a.junk - b.junk) || (a.depth - b.depth) || (b.size - a.size));
}

// ── Never write over a game that is already there ────────────────────────────
// Custom installs share one folder with the library's own installs, and the names
// collide: GOG puts Witchaven in <root>/Witchaven, and a recipe called Witchaven wants
// exactly the same place. The install then clears its target before unpacking — and
// clears somebody's game.
//
// `reserved` is every path the library already claims. A target that lands on one is
// renamed rather than emptied, and nothing reserved is ever deleted.
// The suffix says *why* there are two, which "(2)" does not. A collision here means the
// user owns the same game in their library — GOG's Witchaven runs under DOSBox, this one
// runs on a source port — so naming it after that is the useful distinction.
// `spaceless` matters more than it looks. BuildGDX.exe re-parses its own command line and
// drops the quoting, so a -path containing a space arrives truncated: passing
// "…/Witchaven (Source Port)" got it "…/Witchaven", which is the GOG install, and it
// failed trying to write there. GZDoom quotes correctly and is unaffected — this is one
// launcher's behaviour, so only the recipes whose folder is handed to it pay the cost.
function safeTarget(installRoot, dirName, reserved = [], { suffix = 'Source Port', spaceless = false } = {}) {
    const taken = new Set(reserved.filter(Boolean).map(p => path.resolve(p)));
    const free = (name) => !taken.has(path.resolve(path.join(installRoot, name)));
    const base = spaceless ? dirName.replace(/[^A-Za-z0-9._-]+/g, '') : dirName;
    const withSuffix = spaceless
        ? `${base}-${suffix.replace(/\s+/g, '')}`
        : `${base} (${suffix})`;
    const nth = (i) => spaceless
        ? `${base}-${suffix.replace(/\s+/g, '')}${i}`
        : `${base} (${suffix} ${i})`;

    if (free(base)) return { target: path.join(installRoot, base), name: base, renamed: false };
    if (free(withSuffix)) return { target: path.join(installRoot, withSuffix), name: withSuffix, renamed: true };
    for (let i = 2; i < 50; i++) {
        if (free(nth(i))) return { target: path.join(installRoot, nth(i)), name: nth(i), renamed: true };
    }
    return { target: path.join(installRoot, base), name: base, renamed: false, blocked: true };
}

// Clearing a folder is only ever safe when nothing else claims it.
function clearTarget(target, reserved = []) {
    if (reserved.filter(Boolean).some(p => path.resolve(p) === path.resolve(target))) {
        return { ok: false, error: `${target} belongs to another game in your library. Refusing to overwrite it.` };
    }
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: true };
}

// Register a folder as it stands. Returns the same shape installFromArchive does, so the
// caller's registration path is shared and there is one way for a custom game to exist.
function addFromFolder({ folder, executable, title }) {
    if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'That folder no longer exists.' };
    const exe = path.join(folder, executable || '');
    if (!executable || !fs.existsSync(exe)) return { ok: false, error: 'Pick the file that starts the game.' };

    const name = (title || path.basename(folder)).trim();
    return {
        ok: true,
        recipeId: 'folder',
        key: `folder_${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || Date.now().toString(36)}`,
        title: name,
        installPath: folder,
        executable,
        // .sh is the only thing here that is plausibly a native Linux game; everything
        // else goes through Proton, which is what these folders are.
        platform: /\.sh$/i.test(executable) ? 'linux' : 'windows',
        category: '',
    };
}

// The folder inside a Quake mod archive that the engine will load. Identified by what it
// holds — pak0.pak or progs.dat — rather than by position, because archives vary: some wrap
// everything in a version folder, some do not.
function findModFolderName(archivePath) {
    const entries = inspectArchive(archivePath).map(e => e.replace(/\\/g, '/'));
    const marker = /(^|\/)([^/]+)\/(pak\d+\.pak|progs\.dat)$/i;
    const seen = [];
    for (const e of entries) {
        const m = e.match(marker);
        if (!m) continue;
        // id1 is Quake's own data, never the mod.
        if (/^(id1|hipnotic|rogue|qw)$/i.test(m[2])) continue;
        if (!seen.includes(m[2])) seen.push(m[2]);
    }
    // Shallowest wins when an archive nests the mod inside a release folder.
    seen.sort((a, b) => {
        const da = entries.find(e => e.includes(`/${a}/`) || e.startsWith(`${a}/`)) || '';
        const db = entries.find(e => e.includes(`/${b}/`) || e.startsWith(`${b}/`)) || '';
        return da.split('/').length - db.split('/').length;
    });
    return seen[0] || '';
}

// Pull that one folder out, dropping whatever the archive wrapped it in.
function extractModFolder(archivePath, modDir, target) {
    const ex = findExtractor(archivePath);
    if (!ex) return { ok: false, error: 'No archive tool available. Install bsdtar (libarchive).' };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-qmod-'));
    try {
        const res = spawnSync(ex.cmd, ex.args(archivePath, tmp), { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        if (res.status !== 0) return { ok: false, error: `Could not unpack the mod: ${(res.stderr || '').trim().slice(0, 200)}` };
        const found = findFiles(tmp, /^(pak\d+\.pak|progs\.dat)$/i, 5)
            .map(f => path.dirname(f))
            .find(d => path.basename(d).toLowerCase() === modDir.toLowerCase());
        if (!found) return { ok: false, error: `Could not find ${modDir} inside that archive after unpacking.` };
        fs.cpSync(found, path.join(target, modDir), { recursive: true });
        return { ok: true };
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ── A game running on a shared engine ────────────────────────────────────────
// Raze plays a dozen different games and BuildGDX a dozen more, but nobody wants "Raze" in
// their library — they want Blood, and Duke Nukem 3D, and Shadow Warrior, each with its own
// name and cover. And they cannot all share one folder: Duke and Blood both ship tiles000.art,
// so whichever landed last would decide what the other one loaded.
//
// So each game gets its own folder with the engine **symlinked in** and only that game's
// data beside it. No duplicated engine, no filename collisions, and no guessing at command
// line switches — the engine starts in a directory containing exactly one game and finds it.
// Verified: a fully symlinked engine folder launches and runs.

// Engine files are everything that is not game data. raze.pk3 is the engine's own archive
// and must come along; .grp/.rff/.art belong to whichever game was linked in previously.
const IS_GAME_DATA = /\.(grp|rff|art|wl6|wl1|sod|sd[123])$|^blood\.ini$/i;

// Written into each game folder: which engines were mirrored in and what starts them.
// Read at Play time so a game both engines support can offer the choice.
const ENGINES_FILE = 'cn-engines.json';
function readEngines(gameRoot) {
    try { return JSON.parse(fs.readFileSync(path.join(gameRoot, ENGINES_FILE), 'utf8')) || []; }
    catch { return []; }
}

function mirrorEngine(engineRoot, target) {
    let entries = [];
    try { entries = fs.readdirSync(engineRoot, { withFileTypes: true }); } catch { return 0; }
    let n = 0;
    for (const e of entries) {
        if (IS_GAME_DATA.test(e.name)) continue;
        if (e.name === 'mods' || e.name === 'games') continue;   // our own scaffolding
        const dst = path.join(target, e.name);
        try { fs.unlinkSync(dst); } catch {}
        try { fs.symlinkSync(path.join(engineRoot, e.name), dst); n++; } catch {}
    }
    return n;
}

// A ZDoom-family engine with no game data beside it prints "Unable to find any game data"
// and quits — which is what an engine entry became once the games moved into folders of
// their own. It has a real front end though: a game picker at startup and the whole options
// tree behind it. Pointing it at the folders where the games now live gets that back, and
// turns the engine entry into a menu of everything you have installed.
//
// Verified against Raze: portable ini beside the exe, Wine's Z: drive for the Linux path.
function writeEngineSearchPaths(engineId, engineRoot, gameFolders) {
    if (engineId !== 'raze') return false;          // only Raze's format is known-good
    const toWine = (p) => 'Z:' + p.replace(/\//g, '\\');
    const body =
        '# Written by Clarity. Lists the folders your Build games are installed in,\n' +
        '# so opening Raze on its own shows a picker for all of them.\n\n' +
        '[GlobalSettings]\n\n' +
        '[GameSearch.Directories]\n' +
        gameFolders.map(f => `Path=${toWine(f)}`).join('\n') + '\n';
    try {
        fs.writeFileSync(path.join(engineRoot, 'raze_portable.ini'), body);
        return true;
    } catch { return false; }
}

function installGameOnEngine({ recipeId, archivePath, engineRoot, engineExe, engines, installRoot, dataRows, dataPath, reserved = [], overwrite = false }) {
    installRoot = resolveRoot(installRoot);   // never create a literal "~" directory
    const recipe = getRecipe(recipeId);
    if (!recipe) return { ok: false, error: `Unknown recipe "${recipeId}".` };
    if (!engineRoot || !fs.existsSync(engineRoot)) return { ok: false, error: 'The engine folder is missing — reinstall it.' };

    // Data before anything is created: a game folder with no game in it is worse than a
    // refusal, and "you own it but it is not installed" is something the user can act on.
    const data = dataPath ? resolveDataFolder(recipe.data, dataPath) : resolveGameData(recipe.data, dataRows);
    if (!data.ok) {
        return { ok: false, error: data.message, owned: data.owned || [],
                 userSupplied: !!data.userSupplied,
                 needsData: recipe.data, dataLabel: DATA_SPECS[recipe.data]?.label || recipe.data };
    }

    // A mod brings its own folder, and that folder's name is the game's name: the engine
    // loads it with -game <folder>, and "dwellv2p2" is what the author called it.
    let modDir = '';
    if (recipe.needsArchive) {
        if (!archivePath || !fs.existsSync(archivePath)) return { ok: false, error: 'That file no longer exists.' };
        modDir = findModFolderName(archivePath);
        if (!modDir) {
            return { ok: false, error: `No mod folder was found inside that archive. A Quake mod is a folder holding pak0.pak or progs.dat. ${recipe.source.hint}` };
        }
    }
    const dirName = modDir || recipe.dirName;
    const picked = safeTarget(installRoot, dirName, reserved, { spaceless: !!recipe.gdxGame });
    const target = picked.target;
    // Two entries called "Witchaven" in one library is worse than a longer name.
    const shownTitle = picked.renamed ? `${recipe.title} (Source Port)` : recipe.title;
    if (fs.existsSync(target) && fs.readdirSync(target).length && !overwrite) {
        return { ok: false, error: `${target} already exists and is not empty.`, exists: true };
    }
    const cleared = clearTarget(target, reserved);
    if (!cleared.ok) return cleared;
    fs.mkdirSync(target, { recursive: true });

    // Every engine that can play this game gets mirrored in, so the choice of which to
    // use is made when you press Play rather than being fixed at install time.
    const list = engines && engines.length ? engines : [{ id: 'engine', title: 'Engine', root: engineRoot, exe: engineExe }];
    const mirrored = [];
    const takenExe = new Set();
    for (const e of list) {
        // vkQuake and Quake: Ray Traced both ship vkQuake.exe. Mirroring both would leave
        // one quietly shadowing the other and the Play-time picker offering a choice that
        // is not real, so the first one in wins and the clash is reported rather than hidden.
        const key = String(e.exe || '').toLowerCase();
        if (takenExe.has(key)) continue;
        if (!mirrorEngine(e.root, target)) return { ok: false, error: `Could not mirror ${e.title} into the game folder.` };
        takenExe.add(key);
        mirrored.push(e);
    }
    const shadowed = list.filter(e => !mirrored.includes(e)).map(e => e.title);
    try {
        fs.writeFileSync(path.join(target, ENGINES_FILE),
            JSON.stringify(mirrored.map(e => ({ id: e.id, title: e.title, exe: e.exe })), null, 2));
    } catch {}

    const spec = DATA_SPECS[recipe.data];
    const extra = spec && spec.extras ? resolveExtra(spec.extras[0], dataRows) : null;
    const linked = linkGameData(recipe.data, data.paths || data.path, target, extra, { copy: !!dataPath });
    if (!linked.ok) return { ok: false, error: linked.error };

    // Unpack the mod beside the data, as its own folder, which is what -game names.
    if (recipe.needsArchive) {
        const got = extractModFolder(archivePath, modDir, target);
        if (!got.ok) return got;
    }

    // BuildGDX keeps a configured folder per game and does not look in its own directory,
    // so it reports every resource missing even with the data sitting beside it, and -path
    // on the command line did not change that. It stores the folder in a per-game ini —
    // WitchavenGDX.ini, Witchaven2GDX.ini — under a [Main] section with a Path key, which
    // is what its launcher reads when deciding whether the resources are there.
    // (Names and keys read out of the jar: WHEntry names the ini and the required files,
    // GameConfig has gamePath/Path, ConfigContext writes [Main].)
    // BuildGDX's own help settles it: `-game "name"` forces the game to start without
    // showing the launcher, and "should be used with -path". That is why -path alone did
    // nothing — on its own it is ignored, and the launcher went on reading its stored
    // configuration, which had no folder for this game.
    //
    // The names come from its Game enum (WITCHAVEN, WITCHAVEN_2, BLOOD, …); parseGame
    // compares case-insensitively against the enum name, the display name and the short
    // name, so the display name is safe to pass.
    const usesGdx = (engines || []).some(e => e.id === 'buildgdx') || /buildgdx/i.test(engineExe || '');
    const winPath = 'Z:' + target.replace(/\//g, '\\');
    if (usesGdx && recipe.gdxApp) {
        // Still written: it is what the launcher reads if it is ever opened on its own.
        try {
            fs.writeFileSync(path.join(target, `${recipe.gdxApp}.ini`),
                `[Main]\nPath = ${winPath}\nAutoloadFolder = ${winPath}\\autoload\n`);
        } catch {}
    }
    // C:, not Z:. Java asks Wine whether the folder is writable and Wine says no for its
    // unix drive, however writable it actually is — so the launcher is handed a path on the
    // prefix's own C: drive, which the Manager maps to this folder before every launch.
    const launchArgs = (usesGdx && recipe.gdxGame)
        ? `-game "${recipe.gdxGame}" -path "C:\\cn\\${path.basename(target)}"`
        : (modDir ? `-game ${modDir}` : null);

    return {
        ok: true,
        recipeId: recipe.id,
        key: recipe.id,
        title: modDir ? (picked.renamed ? `${modDir} (Source Port)` : modDir) : shownTitle,
        key: modDir ? `${recipe.id}_${modDir.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : recipe.id,
        launchArgs,
        installPath: target,
        executable: engineExe,
        platform: 'windows',
        dataFrom: { path: data.path, title: data.title, linked: linked.linked },
        extraFrom: extra ? extra.title : null,
        shadowed,
    };
}

// Install a mod alongside an engine that is already on disk. The engine is shared rather
// than copied per mod — that is how ZDoom-family ports are designed to work, and it keeps
// four Doom mods from meaning four copies of the same 50MB engine. Each mod still becomes
// its own library entry, distinguished by the -file line it carries.
// The loadable files inside a mod archive, read from the listing without unpacking. Mod
// packs routinely ship the mod plus a pile of optional extras — Black Edition's download
// carries the 199MB mod alongside thirty-odd alternate footstep and voice packs — so
// "take the first .pk3" picks a hero voice and produces something that installs cleanly
// and plays nothing. Which file is the mod is the user's call, not a heuristic's.
function listModCandidates(archivePath, recipe) {
    const bsdtar = which('bsdtar');
    if (!bsdtar) return [];
    const r = spawnSync(bsdtar, ['-tvf', archivePath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (r.status !== 0) return [];

    const out = [];
    for (const line of r.stdout.split('\n')) {
        if (!line.trim()) continue;
        // bsdtar -tvf: perms links owner group size <date fields> name
        const m = line.match(/^\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.*)$/);
        if (!m) continue;
        const [, size, name] = m;
        if (name.endsWith('/') || !recipe.modFile.test(name)) continue;
        out.push({ rel: name, name: path.basename(name), dir: path.dirname(name), size: Number(size) });
    }
    return out.sort((a, b) => b.size - a.size);   // biggest first: the mod, then its extras
}

// The IWADs sitting beside the engine, with names a person recognises. Anything unknown
// is offered under its filename rather than hidden — a mod set can legitimately ship its
// own IWAD, and Freedoom is a real answer for someone who owns nothing.
const IWAD_LABELS = [
    [/^doom2\.wad$/i,        'Doom II: Hell on Earth'],
    [/^doomu\.wad$/i,        'The Ultimate Doom'],
    [/^doom\.wad$/i,         'Doom / The Ultimate Doom'],
    [/^doom1\.wad$/i,        'Doom (shareware)'],
    [/^tnt\.wad$/i,          'Final Doom: TNT Evilution'],
    [/^plutonia\.wad$/i,     'Final Doom: The Plutonia Experiment'],
    [/^freedoom2\.wad$/i,    'Freedoom: Phase 2'],
    [/^freedoom1?\.wad$/i,   'Freedoom: Phase 1'],
    [/^heretic\.wad$/i,      'Heretic'],
    [/^hexen\.wad$/i,        'Hexen'],
];

function listIwads(engineRoot) {
    let names = [];
    try { names = fs.readdirSync(engineRoot).filter(f => /\.wad$/i.test(f)); } catch { return []; }
    return names
        .map(file => {
            const hit = IWAD_LABELS.find(([rx]) => rx.test(file));
            return { file, label: hit ? hit[1] : file };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
}

// launch_args is a shell-ish string because that is what the engine parses. Splitting it
// the same way lets the IWAD be changed after the fact without reinstalling the mod —
// swapping which Doom you play on should not mean re-extracting an 83MB pk3.
function parseArgs(str) {
    const out = [];
    let cur = '', inQ = false, q = '';
    for (const ch of String(str || '').trim()) {
        if (inQ) { if (ch === q) inQ = false; else cur += ch; }
        else if (ch === '"' || ch === "'") { inQ = true; q = ch; }
        else if (ch === ' ' || ch === '\t') { if (cur) { out.push(cur); cur = ''; } }
        else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
}

const formatArgs = (arr) => arr.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ');

// Replace, add or drop the -iwad in an existing launch line. An empty iwad removes it,
// which is what hands the choice back to the engine's own picker at every launch.
function withIwad(launchArgs, iwad) {
    const args = parseArgs(launchArgs);
    const out = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i].toLowerCase() === '-iwad') { i++; continue; }   // drop flag and its value
        out.push(args[i]);
    }
    return formatArgs(iwad ? ['-iwad', iwad, ...out] : out);
}

const currentIwad = (launchArgs) => {
    const args = parseArgs(launchArgs);
    const i = args.findIndex(a => a.toLowerCase() === '-iwad');
    return i >= 0 && args[i + 1] ? args[i + 1] : '';
};

function installMod({ recipeId, archivePath, engineRoot, engineExe, dataRows, selected, iwad }) {
    const recipe = getRecipe(recipeId);
    if (!recipe) return { ok: false, error: `Unknown recipe "${recipeId}".` };
    if (!archivePath || !fs.existsSync(archivePath)) return { ok: false, error: 'That file no longer exists.' };
    if (!engineRoot || !fs.existsSync(engineRoot)) return { ok: false, error: 'The engine folder is missing — reinstall GZDoom or UZDoom.' };
    if (!recipe.archive.test(path.basename(archivePath))) {
        return { ok: false, error: `That file does not look like ${recipe.title}. ${recipe.source.hint}` };
    }

    // Which Doom to play on is asked at *launch*, not here — see _iwadForLaunch in the
    // renderer. It is a per-session decision, like picking a disc off a shelf, and asking
    // once at install time answers it for all time. The recipe's preference is written in
    // as the starting default so that dialog opens somewhere sensible.
    const iwads = listIwads(engineRoot);

    const candidates = (ext => ext === '.pk3' || ext === '.wad' ? [] : listModCandidates(archivePath, recipe))(path.extname(archivePath).toLowerCase());
    const needFiles = candidates.length > 1 && !(selected && selected.length) && !recipe.modAll;
    if (needFiles) {
        return { ok: false, choose: candidates, iwads: [], title: recipe.title };
    }

    // Its own folder under the engine, so two mods never fight over a filename and
    // removing one is just deleting a directory.
    const modsDir = path.join(engineRoot, 'mods', recipe.dirName);
    fs.rmSync(modsDir, { recursive: true, force: true });
    fs.mkdirSync(modsDir, { recursive: true });

    // A mod arrives either as the loadable file itself or as an archive around it.
    const ext = path.extname(archivePath).toLowerCase();
    let picked = [];
    if (ext === '.pk3' || ext === '.wad') {
        const dst = path.join(modsDir, path.basename(archivePath));
        fs.copyFileSync(archivePath, dst);
        picked = [dst];
    } else {
        if (!candidates.length) return { ok: false, error: `No .pk3 or .wad was found inside that archive. ${recipe.source.hint}` };

        const take0 = (selected && selected.length)
            ? candidates.filter(c => selected.includes(c.rel))
            : candidates;                      // single candidate, or modAll
        if (!take0.length) return { ok: false, error: 'None of the chosen files are in that archive.' };
        let take = take0;

        // Load order matters once several files are loaded together, and these packs are
        // conventionally numbered ("10 DHTP normal.pk3", "11 HD SFX.wad"), so honour that.
        take = [...take].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-mod-'));
        try {
            const bsdtar = which('bsdtar');
            if (!bsdtar) return { ok: false, error: 'No archive tool available. Install bsdtar (libarchive).' };
            // Extract only the chosen members — these archives run to hundreds of megabytes
            // and unpacking the other thirty addons to throw them away is pure waste.
            const res = spawnSync(bsdtar, ['-xf', archivePath, '-C', tmp, ...take.map(t => t.rel)], { encoding: 'utf8' });
            if (res.status !== 0) return { ok: false, error: `Could not unpack the mod: ${(res.stderr || '').trim().slice(0, 300)}` };

            for (const t of take) {
                const src = path.join(tmp, t.rel);
                if (!fs.existsSync(src)) continue;
                const dst = path.join(modsDir, t.name);
                fs.copyFileSync(src, dst);
                picked.push(dst);
            }
            if (!picked.length) return { ok: false, error: 'The chosen files could not be extracted from that archive.' };
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }

    // The user's choice wins; '' means they asked to be prompted at launch, so no -iwad
    // goes on the line and the engine's own picker handles it. With nothing chosen, fall
    // back to the recipe's preference, and to the engine's picker if even that is absent.
    const args = [];
    const chosen = iwad !== undefined
        ? iwad
        : (recipe.iwad ? (iwads.find(i => recipe.iwad.test(i.file))?.file || '') : '');
    if (chosen) args.push('-iwad', chosen);
    for (const f of picked) args.push('-file', path.relative(engineRoot, f));

    return {
        ok: true,
        recipeId: recipe.id,
        key: recipe.id,
        title: recipe.title,
        installPath: engineRoot,
        executable: engineExe,
        platform: 'windows',
        launchArgs: args.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
        modFiles: picked.map(f => path.basename(f)),
        iwad: chosen,
        iwadLabel: chosen ? (iwads.find(i => i.file === chosen)?.label || chosen) : 'chosen at launch',
    };
}

module.exports = {
    RECIPES, DATA_SPECS, installMod, listModCandidates, listIwads,
    scanFolderEntries, addFromFolder, installGameOnEngine, mirrorEngine, readEngines, ENGINES_FILE,
    findModFolderName, extractModFolder,
    safeTarget, clearTarget,
    writeEngineSearchPaths,
    parseArgs, formatArgs, withIwad, currentIwad,
    listRecipes, getRecipe, detectRecipe, selfCheck,
    resolveGameData, resolveDataFolder, folderSatisfies, resolveExtra, linkGameData, installFromArchive,
    findEntry, flattenSingleRoot, findExtractor,
};
