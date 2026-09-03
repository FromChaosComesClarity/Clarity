const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
    platform: process.platform,

    // Window controls
    minimize:    () => ipcRenderer.send('window-minimize'),
    maximize:    () => ipcRenderer.send('window-maximize'),
    close:       () => ipcRenderer.send('window-close'),
    signalReady: () => ipcRenderer.send('renderer-ready'),

    // UI scale
    setZoom: (f) => webFrame.setZoomFactor(f),

    // Games
    getGames:   ()       => ipcRenderer.invoke('get-games'),
    addGame:    (data)   => ipcRenderer.invoke('add-game', data),
    updateGame: (id, d)  => ipcRenderer.invoke('update-game', id, d),
    deleteGame:          (id)     => ipcRenderer.invoke('delete-game', id),
    uninstallGameFiles:  (id)     => ipcRenderer.invoke('uninstall-game-files', id),
    launchGame: (id)     => ipcRenderer.invoke('launch-game', id),
    launchGameVerbose: (id) => ipcRenderer.invoke('launch-game-verbose', id),
    stopGameLog: (id)    => ipcRenderer.invoke('stop-game-log', id),
    onGameLogLine: (cb)  => ipcRenderer.on('game-log-line', (_, d) => cb(d)),

    // Settings
    getSetting:    (k)    => ipcRenderer.invoke('get-setting', k),
    setSetting:    (k, v) => ipcRenderer.invoke('set-setting', k, v),
    getInstallLog: ()     => ipcRenderer.invoke('get-install-log'),
    saveInstallLog:(log)  => ipcRenderer.invoke('save-install-log', log),
    getClarityTheme:  ()     => ipcRenderer.invoke('get-clarity-theme'),
    getUiFont:     ()     => ipcRenderer.invoke('get-ui-font'),

    // Disk size (installed game)
    getDiskSize:      (p)              => ipcRenderer.invoke('get-disk-size', p),
    getAllDiskSizes:   ()               => ipcRenderer.invoke('get-all-disk-sizes'),
    verifyInstalls:   ()               => ipcRenderer.invoke('verify-installs'),
    // Pre-install size info
    gogInstallInfo:   (id, platform)   => ipcRenderer.invoke('gog-install-info', id, platform),
    epicInstallInfo:  (appName)        => ipcRenderer.invoke('epic-install-info', appName),
    getDiskSpace:     (path)           => ipcRenderer.invoke('get-disk-space', path),

    // Environment
    checkTools:   () => ipcRenderer.invoke('check-tools'),
    openPath:     (p) => ipcRenderer.invoke('open-path', p),
    getConfigDir:   () => ipcRenderer.invoke('get-config-dir'),
    openConfigDir:  () => ipcRenderer.invoke('open-config-dir'),
    getGameLog:     (id) => ipcRenderer.invoke('get-game-log', id),
    getLogIndex:    () => ipcRenderer.invoke('get-log-index'),
    scanProton:   () => ipcRenderer.invoke('scan-proton'),
    installUmu:   () => ipcRenderer.invoke('install-umu'),
    onUmuInstallProgress: (cb) => ipcRenderer.on('umu-install-progress', (_, data) => cb(data)),

    // GOG
    fetchGogAchievements: (appId) => ipcRenderer.invoke('fetch-gog-achievements', appId),
    getGogAchievements:   (appId) => ipcRenderer.invoke('get-gog-achievements', appId),
    gogStatus:          ()                    => ipcRenderer.invoke('gog-status'),
    gogLogin:           ()                    => ipcRenderer.invoke('gog-login'),
    gogLogout:          ()                    => ipcRenderer.invoke('gog-logout'),
    gogListOwned:       ()                    => ipcRenderer.invoke('gog-list-owned'),
    gogImport:          (games)               => ipcRenderer.invoke('gog-import', games),
    gogSyncPlatforms:   (games)               => ipcRenderer.invoke('gog-sync-platforms', games),
    gogInstall:         (id, platform, dir, isDlc, baseAppId) => ipcRenderer.invoke('gogdl-install', id, platform, dir, isDlc, baseAppId),
    gogCancelInstall:   ()                    => ipcRenderer.invoke('gogdl-cancel-install'),
    gogRepair:          (id)                  => ipcRenderer.invoke('gogdl-repair', id),
    epicRepair:         (id)                  => ipcRenderer.invoke('legendary-repair', id),
    onGogLoginProgress:   (cb) => ipcRenderer.on('gog-login-progress',   (_, d) => cb(d)),
    onGogInstallProgress: (cb) => ipcRenderer.on('gog-install-progress', (_, d) => cb(d)),
    onCliSearch:          (cb) => ipcRenderer.on('cli-search', (_, term) => cb(term)),

    // Legendary / Epic
    legendaryStatus:       () => ipcRenderer.invoke('legendary-status'),
    legendaryLogin:        () => ipcRenderer.invoke('legendary-login'),
    legendaryListOwned:    () => ipcRenderer.invoke('legendary-list-owned'),
    legendaryListInstalled:() => ipcRenderer.invoke('legendary-list-installed'),
    legendaryImport:       (games) => ipcRenderer.invoke('legendary-import', games),
    onLegendaryLoginProgress: (cb) => ipcRenderer.on('legendary-login-progress', (_, d) => cb(d)),

    // Installation
    selectDirectory:      ()             => ipcRenderer.invoke('select-directory'),
    selectFile:           ()             => ipcRenderer.invoke('select-file'),
    scanGameFolder:       (p)            => ipcRenderer.invoke('scan-game-folder', p),
    installGame:          (id, dir)      => ipcRenderer.invoke('legendary-install', id, dir),
    cancelInstall:        ()             => ipcRenderer.invoke('legendary-cancel-install'),
    getInstallInfo:       (id)           => ipcRenderer.invoke('legendary-install-info', id),
    uninstallGame:        (id)           => ipcRenderer.invoke('legendary-uninstall', id),
    onInstallProgress:    (cb)           => ipcRenderer.on('install-progress', (_, d) => cb(d)),

    // Compat / Winetricks / Redist
    getGamePrefix:        (id)                        => ipcRenderer.invoke('get-game-prefix', id),
    checkWinetricks:      ()                          => ipcRenderer.invoke('check-winetricks'),
    runWinetricks:        (prefix, tricks)            => ipcRenderer.invoke('run-winetricks', prefix, tricks),
    gogInstallRedist:     (appId, plat, inst, prefix, proton) => ipcRenderer.invoke('gogdl-install-redist', appId, plat, inst, prefix, proton),
    onWinetricksProgress: (cb) => ipcRenderer.on('winetricks-progress', (_, d) => cb(d)),
    onRedistProgress:     (cb) => ipcRenderer.on('redist-progress',     (_, d) => cb(d)),
    onCliSetup:           (cb) => ipcRenderer.on('cli-setup', (_, id) => cb(id)),
    onCliSync:            (cb) => ipcRenderer.on('cli-sync',  (_, tab) => cb(tab)),
    onCliStorage:         (cb) => ipcRenderer.on('cli-storage', () => cb()),

    // Destructive actions
    resetInstaller:         () => ipcRenderer.invoke('reset-installer'),
    deleteAllInstallerData: () => ipcRenderer.invoke('delete-all-installer-data'),

    // Play tasks + run-exe
    getPlayTasks:   (id)  => ipcRenderer.invoke('get-play-tasks', id),
    runExeOnPrefix:       (id) => ipcRenderer.invoke('run-exe-on-prefix', id),
    runExeInGameFolder:   (id) => ipcRenderer.invoke('run-exe-in-game-folder', id),

    // GE-Proton downloader / manager
    deleteProton:           (dir)       => ipcRenderer.invoke('delete-proton', dir),
    getProtonReleases:      ()          => ipcRenderer.invoke('get-proton-releases'),
    downloadProton:         (url, tag)  => ipcRenderer.invoke('download-proton', url, tag),
    cancelProtonDownload:   ()          => ipcRenderer.invoke('cancel-proton-download'),
    onProtonDlProgress:     (cb)        => ipcRenderer.on('proton-dl-progress', (_, d) => cb(d)),
});
