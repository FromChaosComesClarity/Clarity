'use strict';
/*
 * Clarity, unified suite entry point.
 *
 * One Electron process, four faces, dispatched by argv:
 *   (default)              → Manager  (Clarity)      windowed library hub
 *   installer <subcommand>   → Installer  engine/GUI   [wired in Phase 1]
 *   --couch | --fullscreen → Couch    fullscreen   [wired in Phase 3]
 *   --crt                  → CRT      menu face for a tube TV at 480i
 *
 * ⚠️ CRT is not a smaller Couch. Couch is an art-led fullscreen browser built
 * for a modern panel; CRT is a menu-led face for 720x480 interlaced composite,
 * where art is unreadable, hairlines flicker and everything has to survive
 * overscan. Keeping it a separate face is also what keeps it out of the way:
 * nothing about the desktop UI changes because this exists.
 *
 * Each face owns its own app identity (app.setName) so the one that runs in a
 * given process resolves the correct userData / single-instance lock. The
 * Installer face uses 'clarity-installer' so its CLI (launch/install/uninstall-headless/
 * setup) and data dir stay separate from the Manager's.
 */

const args        = process.argv.slice(1);
const positional   = args.filter(a => a !== '.' && !a.startsWith('-'));
const wantsInstaller = positional[0] === 'installer';
const wantsCouch   = args.includes('--couch') || args.includes('--fullscreen');
const wantsCrt     = args.includes('--crt');

if (wantsInstaller) {
    require('./apps/installer/main.js');
} else if (wantsCrt) {
    require('./apps/crt/main.js');
} else if (wantsCouch) {
    require('./apps/couch/main.js');
} else {
    require('./apps/manager/main.js');
}
