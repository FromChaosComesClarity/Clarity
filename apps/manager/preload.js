const { contextBridge, ipcRenderer, webFrame, clipboard } = require('electron');

// ⚠️ Read here, synchronously, purely so the pre-paint script in index.html can know it. The
// compact-chrome default depends on being on Omarchy, and everything else that knows that is
// an async IPC away, which is one round trip too late to avoid the window being shown with a
// title bar it is about to remove. A cached value covers every later run; this covers the
// first one, when there is nothing cached yet.
const _isOmarchy = (() => {
    try { return /^ID=omarchy\s*$/m.test(require('fs').readFileSync('/etc/os-release', 'utf8')); }
    catch { return false; }
})();

contextBridge.exposeInMainWorld('api', {
    platform: process.platform,
    isOmarchy: _isOmarchy,
    getBaseDir: () => ipcRenderer.invoke('get-basedir'),
                                getGames: () => ipcRenderer.invoke('get-games'),
                                genreList: () => ipcRenderer.invoke('genre-list'),
                                dosboxStatus: () => ipcRenderer.invoke('dosbox-status'),
                                setDosboxMode: (m) => ipcRenderer.invoke('set-dosbox-mode', m),
                                manualList: (id) => ipcRenderer.invoke('manual-list', id),
                                attachManual: (id, p, label, src) => ipcRenderer.invoke('attach-manual', id, p, label, src),
                                pickManual: (id) => ipcRenderer.invoke('pick-manual', id),
                                removeManual: (mid, gid) => ipcRenderer.invoke('remove-manual', mid, gid),
                                gogManualList: (id) => ipcRenderer.invoke('gog-manual-list', id),
                                gogManualDownload: (id, bid) => ipcRenderer.invoke('gog-manual-download', id, bid),
                                onManualDownloadProgress: (cb) => ipcRenderer.on('manual-download-progress', (_e, d) => cb(d)),
                                openManualViewer: (opts) => ipcRenderer.invoke('open-manual-viewer', opts),
                                openManualExternally: (p) => ipcRenderer.invoke('open-manual-externally', p),
                                manualWindowClose: () => ipcRenderer.invoke('game-manual-close'),
                                manualWindowMinimize: () => ipcRenderer.invoke('game-manual-minimize'),
                                setGameGenres: (id, slugs) => ipcRenderer.invoke('set-game-genres', id, slugs),
                                addGame: (name) => ipcRenderer.invoke('add-game', name),
                                updateGame: (id, data) => ipcRenderer.invoke('update-game', id, data),
                                setGameFlag: (id, field, value) => ipcRenderer.invoke('set-game-flag', id, field, value),
                                notify: (p) => ipcRenderer.invoke('notify', p),
                                deleteGame: (id) => ipcRenderer.invoke('delete-game', id),
                                signalReady: () => ipcRenderer.send('renderer-ready'),
                                verifyInstallStatus: (id) => ipcRenderer.invoke('verify-install-status', id),
                                launcherStates: (id) => ipcRenderer.invoke('launcher-states', id),
                                openInstallUrl: (url) => ipcRenderer.invoke('open-install-url', url),
                                openExternal: (url) => ipcRenderer.invoke('open-install-url', url),
                                checkAllInstallStatus: () => ipcRenderer.invoke('check-all-install-status'),
                                scanUpdates: () => ipcRenderer.invoke('scan-updates'),
                                onUpdateScanProgress: (cb) => ipcRenderer.on('update-scan-progress', (_e, d) => cb(d)),
                                scanGenres: (opts) => ipcRenderer.invoke('scan-genres', opts),
                                cancelGenreScan: () => ipcRenderer.invoke('cancel-genre-scan'),
                                quickGenrePass: () => ipcRenderer.invoke('quick-genre-pass'),
                                onGenreScanProgress: (cb) => ipcRenderer.on('genre-scan-progress', (_e, d) => cb(d)),
                                scanMacNative: (opts) => ipcRenderer.invoke('scan-mac-native', opts),
                                onMacNativeScanProgress: (cb) => ipcRenderer.on('mac-native-scan-progress', (_e, d) => cb(d)),
                                addGameShortcut: (id, targets) => ipcRenderer.invoke('add-game-shortcut', id, targets),
                                resolveGameFolder: (id) => ipcRenderer.invoke('resolve-game-folder', id),
                                openGameFolder: (id) => ipcRenderer.invoke('open-game-folder', id),
                                savesResolve:      (id)       => ipcRenderer.invoke('gog-saves-resolve', id),
                                savesBackup:       (id, dirs) => ipcRenderer.invoke('gog-backup-saves', id, dirs),
                                savesRestorePreview:(id, zip)  => ipcRenderer.invoke('gog-restore-preview', id, zip),
                                savesRestoreCommit:(id, zip)  => ipcRenderer.invoke('gog-restore-commit', id, zip),
                                savesDeleteBackup: (id, p)    => ipcRenderer.invoke('gog-delete-backup', id, p),
                                savesSetOverride:  (id)       => ipcRenderer.invoke('gog-set-save-override', id),
                                savesClearOverride:(id)       => ipcRenderer.invoke('gog-clear-save-override', id),
                                setLaunchCommand: (id, cmd) => ipcRenderer.invoke('set-launch-command', id, cmd),
                                onInstallStatusUpdated: (cb) => ipcRenderer.on('install-status-updated', () => cb()),
                                scanFlatpak: () => ipcRenderer.invoke('scan-flatpak'),

                                // --- PICO-8 ---
                                getPico8Status: () => ipcRenderer.invoke('get-pico8-status'),
                                browsePico8Binary: () => ipcRenderer.invoke('browse-pico8-binary'),
                                launchPico8Splore: () => ipcRenderer.invoke('launch-pico8-splore'),
                                scanPico8: () => ipcRenderer.invoke('scan-pico8'),
                                launchPico8Bbs: (accent) => ipcRenderer.invoke('launch-pico8-bbs', accent),
                                openPico8Folder: () => ipcRenderer.invoke('open-pico8-folder'),
                                getPico8Opts: () => ipcRenderer.invoke('get-pico8-opts'),
                                setPico8Opt: (k, v) => ipcRenderer.invoke('set-pico8-opt', k, v),
                                onPico8CartDownloaded: (cb) => ipcRenderer.on('pico8-cart-downloaded', (e, d) => cb(d)),
                                findFlatpakIcon: (n) => ipcRenderer.invoke('find-flatpak-icon', n),
                                readFileBase64: (p) => ipcRenderer.invoke('read-file-base64', p),
                                saveFlatpakArt: (id, c, h, i) => ipcRenderer.invoke('save-flatpak-art', id, c, h, i),
                                syncItch: () => ipcRenderer.invoke('sync-itch'),
                                syncSteam: (steamId, apiKey) => ipcRenderer.invoke('sync-steam', steamId, apiKey),
                                autoFetch: (id, name, appId) => ipcRenderer.invoke('auto-fetch', id, name, appId),
                                autoFetchText: (id, name, appId) => ipcRenderer.invoke('auto-fetch-text', id, name, appId),
                                searchSteam: (name) => ipcRenderer.invoke('search-steam', name),
                                launchGame: (cmd, launchArgs, executable) => ipcRenderer.send('launch-game', cmd, launchArgs, executable),
                                syncGog: () => ipcRenderer.invoke('sync-gog'),

                                // --- GAMING HISTORY ---
                                updateLastPlayed: (id) => ipcRenderer.invoke('update-last-played', id),
                                clearHistory: () => ipcRenderer.invoke('clear-history'),

                                // --- UI SCALING ---
                                setZoomLevel: (level) => webFrame.setZoomFactor(level),
                                // Support details are shown in-app rather than opened in a browser,
                                // so copying has to actually work, Electron's own clipboard does it
                                // without needing a secure context.
                                copyText: (t) => { try { clipboard.writeText(String(t ?? '')); return true; } catch { return false; } },
                                // Work area of the display this window belongs on, plus a
                                // signature of the whole monitor set, see 'ui-screen-info'
                                // in main.js for why `window.screen` is the wrong source.
                                getScreenInfo: () => ipcRenderer.invoke('ui-screen-info'),

                                // --- HLTB, PROTON, SGDB & LOCAL MEDIA ---
                                fetchHltb: (g) => ipcRenderer.invoke('fetch-hltb', g),
                                fetchProton: (id) => ipcRenderer.invoke('fetch-proton', id),

                                sgdbSearch: (g, k, id, assetType) => ipcRenderer.invoke('sgdb-search', g, k, id, assetType),
                                sgdbApply: (id, url, assetType) => ipcRenderer.invoke('sgdb-apply', id, url, assetType),

                                selectLocalImage: (id, type) => ipcRenderer.invoke('select-local-image', id, type),
                                getSetting: (k) => ipcRenderer.invoke('get-setting', k),
                                setSetting: (k, v) => ipcRenderer.invoke('set-setting', k, v),
                                getAppVersion: () => ipcRenderer.invoke('get-app-version'),
                                getHomeStats: (opts) => ipcRenderer.invoke('get-home-stats', opts),
                                getRandomGame: (c) => ipcRenderer.invoke('get-random-game', c),
                                itadSearch: (q) => ipcRenderer.invoke('itad-search', q),
                                wishlistGet: () => ipcRenderer.invoke('wishlist-get'),
                                wishlistAdd: (item) => ipcRenderer.invoke('wishlist-add', item),
                                wishlistRemove: (id) => ipcRenderer.invoke('wishlist-remove', id),
                                wishlistDeals: () => ipcRenderer.invoke('wishlist-deals'),
                                freeGames: () => ipcRenderer.invoke('free-games'),
                                getNews: () => ipcRenderer.invoke('get-news'),
                                getGameNews: () => ipcRenderer.invoke('get-game-news'),
                                protonCheck: () => ipcRenderer.invoke('proton-check'),
                                protonWatchGet: () => ipcRenderer.invoke('proton-watch-get'),
                                diskScan: () => ipcRenderer.invoke('disk-scan'),
                                diskGet: () => ipcRenderer.invoke('disk-get'),
                                achScan: () => ipcRenderer.invoke('ach-scan'),
                                achGet: () => ipcRenderer.invoke('ach-get'),
                                openWebPopup: (url) => ipcRenderer.invoke('open-web-popup', url),

                                // --- TRAILERS ---
                                checkLocalTrailer: (g) => ipcRenderer.invoke('check-local-trailer', g),
                                fetchSteamTrailer: (appId) => ipcRenderer.invoke('fetch-steam-trailer', appId),
                                searchYoutube: (g) => ipcRenderer.invoke('search-youtube', g),
                                downloadTrailer: (g, id) => ipcRenderer.invoke('download-trailer', g, id),
                                deleteTrailer: (g) => ipcRenderer.invoke('delete-trailer', g),
                                onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (e, d) => cb(d)),

                                // --- DATA TOOLS & CSV ---
                                downloadCsvTemplate: () => ipcRenderer.invoke('download-csv-template'),
                                exportCsv: () => ipcRenderer.invoke('export-csv'),
                                importCsv: () => ipcRenderer.invoke('import-csv'),
                                clearBrowserData: () => ipcRenderer.invoke('clear-browser-data'),
                                backupZip: () => ipcRenderer.invoke('backup-zip'),
                                restoreZip: () => ipcRenderer.invoke('restore-zip'),
                                onZipStarted: (cb) => ipcRenderer.on('zip-started', () => cb()),

                                // FIX: New Image Cleanup Tools
                                cleanUnusedImages: () => ipcRenderer.invoke('clean-unused-images'),
                                clearAllImages: () => ipcRenderer.invoke('clear-all-images'),

                                // --- SYSTEM ---
                                installToMenu: () => ipcRenderer.invoke('install-to-menu'),
                                getCouchAutostart: () => ipcRenderer.invoke('get-couch-autostart'),
                                setCouchAutostart: (en) => ipcRenderer.invoke('set-couch-autostart', en),

                                // --- Couch COMPANION ---
                                checkCouch: () => ipcRenderer.invoke('check-couch'),
                                launchCouch: () => ipcRenderer.send('launch-couch'),

                                // --- EMULATTE ---
                                checkEmuLatte: () => ipcRenderer.invoke('check-emulatte'),
                                launchEmuLatte: () => ipcRenderer.send('launch-emulatte'),

                                // --- ACHIEVEMENTS ---
                                getGameAchievements: (appId) => ipcRenderer.invoke('get-game-achievements', appId),
                                fetchAchievementsNow: (appId) => ipcRenderer.invoke('fetch-achievements-now', appId),
                                fetchSteamAchievements: (appId) => ipcRenderer.invoke('fetch-steam-achievements', appId),

                                // --- IGDB ---
                                igdbTest: () => ipcRenderer.invoke('igdb-test'),
                                igdbSearchList: (name) => ipcRenderer.invoke('igdb-search-list', name),
                                igdbFetchScreenshots: (id) => ipcRenderer.invoke('igdb-fetch-screenshots', id),
                                igdbSaveScreenshot: (gameId, url) => ipcRenderer.invoke('igdb-save-screenshot', gameId, url),

                                // --- I18N ---
                                getStrings: (lang) => ipcRenderer.invoke('get-strings', lang),

                                // --- STORE BROWSER ---
                                openStoreBrowser: (store, colors) => ipcRenderer.invoke('open-store-browser', store, colors),

                                // --- Installer ---
                                installerStatus: () => ipcRenderer.invoke('installer-status'),
                                // --- headless GOG/Epic sign-in (no Installer window) ---
                                gogLogin:       () => ipcRenderer.invoke('gog-login'),
                                gogAuthStatus:  () => ipcRenderer.invoke('gog-auth-status'),
                                gogLogout:      () => ipcRenderer.invoke('gog-logout'),
                                epicLogin:      () => ipcRenderer.invoke('epic-login'),
                                epicAuthStatus: () => ipcRenderer.invoke('epic-auth-status'),
                                syncInstallerInstalled: (ids) => ipcRenderer.invoke('sync-installer-installed', ids),
                                syncAllInstallerGames: (games, p) => ipcRenderer.invoke('sync-all-installer-games', games, p),
                                installerRefreshOwned: () => ipcRenderer.invoke('installer-refresh-owned'),
                                // --- in-process install (no Installer window) ---
                                installerInstall:   (payload) => ipcRenderer.invoke('installer-install', payload),
                                dlcList:          (installerGameId, platform) => ipcRenderer.invoke('dlc-list', installerGameId, platform),
                                // Reinstall a GOG game's redistributables into its prefix, see
                                // 'installer-run-redist' in main.js for why this exists.
                                runRedist:        (installerGameId) => ipcRenderer.invoke('installer-run-redist', installerGameId),
                                onRedistProgress: (cb) => ipcRenderer.on('redist-progress', (_e, d) => cb(d)),
                                playTasks:        (installerGameId) => ipcRenderer.invoke('play-tasks', installerGameId),
                                customRecipeList: () => ipcRenderer.invoke('custom-recipe-list'),
                                customInstallPick:(recipeId) => ipcRenderer.invoke('custom-install-pick', recipeId),
                                customInstall:    (payload) => ipcRenderer.invoke('custom-install', payload),
                                displayOptions:  () => ipcRenderer.invoke('display-options'),
                                setGameDisplay:  (i) => ipcRenderer.invoke('set-game-display', i),
                                installerSetEnvVar: (payload) => ipcRenderer.invoke('installer-set-env-var', payload),
                                // Per-game compatibility, what Installer's setup modal used to own.
                                installerCompatGet: (gid) => ipcRenderer.invoke('installer-compat-get', gid),
                                installerCompatSet: (payload) => ipcRenderer.invoke('installer-compat-set', payload),
                                installerSetLaunchTarget: (payload) => ipcRenderer.invoke('installer-set-launch-target', payload),
                                installerStorageList: () => ipcRenderer.invoke('installer-storage-list'),
                                omarchyStatus:   () => ipcRenderer.invoke('omarchy-status'),
                                omarchyInstallTools: (keys) => ipcRenderer.invoke('omarchy-install-tools', keys),
                                omarchyRunInstaller: (key) => ipcRenderer.invoke('omarchy-run-installer', key),
                                omarchyApplyTuning: () => ipcRenderer.invoke('omarchy-apply-tuning'),
                                omarchyTheme:    () => ipcRenderer.invoke('omarchy-theme'),
                                // Fires when the user runs `omarchy theme set`, so the app can follow.
                                onOmarchyThemeChanged: (cb) => ipcRenderer.on('omarchy-theme-changed', (_e, d) => cb(d)),
                                customFolderPick: (title) => ipcRenderer.invoke('custom-folder-pick', title),
                                customFolderScan: (folder) => ipcRenderer.invoke('custom-folder-scan', folder),
                                customFolderAdd:  (payload) => ipcRenderer.invoke('custom-folder-add', payload),
                                customIwadOptions:(installerGameId) => ipcRenderer.invoke('custom-iwad-options', installerGameId),
                                customEngineOptions:(installerGameId) => ipcRenderer.invoke('custom-engine-options', installerGameId),
                                customSetEngine: (installerGameId, exe) => ipcRenderer.invoke('custom-set-engine', installerGameId, exe),
                                customSetIwad:    (installerGameId, iwad) => ipcRenderer.invoke('custom-set-iwad', installerGameId, iwad),
                                setLaunchTarget:  (installerGameId, relPath, taskIndex) => ipcRenderer.invoke('set-launch-target', installerGameId, relPath, taskIndex),
                                installerCancelInstall: () => ipcRenderer.invoke('installer-install-cancel'),
                                installerUninstall: (payload) => ipcRenderer.invoke('installer-uninstall', payload),
                                installerDefaultDir: () => ipcRenderer.invoke('installer-default-dir'),
                                installerSetDefaultDir: (dir) => ipcRenderer.invoke('installer-set-default-dir', dir),
                                installerPickDir:    (current) => ipcRenderer.invoke('installer-pick-dir', current),
                                getDiskSpace:      (p)   => ipcRenderer.invoke('get-disk-space', p),
                                getInstallSize:    (gid, platform) => ipcRenderer.invoke('get-install-size', gid, platform),
                                installerPlatforms:  (gid) => ipcRenderer.invoke('installer-platforms', gid),
                                onInstallerInstallProgress: (cb) => ipcRenderer.on('installer-install-progress', (e, d) => cb(d)),

                                // --- Proton (compatibility layer for Windows games) ---
                                protonList:          ()  => ipcRenderer.invoke('proton-list'),
                                protonSetDefault:    (p) => ipcRenderer.invoke('proton-set-default', p),
                                protonInstallLatest: ()  => ipcRenderer.invoke('proton-install-latest'),
                                protonInstallCancel: ()  => ipcRenderer.invoke('proton-install-cancel'),
                                onProtonInstallProgress: (cb) => ipcRenderer.on('proton-install-progress', (e, d) => cb(d)),
                                onGameLaunchFailed:  (cb) => ipcRenderer.on('game-launch-failed', (e, d) => cb(d)),
                                onGameLaunchProgress: (cb) => ipcRenderer.on('game-launch-progress', (e, d) => cb(d)),
                                onWindowRefocused: (cb) => ipcRenderer.on('window-refocused', () => cb()),
                                onOpenGame: (cb) => ipcRenderer.on('open-game', (e, id) => cb(id)),
                                applyHyprlandRulesNow: () => ipcRenderer.invoke('apply-hyprland-rules-now'),
                                // --play=<id> / --action=<id>, the Omarchy launcher overlay's way in.
                                onPlayGame: (cb) => ipcRenderer.on('play-game', (e, id) => cb(id)),
                                onRunAction: (cb) => ipcRenderer.on('run-action', (e, id) => cb(id)),
                                publishPaletteActions: (actions) => ipcRenderer.send('publish-palette-actions', actions),

                                // --- PLAYLISTS ---
                                getPlaylists:           ()           => ipcRenderer.invoke('get-playlists'),
                                addPlaylist:            (name, rule) => ipcRenderer.invoke('add-playlist', name, rule),
                                previewPlaylistRule:    (rule)       => ipcRenderer.invoke('preview-playlist-rule', rule),
                                updatePlaylist:         (id, name)   => ipcRenderer.invoke('update-playlist', id, name),
                                deletePlaylist:         (id)         => ipcRenderer.invoke('delete-playlist', id),
                                getPlaylistGames:       (plId)       => ipcRenderer.invoke('get-playlist-games', plId),
                                addGameToPlaylist:      (plId, gId)  => ipcRenderer.invoke('add-game-to-playlist', plId, gId),
                                removeGameFromPlaylist: (plId, gId)  => ipcRenderer.invoke('remove-game-from-playlist', plId, gId),
                                getGamePlaylists:       (gId)        => ipcRenderer.invoke('get-game-playlists', gId),
                                getRecentlyImported:    (limit)      => ipcRenderer.invoke('get-recently-imported', limit),

                                // --- MANUAL ---
                                openManual: () => ipcRenderer.send('open-manual'),

                                // --- WINDOW CONTROLS ---
                                minimizeApp: () => ipcRenderer.send('window-minimize'),
                                maximizeApp: () => ipcRenderer.send('window-maximize'),
                                closeApp: () => ipcRenderer.send('window-close'),

                                // --- COMMAND BAR ---
                                runShellCmd: (cmd) => ipcRenderer.invoke('run-shell-cmd', cmd)
});
