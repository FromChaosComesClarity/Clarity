'use strict';
/*
 * The CRT face's bridge. Narrow on purpose: this face reads the library, reads
 * and writes settings, follows the theme, and hands three verbs back to the
 * main process. Anything beyond that belongs to a face that has the screen
 * space to do it properly.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crt', {
    // Library
    library: () => ipcRenderer.invoke('crt-library'),
    // Artwork and the blurb for one game, fetched when its screen opens.
    game: (gameId) => ipcRenderer.invoke('crt-game', gameId),

    // Scraping: art and details, fetched from here so the desktop stays
    // optional. `scrapeOne` without an appId lets the scraper find the game
    // itself; with one, it is the answer to "no, *this* game".
    steamSearch: (name) => ipcRenderer.invoke('crt-steam-search', name),
    scrapeOne: (gameId, appId) => ipcRenderer.invoke('crt-scrape-one', gameId, appId),
    scrapeBatch: (scope) => ipcRenderer.invoke('crt-scrape-batch', scope),
    scrapeStop: () => ipcRenderer.send('crt-scrape-stop'),
    scrapeCounts: () => ipcRenderer.invoke('crt-scrape-counts'),
    onScrapeProgress: (fn) => ipcRenderer.on('crt-scrape-progress', (_e, p) => fn(p)),

    // Installing. GOG and Epic have no client here — the Installer engine does
    // the work, and `storeStatus` says whether it can (a library on disk, and
    // an account signed in) before the face offers anything.
    storeStatus: () => ipcRenderer.invoke('crt-store-status'),
    storeAvailable: () => ipcRenderer.invoke('crt-store-available'),
    storeRefresh: () => ipcRenderer.invoke('crt-store-refresh'),
    install: (id) => ipcRenderer.invoke('crt-install', id),
    uninstall: (id) => ipcRenderer.invoke('crt-uninstall', id),
    installCancel: () => ipcRenderer.send('crt-install-cancel'),
    installerEntry: (gameId) => ipcRenderer.invoke('crt-installer-entry', gameId),
    // One channel for both installs and launches — read `step` to tell them
    // apart, which is how the engine itself reports.
    onEngineProgress: (fn) => ipcRenderer.on('crt-engine-progress', (_e, info) => fn(info)),

    // Settings, straight through the shared handlers every face uses
    getSetting: (key) => ipcRenderer.invoke('get-setting', key),
    setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),

    // Theme: current palette, plus a feed so `omarchy theme set` restyles this
    // face while it is open rather than on next launch.
    theme: () => ipcRenderer.invoke('omarchy-theme'),
    onThemeChanged: (fn) => ipcRenderer.on('omarchy-theme-changed', (_e, description) => fn(description)),

    // Starting a game. `launchers` is every way this row can be started —
    // usually one, sometimes one per store — and `launch` runs the chosen one
    // here, in this process, without leaving the face.
    launchers: (gameId) => ipcRenderer.invoke('crt-launchers', gameId),
    launch: (gameId, cmd) => ipcRenderer.invoke('crt-launch', gameId, cmd),
    onLaunchFailed: (fn) => ipcRenderer.on('crt-launch-failed', (_e, info) => fn(info)),
    openFace: (face) => ipcRenderer.send('crt-open-face', face),
    quit: () => ipcRenderer.send('crt-quit'),
});
