const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { TelegramMessenger } = require('./backend/telegram-messenger');
const { ApiFetcher } = require('./backend/api-fetcher-wrapper');
const { BotPluginWrapper } = require('./backend/bot-plugin-wrapper');
const { KeywordMonitor } = require('./backend/keyword-monitor-wrapper');
const { exec, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const { resolvePython } = require('./backend/python-resolver');
const { setupAutoUpdater, checkForUpdates, downloadUpdate, quitAndInstall } = require('./updater');

let mainWindow;
// Multi-account: allow multiple concurrent posting processes (one per account/sessionName).
// Keep scan processes separate so scanning doesn't interfere with running senders.
const messengers = new Map(); // sessionName -> TelegramMessenger
const scanMessengers = new Map(); // sessionName -> TelegramMessenger (scan-only)
const startQueue = []; // { config, createdAt }
const MAX_CONCURRENT_SENDERS = 5;
let botPlugin = null;
let keywordMonitor = null;

function normSessionName(name) {
  const s = String(name || '').trim();
  return s || 'default';
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function runningSenderCount() {
  let n = 0;
  for (const m of messengers.values()) if (m?.isRunning?.()) n += 1;
  return n;
}

async function maybeDrainStartQueue() {
  while (startQueue.length && runningSenderCount() < MAX_CONCURRENT_SENDERS) {
    const item = startQueue.shift();
    const cfg = item?.config;
    if (!cfg) continue;
    try {
      // Fire-and-forget; renderer will get status/log events.
      await startMessagingInternal(cfg, { fromQueue: true });
    } catch { }
  }
}

function getAccountDataDir(sessionName) {
  const s = normSessionName(sessionName);
  return path.join(app.getPath('userData'), 'data', 'accounts', s);
}

function getLogsDir() {
  return path.join(app.getPath('userData'), 'logs');
}

function appendAccountLog(sessionName, line) {
  try {
    const dir = getLogsDir();
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `account_${normSessionName(sessionName)}.log`);
    const ts = new Date().toISOString();
    fs.appendFileSync(p, `[${ts}] ${line}\n`, 'utf8');
  } catch { }
}

function wireMessengerEvents(sessionName, m, { scanMode } = { scanMode: false }) {
  m.on('status', (status) => {
    sendToRenderer('status-update', { sessionName, ...status });
    if (!scanMode && status?.running === false) {
      // If an account stops/crashes, start the next queued sender automatically.
      try { maybeDrainStartQueue(); } catch { }
    }
  });
  m.on('log', (log) => {
    sendToRenderer('log-update', { sessionName, ...log });
    if (log?.message) appendAccountLog(sessionName, `[${log.type || 'info'}] ${log.message}`);
  });
  m.on('qr', (data) => sendToRenderer('qr-login', { sessionName, ...(data || {}) }));
  m.on('error', (error) => {
    sendToRenderer('error-update', { sessionName, ...error });
    if (error?.message) appendAccountLog(sessionName, `[error] ${error.message}`);
    if (scanMode) sendToRenderer('scan-error', { sessionName, message: error.message });
  });
  m.on('needsCode', () => {
    sendToRenderer('needs-code', { sessionName });
    if (scanMode) sendToRenderer('scan-status', { sessionName, message: 'Indtast bekraeftelseskode...' });
  });
  m.on('needsPassword', () => {
    sendToRenderer('needs-password', { sessionName });
    if (scanMode) sendToRenderer('scan-status', { sessionName, message: 'Indtast 2FA password...' });
  });
  m.on('groupsScanned', (data) => {
    sendToRenderer('groups-scanned', { sessionName, ...data });
    if (scanMode) sendToRenderer('scan-status', { sessionName, message: `Fandt ${data.groups.length} grupper!` });
  });
}

async function startMessagingInternal(config, { fromQueue } = {}) {
  try {
    const lic = requireValidLicense();
    if (!lic.ok) return { success: false, error: lic.error };

    const sessionName = normSessionName(config?.sessionName);
    const connectOnly = !!config?.connectOnly;

    if (messengers.get(sessionName)?.isRunning()) {
      return { success: false, error: 'Messaging is already running for this account' };
    }

    // Ensure no scan is running for this account.
    if (scanMessengers.has(sessionName)) {
      await stopAndRemove(scanMessengers, sessionName);
    }

    // Global safety: cap concurrent senders. Connect-only flows are allowed through.
    if (!connectOnly && runningSenderCount() >= MAX_CONCURRENT_SENDERS) {
      // Queue it instead of failing, so users can start multiple accounts quickly.
      startQueue.push({ config, createdAt: Date.now() });
      if (!fromQueue) {
        sendToRenderer('log-update', {
          sessionName,
          type: 'info',
          message: `Queued start (limit ${MAX_CONCURRENT_SENDERS} concurrent senders). It will start automatically when a slot is free.`
        });
      }
      return { success: true, queued: true };
    }

    const m = new TelegramMessenger(config);
    messengers.set(sessionName, m);
    wireMessengerEvents(sessionName, m, { scanMode: false });

    sendToRenderer('log-update', { sessionName, type: 'info', message: 'Forbinder til Telegram...' });

    try {
      await m.initialize();
    } catch (initError) {
      sendToRenderer('error-update', { sessionName, message: `Initialization failed: ${initError.message}` });
      await stopAndRemove(messengers, sessionName);
      return { success: false, error: initError.message };
    }

    if (!messengers.has(sessionName)) {
      return { success: false, error: 'Messenger initialization failed' };
    }

    if (connectOnly) {
      sendToRenderer('log-update', { sessionName, type: 'success', message: 'Account connected and session saved.' });
      await stopAndRemove(messengers, sessionName);
      return { success: true, connected: true };
    }

    sendToRenderer('log-update', { sessionName, type: 'info', message: 'Starter besked-sending...' });
    await m.start();

    return { success: true };
  } catch (error) {
    const sessionName = normSessionName(config?.sessionName);
    sendToRenderer('error-update', { sessionName, message: error.message });
    await stopAndRemove(messengers, sessionName);
    return { success: false, error: error.message };
  }
}

async function stopAndRemove(map, sessionName) {
  const m = map.get(sessionName);
  if (!m) return;
  try { await m.stop(); } catch { }
  map.delete(sessionName);
}

function getUnpackedPath(relativePath) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', relativePath)
    : path.join(__dirname, relativePath);
}

function getAppFlags() {
  return { edition: 'premium', demoMode: false, demoMinutes: 0, accountLimit: 100 };
}

function editionFromLicenseKey(key) {
  return 'premium';
}

function readLicenseKey() {
  return 'SALES-BUILD-NO-LICENSE';
}

function writeLicenseKey(key) {
  return true;
}

function getLicenseStatus() {
  return { edition: 'premium', valid: true, keyPresent: true, licensingDisabled: true };
}

function requireValidLicense() {
  return { ok: true };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: 'default',
    frame: true,
    show: false
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Handle window close
  let isQuitting = false;
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.webContents.send('confirm-app-close');
    }
  });

  ipcMain.on('app-closing-confirmed', (event, shouldSave) => {
    isQuitting = true;
    app.quit();
  });

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();

  // Auto-update is only meaningful for packaged apps (GitHub releases).
  if (app.isPackaged && process.env.TGM_ENABLE_AUTO_UPDATE === '1') {
    setupAutoUpdater({
      sendStatus: (st) => sendToRenderer('update-status', st),
      onDownloaded: () => {
        // Give the renderer a moment to show the "Updating..." overlay.
        sendToRenderer('update-status', { state: 'installing' });
        setTimeout(() => {
          try { quitAndInstall(); } catch { }
        }, 1500);
      },
    });

    // Nightly-only: always accept prereleases so users update from the latest GitHub prerelease.
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.allowPrerelease = true;
    } catch { }

    // Background check on startup (doesn't force install).
    setTimeout(() => {
      try { checkForUpdates(); } catch { }
    }, 2000);

    // Periodic checks (tags/releases only). Keeps users up-to-date without manual action.
    setInterval(() => {
      try { checkForUpdates(); } catch { }
    }, 6 * 60 * 60 * 1000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Note: Do not auto-start automation plugins. Users should explicitly enable features from the UI.
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Best-effort cleanup to avoid leaving Python subprocesses running.
app.on('before-quit', async () => {
  try {
    for (const k of [...messengers.keys()]) {
      const m = messengers.get(k);
      try { await m?.stop(); } catch { }
      messengers.delete(k);
    }
  } catch { }

  try {
    if (apiFetcher) apiFetcher.stop();
  } catch { }
  apiFetcher = null;

  try {
    if (botPlugin) botPlugin.stop();
  } catch { }
  botPlugin = null;

  try {
    if (keywordMonitor) keywordMonitor.stop();
  } catch { }
  keywordMonitor = null;

  try {
    for (const k of [...scanMessengers.keys()]) {
      const m = scanMessengers.get(k);
      try { await m?.stop(); } catch { }
      scanMessengers.delete(k);
    }
  } catch { }
});

// IPC Handlers
ipcMain.handle('get-app-flags', async () => {
  return getAppFlags();
});

ipcMain.handle('check-for-updates', async () => {
  return checkForUpdates();
});

ipcMain.handle('download-update', async () => {
  return downloadUpdate();
});

ipcMain.handle('quit-and-install-update', async () => {
  return quitAndInstall();
});

ipcMain.handle('get-license-status', async () => {
  return getLicenseStatus();
});

ipcMain.handle('set-license-key', async (event, key) => {
  writeLicenseKey(key);
  return getLicenseStatus();
});

ipcMain.handle('demo-expired', async () => {
  try {
    for (const k of [...messengers.keys()]) {
      const m = messengers.get(k);
      try { await m?.stop(); } catch { }
      messengers.delete(k);
    }
  } catch { }

  try {
    if (apiFetcher) apiFetcher.stop();
  } catch { }
  apiFetcher = null;

  try {
    if (botPlugin) botPlugin.stop();
  } catch { }
  botPlugin = null;

  try {
    if (keywordMonitor) keywordMonitor.stop();
  } catch { }
  keywordMonitor = null;

  try {
    for (const k of [...scanMessengers.keys()]) {
      const m = scanMessengers.get(k);
      try { await m?.stop(); } catch { }
      scanMessengers.delete(k);
    }
  } catch { }

  // Let IPC response flush before quitting.
  setTimeout(() => app.quit(), 150);
  return { success: true };
});

ipcMain.handle('start-keyword-monitor', async (event, config) => {
  const lic = requireValidLicense();
  if (!lic.ok) return { success: false, error: lic.error };

  const flags = getAppFlags();
  if ((flags.edition || 'standard') !== 'premium') {
    return { success: false, error: 'Keyword monitor is only available in Premium.' };
  }

  try {
    if (keywordMonitor) {
      try { keywordMonitor.stop(); } catch { }
      keywordMonitor = null;
    }

    keywordMonitor = new KeywordMonitor();

    keywordMonitor.on('log', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('keyword-monitor-log', data);
    });
    keywordMonitor.on('lead', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('keyword-monitor-lead', data);
    });
    keywordMonitor.on('csv_flushed', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('keyword-monitor-csv', data);
    });
    keywordMonitor.on('status', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('keyword-monitor-status', data);
    });
    keywordMonitor.on('error', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('keyword-monitor-error', data);
    });
    keywordMonitor.on('stopped', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('keyword-monitor-stopped', data);
    });

    await keywordMonitor.start(config);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('stop-keyword-monitor', async () => {
  try {
    if (keywordMonitor) keywordMonitor.stop();
  } catch { }
  keywordMonitor = null;
  return { success: true };
});

ipcMain.handle('scan-groups', async (event, config) => {
  try {
    const lic = requireValidLicense();
    if (!lic.ok) return { success: false, error: lic.error };

    const sessionName = normSessionName(config?.sessionName);

    if (messengers.get(sessionName)?.isRunning()) {
      return { success: false, error: 'Cannot scan while messaging is running for this account' };
    }
    if (scanMessengers.has(sessionName)) {
      return { success: false, error: 'Scan already running for this account' };
    }

    sendToRenderer('scan-status', { sessionName, message: 'Initialiserer forbindelse...' });

    const scanConfig = { ...config, scanGroups: true };
    const scanMessenger = new TelegramMessenger(scanConfig);
    scanMessengers.set(sessionName, scanMessenger);

    wireMessengerEvents(sessionName, scanMessenger, { scanMode: true });

    scanMessenger.on('log', (log) => {
      // Update scan status based on log messages
      if (log.message && log.message.includes('Scanning')) {
        sendToRenderer('scan-status', { sessionName, message: 'Scanner grupper...' });
      }
      if (log.message && log.message.includes('Connected')) {
        sendToRenderer('scan-status', { sessionName, message: 'Forbundet! Scanner grupper...' });
      }
    });

    // Auto-cleanup scan process after results/error to avoid leaks.
    scanMessenger.once('groupsScanned', async () => stopAndRemove(scanMessengers, sessionName));
    scanMessenger.once('error', async () => stopAndRemove(scanMessengers, sessionName));

    sendToRenderer('scan-status', { sessionName, message: 'Forbinder til Telegram...' });
    await scanMessenger.initialize();

    return { success: true };
  } catch (error) {
    const sessionName = normSessionName(config?.sessionName);
    sendToRenderer('scan-error', { sessionName, message: error.message });
    await stopAndRemove(scanMessengers, sessionName);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('start-messaging', async (event, config) => {
  return startMessagingInternal(config, { fromQueue: false });
});

ipcMain.handle('stop-messaging', async (event, sessionName) => {
  try {
    // Backward compatible: if no sessionName is provided, stop everything.
    const s = sessionName ? normSessionName(sessionName) : '';
    if (!s) {
      for (const k of [...messengers.keys()]) {
        await stopAndRemove(messengers, k);
      }
      for (const k of [...scanMessengers.keys()]) {
        await stopAndRemove(scanMessengers, k);
      }
      return { success: true, stoppedAll: true };
    }

    if (!messengers.has(s) && !scanMessengers.has(s)) {
      return { success: false, error: 'No active session for this account' };
    }

    await stopAndRemove(messengers, s);
    await stopAndRemove(scanMessengers, s);
    await maybeDrainStartQueue();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-status', async (event, sessionName) => {
  const s = sessionName ? normSessionName(sessionName) : '';
  if (s) {
    const m = messengers.get(s);
    if (m) return { sessionName: s, running: m.isRunning(), stats: m.getStats() };
    return { sessionName: s, running: false, stats: null };
  }

  const out = [];
  for (const [k, m] of messengers.entries()) out.push({ sessionName: k, running: m.isRunning(), stats: m.getStats() });
  return { sessions: out };
});

ipcMain.handle('send-code', async (event, sessionName, code) => {
  const s = normSessionName(sessionName);
  const m = messengers.get(s) || scanMessengers.get(s);
  if (!m) return { success: false, error: 'No active session for this account' };
  m.sendCode(code);
  return { success: true };
});

ipcMain.handle('send-password', async (event, sessionName, password) => {
  const s = normSessionName(sessionName);
  const m = messengers.get(s) || scanMessengers.get(s);
  if (!m) return { success: false, error: 'No active session for this account' };
  m.sendPassword(password);
  return { success: true };
});

ipcMain.handle('clear-telegram-session', async (event, sessionName) => {
  try {
    const s = normSessionName(sessionName);
    if (messengers.get(s)?.isRunning()) return { success: false, error: 'Account is running' };

    const dir = getAccountDataDir(s);
    if (!fs.existsSync(dir)) return { success: true };

    // Telethon stores sessions as sqlite files: <name>.session and related files.
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.startsWith('telegram_session')) {
        try { fs.rmSync(path.join(dir, f), { force: true }); } catch { }
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('open-logs-folder', async () => {
  try {
    const dir = getLogsDir();
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return { success: true, dir };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('export-accounts', async (event, accounts) => {
  try {
    const res = await dialog.showSaveDialog({
      title: 'Export Accounts',
      defaultPath: path.join(app.getPath('documents'), 'tgm_accounts.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { success: false, error: 'Canceled' };

    fs.writeFileSync(res.filePath, JSON.stringify(accounts || [], null, 2), 'utf8');
    return { success: true, path: res.filePath };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('import-accounts', async () => {
  try {
    const res = await dialog.showOpenDialog({
      title: 'Import Accounts',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths?.length) return { success: false, error: 'Canceled' };

    const p = res.filePaths[0];
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { success: false, error: 'Invalid file format (expected array)' };

    // Normalize minimal shape
    const out = parsed
      .filter((a) => a && typeof a === 'object' && a.id)
      .map((a) => ({ ...a, id: String(a.id), label: String(a.label || a.phoneNumber || a.id) }));

    return { success: true, accounts: out, path: p };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
});

let apiFetcher = null;

ipcMain.handle('check-env', async () => {
  const python = resolvePython();
  if (!python) return { python: false, details: 'Python not found' };

  const r = spawnSync(python.command, [...python.argsPrefix, '--version'], { windowsHide: true });
  const version = (r.stdout?.toString() || r.stderr?.toString() || '').trim();
  return { python: true, version, command: python.command };
});

ipcMain.handle('install-reqs', async (event, command) => {
  const python = resolvePython();
  if (!python) throw new Error('Python not found');

  const reqPath = getUnpackedPath('requirements.txt');
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const venvDir = path.join(localAppData, 'TelegramGroupMessenger', 'venv');
  const venvPython = path.join(venvDir, 'Scripts', 'python.exe');

  // Create a per-user venv to avoid admin permissions and to keep dependencies stable.
  if (!fs.existsSync(venvPython)) {
    const mk = spawnSync(python.command, [...python.argsPrefix, '-m', 'venv', venvDir], { windowsHide: true });
    if (mk.status !== 0) {
      throw new Error((mk.stderr?.toString() || mk.stdout?.toString() || 'Failed to create venv').trim());
    }
  }

  const run = (args) => {
    const r = spawnSync(venvPython, args, { windowsHide: true });
    if (r.status !== 0) {
      throw new Error((r.stderr?.toString() || r.stdout?.toString() || 'Command failed').trim());
    }
    return (r.stdout?.toString() || '').trim();
  };

  run(['-m', 'pip', 'install', '--upgrade', 'pip']);
  run(['-m', 'pip', 'install', '-r', reqPath]);

  // Best-effort: persist for the backend wrappers (installer also sets this).
  if (process.platform === 'win32') {
    try {
      exec(`reg add "HKCU\\Software\\TelegramGroupMessenger" /v VenvPython /t REG_SZ /d "${venvPython}" /f`);
    } catch { }
  }

  return 'OK';
});

ipcMain.handle('start-api-fetcher', async () => {
  if (apiFetcher) {
    try { apiFetcher.stop(); } catch (e) { }
  }

  apiFetcher = new ApiFetcher();

  apiFetcher.on('log', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('fetcher-log', data);
  });

  apiFetcher.on('input_request', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('fetcher-input-request', data);
  });

  apiFetcher.on('result', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('fetcher-result', data);
  });

  apiFetcher.on('error', (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('fetcher-error', { message: msg });
  });

  try {
    await apiFetcher.start();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('submit-fetcher-input', async (event, text) => {
  if (apiFetcher) {
    apiFetcher.sendInput(text);
    return { success: true };
  }
  return { success: false, error: 'Fetcher not running' };
});

ipcMain.handle('stop-api-fetcher', async () => {
  if (apiFetcher) {
    apiFetcher.stop();
    apiFetcher = null;
  }
  return { success: true };
});

// Bot Plugin IPC Handlers (legacy/unused)
ipcMain.handle('start-bot-plugin', async (event, config) => {
  try {
    if (botPlugin) {
      try { botPlugin.stop(); } catch (e) { }
    }

    botPlugin = new BotPluginWrapper();

    botPlugin.on('log', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bot-plugin-log', data);
    });

    botPlugin.on('error', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bot-plugin-error', data);
    });

    botPlugin.on('needsCode', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bot-plugin-needs-code');
    });

    botPlugin.on('needsPassword', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bot-plugin-needs-password');
    });

    botPlugin.on('stopped', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bot-plugin-stopped', data);
    });

    await botPlugin.start(config);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('stop-bot-plugin', async () => {
  if (botPlugin) {
    botPlugin.stop();
    botPlugin = null;
  }
  return { success: true };
});

ipcMain.handle('add-new-bot', async (event, botNumber) => {
  if (botPlugin) {
    try {
      botPlugin.addBot(botNumber);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'Bot plugin not running' };
});

ipcMain.handle('send-bot-plugin-code', async (event, code) => {
  if (botPlugin) {
    try {
      botPlugin.sendCode(code);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'Bot plugin not running' };
});

ipcMain.handle('send-bot-plugin-password', async (event, password) => {
  if (botPlugin) {
    try {
      botPlugin.sendPassword(password);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'Bot plugin not running' };
});
