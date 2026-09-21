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

    // Settings, straight through the shared handlers every face uses
    getSetting: (key) => ipcRenderer.invoke('get-setting', key),
    setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),

    // Theme: current palette, plus a feed so `omarchy theme set` restyles this
    // face while it is open rather than on next launch.
    theme: () => ipcRenderer.invoke('omarchy-theme'),
    onThemeChanged: (fn) => ipcRenderer.on('omarchy-theme-changed', (_e, description) => fn(description)),

    // Verbs
    play: (gameId) => ipcRenderer.send('crt-play', gameId),
    openFace: (face) => ipcRenderer.send('crt-open-face', face),
    quit: () => ipcRenderer.send('crt-quit'),
});
