'use strict';
/*
 * @clarity/core, platform backend selector.
 *
 * One backend per host OS, chosen once at require time. Everything that is shaped by the
 * operating system, where files live, what runs a Windows game, how a URL scheme is
 * opened, where Steam keeps its library, lives behind this boundary so the rest of the
 * suite can stay host-agnostic.
 *
 * The contract is grouped by concern rather than flattened, because the concerns have
 * genuinely different lifetimes: `runtime` (the Windows-game compatibility layer) is the
 * one a new backend implements last, and a backend is useful long before it has one.
 *
 * Adding a host = adding a file here. Nothing else in the suite should ever branch on
 * `process.platform`.
 */

const fs   = require('fs');
const path = require('path');

const BACKENDS = { linux: 'linux.js', darwin: 'darwin.js' };

const file = BACKENDS[process.platform];
if (!file || !fs.existsSync(path.join(__dirname, file))) {
    throw new Error(
        `Clarity has no platform backend for "${process.platform}". ` +
        `Supported: ${Object.keys(BACKENDS).filter(k => fs.existsSync(path.join(__dirname, BACKENDS[k]))).join(', ')}.`
    );
}

module.exports = require('./' + file);
