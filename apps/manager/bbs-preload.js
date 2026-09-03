const { ipcRenderer } = require('electron');
window._clarityBbs = {
    minimize: () => ipcRenderer.send('bbs-minimize'),
    close:    () => window.close()
};
