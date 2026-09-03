'use strict';
/*
 * Clarity — unified suite entry point.
 *
 * One Electron process, three faces, dispatched by argv:
 *   (default)              → Manager  (Clarity)      windowed library hub
 *   installer <subcommand>   → Installer  engine/GUI   [wired in Phase 1]
 *   --couch | --fullscreen → Couch    fullscreen   [wired in Phase 3]
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

if (wantsInstaller) {
    require('./apps/installer/main.js');
} else if (wantsCouch) {
    require('./apps/couch/main.js');
} else {
    require('./apps/manager/main.js');
}
