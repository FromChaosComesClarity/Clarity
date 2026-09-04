# Restoring Claude Code's memory onto the Omarchy machine

⚠️ **Rewritten 2026-08-25.** This was written for an Omarchy *laptop* joining a live Nobara
desktop, where the desktop stayed available as a fallback. That is not what happened: Nobara was
**wiped** and Omarchy installed on the gaming desktop itself. There is no second machine to go back
to, so the pre-wipe steps below are history, what matters now is the restore, and the offline
copies on `/run/media/jose/backup`.

The repo carries the code. **Claude Code's memory carries the reasoning**, why decisions were
made, which traps cost real debugging, what is verified versus merely built. None of it is in
git. Restore it with **ClaudeMemKeeper** before the first real session.

---

## Why this needs an app at all

Claude Code keys everything by absolute path. Memories live in

```
~/.claude/projects/<slug>/memory/
```

where `<slug>` is the project's absolute path with every `/`, `_` and `.` turned into `-`. For
this project on every Linux host so far, Nobara before, Omarchy now. That is:

```
-home-jose-Documents-DEVELOPMENT-CLAUDE-Clarity
```

The `projects` map in `~/.claude.json` is keyed by absolute path too, and every line of a session
transcript records the `cwd` it ran in. Copy the folder across untranslated and the memories are
on disk but invisible. ClaudeMemKeeper rewrites all three on restore.

**The lucky part:** if you clone to `/home/jose/Documents/DEVELOPMENT/CLAUDE/Clarity` on the
new machine, same username, same path. The slug is **identical** and no translation is needed
at all. Only a different username or a different directory makes the remapping matter. The Mac
needs it (`/Users/jose/…`); this machine does not, because it is the same path as before.

---

## On the Nobara desktop, what was done before the wipe (history)

1. Open **ClaudeMemKeeper** (`~/ClaudeMemKeeper/ClaudeMemKeeper.AppImage`).
2. **Back up.** Do this *after* any memory updates from the session you just finished, or you
   will carry a stale snapshot across. The app skips the upload entirely if nothing changed,
   so a redundant backup costs nothing.
3. The credentials file is **already exported** to `~/claudememkeeper-settings.json` (mode 0600).
   It holds the Google OAuth **client id and secret**, no token, no machine identity. Treat it
   like a password: move it on a USB stick or another private channel, not a public one.
   **It was saved**, `/run/media/jose/backup/credentials/ClaudeMemKeeper/`, mode 0600, along with
   every other project's credentials and a `CREDENTIALS.md` index.

Final state of that machine, for reference, it no longer exists:

| | |
|---|---|
| Machine name in Drive | `nobara-pc-Linux` |
| Sets included | core, memories, projectConfig, transcripts, promptHistory |
| Transcript cap | none (`transcriptDays: 0`) |
| Retention | 10 snapshots |

---

## On the Omarchy machine

1. **Get the app there.** Copy `ClaudeMemKeeper.AppImage` across (~115 MB), or clone
   `ClaudeMemKeeper` and `npm install && npm run build`. Put the AppImage in its own folder,
   ⚠️ **on Linux it keeps its settings in `CMK_DATA/` *beside the AppImage*, not in `~/.config`**,
   so binary and config travel together. `chmod +x` it. (Needs `fuse2`, same as Clarity.)
2. **Settings → Import settings…** and pick `claudememkeeper-settings.json`. This is the only
   step that cannot bootstrap itself, a fresh machine has no Drive credentials, including this
   app's own.
3. **Connect to Google Drive.** Each machine authorises separately; the token is deliberately not
   in the settings file, so revoking one machine cannot sign the others out. Sign-in uses a
   loopback redirect on a port the OS assigns, so there is nothing to configure.
4. **Name this machine**, that name becomes its own folder in Drive. Something like
   `omarchy-pc-Linux`. **Do not reuse `nobara-pc-Linux`**, not because that machine would be
   evicted (it is gone), but because its snapshots are the last record of it, and reusing the name
   would let the retention limit overwrite them with this machine's.
5. **Restore → pick the `nobara-pc-Linux` snapshot**. That is the last one it ever wrote, taken
   after the memory was brought up to date for 1.9.2 and the migration. Use **"Add only what is
   missing"** for this first import: it never overwrites and never deletes, which is what you want
   on a machine that already has its own fresh Claude Code install.

   **If Drive is unreachable, there is a complete offline copy** at
   `/run/media/jose/backup/dotclaude/`, all of `~/.claude`, 19 projects' memory:

   ```bash
   rsync -a --exclude='.credentials.json' /run/media/jose/backup/dotclaude/ ~/.claude/
   ```

   ⚠️ The exclusion is not optional: `.credentials.json` is Claude Code's own auth token, is
   machine-bound, and copying it is how you get mystery logouts. Sign in normally instead.
6. The app builds a **plan** first: how many files would be written, which are identical, which
   local copies are newer. What you approve is exactly what runs, and a rollback archive goes to
   `CMK_RECOVERY/` before anything is touched.

---

## Then

```bash
cd ~/Documents/DEVELOPMENT/CLAUDE/Clarity
claude
```

and open with:

> "Resume the Clarity project. Read your memory files for context."

If the memories did not land, the giveaway is Claude having no idea what Couch or Installer are.
Check that `~/.claude/projects/-home-jose-Documents-DEVELOPMENT-CLAUDE-Clarity/memory/`
exists and holds ~38 `.md` files with `MEMORY.md` among them.

---

## What is deliberately never carried across

`.credentials.json` (Claude Code's own auth token, machine-bound, and copying it is how you get
mystery logouts), live session runtime state, and caches. From `~/.claude.json`: `machineID`,
`userID`, `oauthAccount` and onboarding flags, so two installs never claim to be the same one.

Read `~/Documents/DEVELOPMENT/CLAUDE/ClaudeMemKeeper/README.md` for the full picture.
