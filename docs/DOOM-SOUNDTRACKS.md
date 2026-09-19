# Doom soundtracks

Pick the music a Doom mod plays, at the moment you press Play, in the same dialog that
already asks which Doom you want. Brutal Doom on Andrew Hulshult's **IDKFA** is the case
this was built for.

It is not a Recipe. A Recipe is knowledge about one named game, and this is the opposite:
it works for every mod on a ZDoom-family engine, so by the rule in `RECIPES.md` it belongs
in the engine instead.

## Where the music comes from

Not from a download. From the **DOOM + DOOM II** re-release, if you own it.

That release ships its alternate soundtracks inside `extras.wad`, as ogg lumps prefixed by
which recording they belong to:

| Prefix | Recording | Tracks | Size |
|---|---|---|---|
| `H_` | IDKFA, Andrew Hulshult's re-recording | 44 | 336 MB |
| `O_` | The original Bobby Prince score, re-recorded | 87 | 260 MB |

Measured on a real install: 44.1 kHz stereo Ogg Vorbis, around 320 kbps. Nothing is
downloaded, nothing is transcoded, and the bytes that end up in the built WAD are
byte-for-byte the ones the re-release shipped.

If the re-release is not installed, the soundtrack question is simply not asked. There is
nothing to buy or fetch on this path, so an explanation would only be noise.

## Why it is not just a rename

`H_E1M1` is the same song as `D_E1M1`, so most of the work is copying lumps under new
names into a PWAD, which is how music replacement has worked since 1994.

The part that needs care is that **a music lump's name does not tell you which song it
holds.** That varies per IWAD, so none of it is hard-coded; it is worked out by hashing
the user's own files:

- **Doom reuses songs.** Doom II's MAP16 asks for `D_RUNNI2`, which in `doom2.wad` is
  byte-for-byte `D_RUNNIN`. Replace only `D_RUNNIN` and MAP16 drops back to MIDI while
  MAP01 plays IDKFA.
- **The same name means different songs in different IWADs.** `tnt.wad`'s `D_RUNNIN` is
  TNT's own music, not Doom II's. Matching by name, IDKFA scores 74% against TNT and would
  put the wrong song on nearly every map. Matching by content, almost nothing resolves, and
  TNT correctly gets no soundtrack offered.
- **The reuse runs across games.** Nearly all of `plutonia.wad`'s music turns out to be
  Doom *1* songs: its `D_RUNNIN` is the song `doom.wad` files as `D_E1M2`. Plutonia is
  genuinely covered, 26 of its 27 songs, but only if you follow the bytes.

So every music lump is identified by hashing it against the re-release's own `doom.wad`
and `doom2.wad`, which are the originals these recordings were made from, and pointed at
the matching track through GZDoom's `$musicalias`.

## What gets built

Under `<engine>/soundtracks/`, shared by every mod on that engine:

| File | What it is |
|---|---|
| `<id>.wad` | The audio. Every track under its canonical `D_` name. Built once. |
| `<id>-<iwad>.wad` | One `SNDINFO` lump of `$musicalias` lines, derived from that IWAD. |

Two files rather than one because the audio is identical for every IWAD and the aliases
are not. Copying 336 MB per IWAD to say the same thing three times would be silly.

The audio WAD is written to `<name>.part` and moved into place, so an interrupted build
never leaves something that looks installed and plays silence. The build is async
throughout: a third of a gigabyte written synchronously on Electron's main process is a
third of a gigabyte of frozen window.

## Coverage

Offered only where the recording genuinely covers the IWAD, at a floor of 50% of its
distinct songs. Measured against a real library:

| IWAD | IDKFA | Re-recorded original |
|---|---|---|
| `doom.wad` | 23 of 29 | 23 of 29 |
| `doom2.wad` | 21 of 22 | 21 of 22 |
| `plutonia.wad` | 26 of 27 | 26 of 27 |
| `tnt.wad` | not offered | not offered |

Songs the recording never covered keep the IWAD's own music, which is the right answer
rather than a gap: for Doom that is `D_INTER`, `D_INTROA` and the four unique Episode 3
tracks, and for Doom II the one song filed as `D_DDTBL2`.

TNT is excluded because these recordings are not a soundtrack for it. Its own music is
untouched, which is what playing TNT should sound like.

## The launch line

Soundtrack files go on the end, after the mod's own `-file` entries, because the last
thing loaded wins. Brutal Doom turns out not to define any of the stock music lumps (it
ships only its own title theme and tracks for its own maps), so in practice there is
nothing to fight over, but load order is the rule the engine documents and relying on the
absence of a clash would be luck rather than design.

Choosing "The original music" takes the files back off the line. Nothing is deleted, so
turning it on again is instant.

## Where the code lives

| Piece | File |
|---|---|
| Reading, matching and building | `packages/core/doom-soundtrack.js` |
| The `-file` line | `packages/core/custom-installers.js`, beside `withIwad` |
| IPC | `custom-run-options` and `custom-set-run-options` in `apps/manager/main.js` |
| The dialog | `_runOptionsForLaunch` in `apps/manager/renderer.js` |

The launch dialog asks its questions as a list of radio groups rather than one fixed
block, because which soundtracks are worth offering depends on which Doom is selected, and
both are chosen in the same dialog.
