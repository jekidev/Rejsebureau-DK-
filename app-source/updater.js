const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Keep updater isolated so the rest of the app can run without update config in dev.
function setupAutoUpdater({ sendStatus, onDownloaded } = {}) {
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = 'info';
  autoUpdater.autoDownload = true;

  autoUpdater.on('checking-for-update', () => sendStatus?.({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendStatus?.({ state: 'available', info }));
  autoUpdater.on('update-not-available', (info) => sendStatus?.({ state: 'none', info }));
  autoUpdater.on('error', (err) => sendStatus?.({ state: 'error', error: err?.message || String(err) }));
  autoUpdater.on('download-progress', (p) => sendStatus?.({ state: 'downloading', progress: p }));
  autoUpdater.on('update-downloaded', (info) => {
    sendStatus?.({ state: 'downloaded', info });
    try { onDownloaded?.(info); } catch { }
  });
}

async function checkForUpdates() {
  // In dev mode autoUpdater often isn't configured; fail gracefully.
  try {
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

async function downloadUpdate() {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

function quitAndInstall() {
  try {
    autoUpdater.quitAndInstall();
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

module.exports = { setupAutoUpdater, checkForUpdates, downloadUpdate, quitAndInstall };
