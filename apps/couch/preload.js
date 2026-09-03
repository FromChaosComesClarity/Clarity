const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getBaseDir: () => ipcRenderer.invoke('get-basedir'),
                                getGames: () => ipcRenderer.invoke('get-games'),
                                genreList: () => ipcRenderer.invoke('genre-list'),
                                setGameGenres: (id, slugs) => ipcRenderer.invoke('set-game-genres', id, slugs),
                                launchGame: (cmd) => ipcRenderer.send('launch-game', cmd),
                                quitApp: () => ipcRenderer.send('quit-app'),
                                saveDbField: (data) => ipcRenderer.send('save-db-field', data),
                                fetchHltb: (g) => ipcRenderer.invoke('fetch-hltb', g),
                                fetchProton: (id) => ipcRenderer.invoke('fetch-proton', id),
                                checkLocalTrailer: (g) => ipcRenderer.invoke('check-local-trailer', g),
                                getAudioConfig: () => ipcRenderer.invoke('get-audio-config'),
                                saveAudioConfig: (cfg) => ipcRenderer.send('save-audio-config', cfg),
                                getCustomMusic: () => ipcRenderer.invoke('get-custom-music'),
                                getStandardBgm: (m) => ipcRenderer.invoke('get-standard-bgm', m),
                                getSetting: (k) => ipcRenderer.invoke('get-setting', k),
                                omarchyTheme: () => ipcRenderer.invoke('omarchy-theme'),
                                onOmarchyThemeChanged: (cb) => ipcRenderer.on('omarchy-theme-changed', (_e, d) => cb(d)),
                                setSetting: (k, v) => ipcRenderer.invoke('set-setting', k, v),
                                getHomeStats: (opts) => ipcRenderer.invoke('get-home-stats', opts),
                                getRandomGame: (c) => ipcRenderer.invoke('get-random-game', c),
                                wishlistDeals: () => ipcRenderer.invoke('wishlist-deals'),
                                freeGames: () => ipcRenderer.invoke('free-games'),
                                getNews: () => ipcRenderer.invoke('get-news'),
                                getGameNews: () => ipcRenderer.invoke('get-game-news'),
                                fetchArticle: (url) => ipcRenderer.invoke('fetch-article', url),
                                protonWatchGet: () => ipcRenderer.invoke('proton-watch-get'),
                                achGet: () => ipcRenderer.invoke('ach-get'),
                                verifyInstallStatus: (id) => ipcRenderer.invoke('verify-install-status', id),
                                launcherStates: (id) => ipcRenderer.invoke('launcher-states', id),
                                openInstallUrl: (url) => ipcRenderer.invoke('open-install-url', url),
                                onInstallStatusUpdated: (cb) => ipcRenderer.on('install-status-updated', () => cb()),
                                onGameLaunchFailed: (cb) => ipcRenderer.on('game-launch-failed', (e, d) => cb(d)),
                                onGameLaunchProgress: (cb) => ipcRenderer.on('game-launch-progress', (e, d) => cb(d)),
                                searchSteam: (g) => ipcRenderer.invoke('search-steam', g),
                                searchIgdb: (g) => ipcRenderer.invoke('search-igdb', g),
                                scrapeIgdbData: (g, mode, id) => ipcRenderer.invoke('scrape-igdb-data', g, mode, id),
                                sgdbSearch: (g, k, id) => ipcRenderer.invoke('sgdb-search', g, k, id),
                                sgdbApply: (g, url) => ipcRenderer.invoke('sgdb-apply', g, url),
                                scrapeSteamData: (g, mode, id) => ipcRenderer.invoke('scrape-steam-data', g, mode, id),
                                getAudioMetadata: (p) => ipcRenderer.invoke('get-audio-metadata', p),
                                getMusicLibrary: () => ipcRenderer.invoke('get-music-library'),
                                getPlaylists: () => ipcRenderer.invoke('get-playlists'),
                                savePlaylists: (pl) => ipcRenderer.send('save-playlists', pl),

                                // --- GAME PLAYLISTS (shared games.db, see The Manager) ---
                                getGamePlaylists: () => ipcRenderer.invoke('get-game-playlist-list'),
                                getPlaylistGames: (id) => ipcRenderer.invoke('get-playlist-games', id),
                                getPlaylistsForGame: (gameId) => ipcRenderer.invoke('get-game-playlists', gameId),
                                addPlaylist: (name) => ipcRenderer.invoke('add-playlist', name),
                                deletePlaylist: (id) => ipcRenderer.invoke('delete-playlist', id),
                                addGameToPlaylist: (plId, gameId) => ipcRenderer.invoke('add-game-to-playlist', plId, gameId),
                                removeGameFromPlaylist: (plId, gameId) => ipcRenderer.invoke('remove-game-from-playlist', plId, gameId),

                                // NEW: Force Focus
                                forceFocus: () => ipcRenderer.send('force-focus'),


                                // FIX: Expose Gaming History IPCs for Couch
                                updateLastPlayed: (gameName) => ipcRenderer.invoke('update-last-played', gameName),
                                clearHistory: () => ipcRenderer.invoke('clear-history'),

                                // --- ACHIEVEMENTS ---
                                getGameAchievements: (appId) => ipcRenderer.invoke('get-game-achievements', appId),
                                fetchAchievementsNow: (appId) => ipcRenderer.invoke('fetch-achievements-now', appId),
                                fetchSteamAchievements: (appId) => ipcRenderer.invoke('fetch-steam-achievements', appId),

                                // --- I18N ---
                                getStrings: (lang) => ipcRenderer.invoke('get-strings', lang),

                                // --- Installer headless install/uninstall ---
                                openInstallerGui: (term) => ipcRenderer.invoke('open-installer-gui', term),
                                syncInstallerInstalled: () => ipcRenderer.invoke('sync-installer-installed'),
                                storeAuthStatus: () => ipcRenderer.invoke('couch-store-auth'),
                                installerGetDefaultInstallDir: () => ipcRenderer.invoke('installer-get-default-install-dir'),
                                getDiskSpace:   (p)   => ipcRenderer.invoke('get-disk-space', p),
                                getInstallSize: (gid) => ipcRenderer.invoke('get-install-size', gid),
                                installerHeadlessInstall: (store, appId, platform, installDir) => ipcRenderer.invoke('installer-headless-install', store, appId, platform, installDir),
                                installerHeadlessUninstall: (store, appId) => ipcRenderer.invoke('installer-headless-uninstall', store, appId),
                                installerGetProgress: () => ipcRenderer.invoke('installer-get-progress'),
                                installerCancelHeadless: () => ipcRenderer.invoke('installer-cancel-headless'),

                                // --- PICO-8 ---
                                scanPico8: () => ipcRenderer.invoke('scan-pico8'),

                                // --- FLATPAK ---
                                scanFlatpak: () => ipcRenderer.invoke('scan-flatpak'),
                                findFlatpakIcon: (n) => ipcRenderer.invoke('find-flatpak-icon', n),
                                readFileBase64: (p) => ipcRenderer.invoke('read-file-base64', p),
                                saveFlatpakArt: (id, c, h, i) => ipcRenderer.invoke('save-flatpak-art', id, c, h, i),
});
