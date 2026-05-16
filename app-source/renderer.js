const { ipcRenderer } = require('electron');

const QRCode = require('qrcode');

// Setup Logic
let pythonCommand = 'python';
let appFlags = { demoMode: false, demoMinutes: 15 };

let demoExpiresAtMs = null;
let demoInterval = null;
let demoTimeout = null;

function formatRemaining(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
}

function updateDemoBanner() {
    const el = document.getElementById('demoBanner');
    if (!el || !demoExpiresAtMs) return;
    const remaining = demoExpiresAtMs - Date.now();
    if (remaining <= 0) {
        el.textContent = 'Demo expired';
        return;
    }
    el.textContent = `DEMO MODE: ${formatRemaining(remaining)} remaining`;
}

function startDemoTimer() {
    if (!appFlags.demoMode) return;

    const minutes = Number(appFlags.demoMinutes) || 15;
    demoExpiresAtMs = Date.now() + minutes * 60 * 1000;

    const el = document.getElementById('demoBanner');
    if (el) {
        el.style.display = 'block';
        updateDemoBanner();
    }

    if (demoInterval) clearInterval(demoInterval);
    demoInterval = setInterval(updateDemoBanner, 1000);

    if (demoTimeout) clearTimeout(demoTimeout);
    demoTimeout = setTimeout(async () => {
        try {
            updateDemoBanner();
            alert(`Demo time expired (${minutes} minutes). The app will now close.`);
        } finally {
            try { await ipcRenderer.invoke('demo-expired'); } catch (e) { }
        }
    }, minutes * 60 * 1000);
}

// Multi-account (Telegram) storage
const ACCOUNTS_KEY = 'tgmAccounts';
const ACTIVE_ACCOUNT_KEY = 'tgmActiveAccountId';
const MESSENGER_DATA_KEY_PREFIX = 'telegramMessengerData:';
const SCANNED_GROUPS_KEY_PREFIX = 'tgmScannedGroups:';
const SELECTED_GROUP_IDS_KEY_PREFIX = 'tgmSelectedGroupIds:';

function loadAccounts() {
    try {
        const raw = localStorage.getItem(ACCOUNTS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveAccounts(accounts) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts || []));
}

function newAccountId() {
    return 'acc_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
}

function getActiveAccountId() {
    return localStorage.getItem(ACTIVE_ACCOUNT_KEY) || '';
}

function setActiveAccountId(id) {
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, id || '');
}

function messengerDataKey() {
    // Per-account persistence to avoid cross-contaminating links/message between accounts.
    return `${MESSENGER_DATA_KEY_PREFIX}${getActiveAccountId() || 'default'}`;
}

let isScanning = false;
let scanningSessionName = '';
let pendingAuthSessionName = '';

// Per-account run state: allows multiple concurrent senders.
const runningAccounts = new Set();
const accountStats = new Map(); // sessionName -> stats

function scannedGroupsKey(id) {
    return `${SCANNED_GROUPS_KEY_PREFIX}${id || 'default'}`;
}

function selectedGroupIdsKey(id) {
    return `${SELECTED_GROUP_IDS_KEY_PREFIX}${id || 'default'}`;
}

function updateAccountsUiState() {
    const limit = Number(appFlags.accountLimit) || 10;
    const accountsCount = loadAccounts().length;
    const activeId = getActiveAccountId();
    const activeRunning = !!activeId && runningAccounts.has(activeId);
    const activeScanning = isScanning && (scanningSessionName === activeId);

    // Switching accounts while scanning leads to confusing UI state; disallow.
    if (accountSelect) accountSelect.disabled = activeScanning;

    // Allow managing other accounts while some accounts are running in background.
    if (newAccountBtn) newAccountBtn.disabled = activeScanning || (accountsCount >= limit);

    // Avoid editing/deleting the currently active account while it's running.
    if (saveAccountBtn) saveAccountBtn.disabled = activeScanning || activeRunning;
    if (deleteAccountBtn) deleteAccountBtn.disabled = activeScanning || activeRunning || (limit <= 1);
}

function getAccountLabelById(id) {
    const acc = getAccountById(loadAccounts(), id);
    return acc?.label || acc?.phoneNumber || id || 'default';
}

function refreshRunControls() {
    const activeId = getActiveAccountId();
    const activeRunning = !!activeId && runningAccounts.has(activeId);
    const activeScanning = isScanning && (scanningSessionName === activeId);

    if (startBtn) {
        startBtn.disabled = activeRunning || activeScanning;
        startBtn.innerHTML = activeRunning
            ? '<span class="btn-icon"></span> Running (this account)'
            : '<span class="btn-icon"></span> Start Sending';
    }

    if (stopBtn) stopBtn.disabled = !activeRunning;

    if (statusIndicator) {
        if (activeRunning) statusIndicator.classList.add('active');
        else statusIndicator.classList.remove('active');
        statusIndicator.textContent = '';
    }
}

async function stopAllMessaging() {
    try {
        const res = await ipcRenderer.invoke('stop-messaging');
        if (!res?.success) addLog('warning', `Stop all failed: ${res?.error || 'unknown'}`);
    } catch (e) {
        addLog('warning', `Stop all failed: ${e?.message || String(e)}`);
    } finally {
        runningAccounts.clear();
        accountStats.clear();
        updateAccountsUiState();
        refreshRunControls();
        renderRunningAccountsList();
    }
}

function renderRunningAccountsList() {
    const box = document.getElementById('runningAccountsList');
    if (!box) return;

    const ids = Array.from(runningAccounts.values());
    if (!ids.length) {
        box.textContent = 'No accounts running.';
        return;
    }

    const rows = ids.map((id) => {
        const st = accountStats.get(id) || {};
        const sent = st.sent ?? 0;
        const failed = st.failed ?? 0;
        const total = st.total ?? 0;
        return `${getAccountLabelById(id)} | sent ${sent} / failed ${failed} / total ${total}`;
    });

    box.textContent = rows.join(' | ');
}

function resetImageSelection() {
    selectedImagePath = null;
    try {
        const imageName = document.getElementById('imageName');
        const preview = document.getElementById('previewImg');
        const previewBox = document.getElementById('imagePreview');
        const clearBtn = document.getElementById('clearImageBtn');
        if (imageName) imageName.textContent = '';
        if (preview) preview.src = '';
        if (previewBox) previewBox.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
    } catch (e) { }
}

window.addEventListener('DOMContentLoaded', async () => {
    try {
        const flags = await ipcRenderer.invoke('get-app-flags');
        if (flags && typeof flags === 'object') appFlags = { ...appFlags, ...flags };
    } catch (e) {
        // Ignore; default flags used in dev.
    }

    // Now that we know edition limits, initialize account + UI state.
    initAccounts();
    loadSavedData();
    loadGroupState(getActiveAccountId());
    updateLinkCount();
    setupEventListeners();
    updateAccountsUiState();
    refreshRunControls();
    renderRunningAccountsList();

    const demoBanner = document.getElementById('demoBanner');
    if (demoBanner && !appFlags.demoMode) {
        demoBanner.style.display = 'none';
    }

    // Check if first run
    const isSetupDone = localStorage.getItem('setupComplete');
    if (!isSetupDone) {
        showSetupModal();
    }

    // Load theme
    const theme = localStorage.getItem('theme') || 'dark';
    if (theme === 'light') {
        document.body.classList.add('light-mode');
        document.querySelector('input[name="theme"][value="light"]').checked = true;
    }


    await refreshLicenseStatus();
});

async function refreshLicenseStatus() {
    const statusText = document.getElementById('licenseStatusText');
    if (!statusText) return;
    try {
        const st = await ipcRenderer.invoke('get-license-status');
        if (st?.valid) {
            statusText.textContent = "Licensed";
            statusText.style.color = "var(--success)";
        } else {
            statusText.textContent = "Not Activated";
            statusText.style.color = "var(--error)";
        }
    } catch (e) {
        statusText.textContent = "Unknown";
        statusText.style.color = "var(--text-secondary)";
    }
}

function showSetupModal() {
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    checkEnvironment();
}

async function checkEnvironment() {
    const statusText = document.getElementById('env-status-text');
    const nextBtn = document.getElementById('btn-next-step');
    const installBtn = document.getElementById('btn-install-deps');
    const icon = document.getElementById('env-icon');

    statusText.textContent = "Checking Python installation...";

    const env = await ipcRenderer.invoke('check-env');

    if (!env.python) {
        statusText.textContent = "Python not found! It should have been installed automatically. Please try restarting your computer or install Python manually.";
        statusText.style.color = "#ff4444";
        icon.textContent = "";
        icon.style.animation = "none";
        return;
    }

    pythonCommand = env.command;
    statusText.textContent = `Python found (${env.version}). Checking requirements...`;

    // Install reqs
    installDependencies();
}

async function installDependencies() {
    const statusText = document.getElementById('env-status-text');
    const nextBtn = document.getElementById('btn-next-step');
    const icon = document.getElementById('env-icon');

    statusText.textContent = "Installing required libraries (this may take a moment)...";

    try {
        const result = await ipcRenderer.invoke('install-reqs', pythonCommand);
        statusText.textContent = "Everything is ready! Python environment is set up.";
        statusText.style.color = "var(--text-primary)";
        icon.textContent = "";
        icon.style.animation = "none";
        nextBtn.classList.remove('hidden');

        // Auto advance after 1.5s
        setTimeout(() => {
            document.getElementById('step-env').classList.add('hidden');
            document.getElementById('step-api').classList.remove('hidden');
        }, 1500);

    } catch (err) {
        statusText.textContent = "Error installing libraries: " + err;
        statusText.style.color = "#ff4444";
        icon.textContent = "";
        icon.style.animation = "none";
        const installBtn = document.getElementById('btn-install-deps');
        installBtn.classList.remove('hidden');
        installBtn.onclick = installDependencies;
    }
}

// API Fetcher UI Logic
document.getElementById('btn-start-fetcher').addEventListener('click', async () => {
    const phone = document.getElementById('fetcher-phone').value;
    if (!phone) return alert('Please enter phone number');

    const logs = document.getElementById('fetcher-logs');
    logs.innerHTML = '';
    addFetcherLog('Starting API Finder service...', 'info');

    const res = await ipcRenderer.invoke('start-api-fetcher');
    if (!res.success) {
        addFetcherLog('Error starting: ' + res.error, 'error');
        return;
    }
});

document.getElementById('btn-submit-fetcher').addEventListener('click', () => {
    const input = document.getElementById('fetcher-input-code');
    const val = input.value;
    if (val) {
        ipcRenderer.invoke('submit-fetcher-input', val);
        input.value = '';
        document.getElementById('fetcher-input-area').classList.add('hidden');
    }
});

document.getElementById('btn-skip-setup').addEventListener('click', () => {
    document.getElementById('setup-modal').style.display = 'none';
    localStorage.setItem('setupComplete', 'true');
});

document.getElementById('btn-next-step').addEventListener('click', () => {
    document.getElementById('step-env').classList.add('hidden');
    document.getElementById('step-api').classList.remove('hidden');
});

function openApiFinder() {
    const setupModal = document.getElementById('setup-modal');
    const envStep = document.getElementById('step-env');
    const apiStep = document.getElementById('step-api');
    const fetcherPhone = document.getElementById('fetcher-phone');

    if (fetcherPhone && phoneNumberInput?.value?.trim()) {
        fetcherPhone.value = phoneNumberInput.value.trim();
    }

    if (envStep) envStep.classList.add('hidden');
    if (apiStep) apiStep.classList.remove('hidden');
    if (setupModal) setupModal.style.display = 'flex';
}

function addFetcherLog(msg, type = 'info') {
    const logs = document.getElementById('fetcher-logs');
    const p = document.createElement('div');
    p.className = `log-line ${type}`;
    p.textContent = `> ${msg}`;
    logs.appendChild(p);
    logs.scrollTop = logs.scrollHeight;
}

// IPC Listeners for Fetcher
ipcRenderer.on('fetcher-log', (event, data) => {
    addFetcherLog(data.message, data.type);
});

ipcRenderer.on('fetcher-error', (event, data) => {
    addFetcherLog(data.message, 'error');
});

ipcRenderer.on('fetcher-input-request', (event, data) => {
    const inputArea = document.getElementById('fetcher-input-area');
    const label = document.getElementById('fetcher-input-label');
    const phoneInput = document.getElementById('fetcher-phone').value;

    if (data.prompt === 'phone') {
        if (phoneInput) {
            addFetcherLog('Sending phone number...', 'info');
            ipcRenderer.invoke('submit-fetcher-input', phoneInput);
        } else {
            label.textContent = "Enter Phone Number";
            inputArea.classList.remove('hidden');
        }
    } else if (data.prompt === 'code') {
        label.textContent = "Enter verification code (check your Telegram app)";
        inputArea.classList.remove('hidden');
    } else if (data.prompt === 'password') {
        label.textContent = "Enter 2FA Password";
        inputArea.classList.remove('hidden');
    }
});

ipcRenderer.on('fetcher-result', (event, data) => {
    document.getElementById('setup-modal').style.display = 'none';
    localStorage.setItem('setupComplete', 'true');

    document.getElementById('apiId').value = data.api_id;
    document.getElementById('apiHash').value = data.api_hash;

    alert(`Success! Your keys have been found and inserted:\nAPI ID: ${data.api_id}`);

    ipcRenderer.invoke('stop-api-fetcher');
});

// End Setup Logic


// DOM Elements
const apiIdInput = document.getElementById('apiId');
const apiHashInput = document.getElementById('apiHash');
const phoneNumberInput = document.getElementById('phoneNumber');
const passwordInput = document.getElementById('password');
const messageInput = document.getElementById('message');
const groupLinksInput = document.getElementById('groupLinks');
const timesPerDayInput = document.getElementById('timesPerDay');
const intervalHoursInput = document.getElementById('intervalHours');
const scheduleTypeRadios = document.querySelectorAll('input[name="scheduleType"]');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearLogBtn = document.getElementById('clearLogBtn');
const scanGroupsBtn = document.getElementById('scanGroupsBtn');
const scanIcon = document.getElementById('scanIcon');
const scanBtnText = document.getElementById('scanBtnText');
const scanSpinner = document.getElementById('scanSpinner');
const scanningIndicator = document.getElementById('scanningIndicator');
const scanningText = document.getElementById('scanningText');
const linkCountSpan = document.getElementById('linkCount');
const selectedCountSpan = document.getElementById('selectedCount');
const logOutput = document.getElementById('logOutput');
const sentCount = document.getElementById('sentCount');
const failedCount = document.getElementById('failedCount');
const totalCount = document.getElementById('totalCount');
const statusIndicator = document.getElementById('statusIndicator');
const scannedGroupsContainer = document.getElementById('scannedGroupsContainer');
const scannedGroupsList = document.getElementById('scannedGroupsList');
const manualLinksContainer = document.getElementById('manualLinksContainer');

// Accounts UI
const accountSelect = document.getElementById('accountSelect');
const newAccountBtn = document.getElementById('newAccountBtn');
const saveAccountBtn = document.getElementById('saveAccountBtn');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');

let scannedGroups = [];
let selectedGroupIds = new Set();
let selectedImagePath = null;

function resetGroupsUIForAccountSwitch() {
    scannedGroups = [];
    selectedGroupIds = new Set();
    if (scannedGroupsList) scannedGroupsList.innerHTML = '';
    if (scannedGroupsContainer) scannedGroupsContainer.style.display = 'none';
    if (manualLinksContainer) manualLinksContainer.style.display = 'block';

    // Clear selected image (image is per-run, not per-account).
    selectedImagePath = null;
    try {
        const imageName = document.getElementById('imageName');
        const preview = document.getElementById('previewImg');
        const previewBox = document.getElementById('imagePreview');
        const clearBtn = document.getElementById('clearImageBtn');
        if (imageName) imageName.textContent = '';
        if (preview) preview.src = '';
        if (previewBox) previewBox.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
    } catch (e) { }

    updateSelectedCount();
}

function saveGroupState(accountId) {
    const id = accountId || getActiveAccountId() || 'default';
    try { localStorage.setItem(scannedGroupsKey(id), JSON.stringify(scannedGroups || [])); } catch (e) { }
    try { localStorage.setItem(selectedGroupIdsKey(id), JSON.stringify(Array.from(selectedGroupIds || []))); } catch (e) { }
}

function loadGroupState(accountId) {
    const id = accountId || getActiveAccountId() || 'default';
    let groups = [];
    let ids = [];
    try {
        const raw = localStorage.getItem(scannedGroupsKey(id));
        groups = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(groups)) groups = [];
    } catch (e) {
        groups = [];
    }
    try {
        const raw2 = localStorage.getItem(selectedGroupIdsKey(id));
        ids = raw2 ? JSON.parse(raw2) : [];
        if (!Array.isArray(ids)) ids = [];
    } catch (e) {
        ids = [];
    }

    scannedGroups = groups;
    selectedGroupIds = new Set(ids.map((x) => Number(x)).filter((x) => Number.isFinite(x)));

    if (scannedGroups.length > 0) {
        displayScannedGroups(scannedGroups);
    } else {
        // Manual links mode for this account.
        if (scannedGroupsList) scannedGroupsList.innerHTML = '';
        if (scannedGroupsContainer) scannedGroupsContainer.style.display = 'none';
        if (manualLinksContainer) manualLinksContainer.style.display = 'block';
        updateSelectedCount();
    }
}

function getAccountById(accounts, id) {
    return (accounts || []).find(a => a && a.id === id) || null;
}

function refreshAccountSelect(accounts, activeId) {
    if (!accountSelect) return;
    accountSelect.innerHTML = '';

    (accounts || []).forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.id;
        opt.textContent = acc.label || acc.phoneNumber || acc.id;
        if (acc.id === activeId) opt.selected = true;
        accountSelect.appendChild(opt);
    });
}

function applyAccountToInputs(acc) {
    if (!acc) return;
    apiIdInput.value = acc.apiId || '';
    apiHashInput.value = acc.apiHash || '';
    phoneNumberInput.value = acc.phoneNumber || '';
    const authMethodEl = document.getElementById('authMethod');
    if (authMethodEl) authMethodEl.value = acc.authMethod || 'qr';
    passwordInput.value = acc.password || '';

    const ph = document.getElementById('accProxyHost');
    const pp = document.getElementById('accProxyPort');
    const pu = document.getElementById('accProxyUser');
    const pw = document.getElementById('accProxyPass');
    if (ph) ph.value = acc.proxyHost || '';
    if (pp) pp.value = acc.proxyPort || '';
    if (pu) pu.value = acc.proxyUser || '';
    if (pw) pw.value = acc.proxyPass || '';


    const bgMin = document.getElementById('betweenGroupsMin');
    const bgMax = document.getElementById('betweenGroupsMax');
    const preMin = document.getElementById('preSendMin');
    const preMax = document.getElementById('preSendMax');
    const postMin = document.getElementById('postSendMin');
    const postMax = document.getElementById('postSendMax');
    if (bgMin) bgMin.value = String(acc.betweenGroupsMin ?? 5);
    if (bgMax) bgMax.value = String(acc.betweenGroupsMax ?? 10);
    if (preMin) preMin.value = String(acc.preSendMin ?? 2);
    if (preMax) preMax.value = String(acc.preSendMax ?? 5);
    if (postMin) postMin.value = String(acc.postSendMin ?? 3);
    if (postMax) postMax.value = String(acc.postSendMax ?? 7);

    // Load per-account keywords into the monitor UI (if present).
    try { loadKeywordsToUI(); } catch (e) { }
}

function readInputsToAccount(acc) {
    const authMethodEl = document.getElementById('authMethod');
    const ph = document.getElementById('accProxyHost');
    const pp = document.getElementById('accProxyPort');
    const pu = document.getElementById('accProxyUser');
    const pw = document.getElementById('accProxyPass');


    const bgMin = document.getElementById('betweenGroupsMin');
    const bgMax = document.getElementById('betweenGroupsMax');
    const preMin = document.getElementById('preSendMin');
    const preMax = document.getElementById('preSendMax');
    const postMin = document.getElementById('postSendMin');
    const postMax = document.getElementById('postSendMax');
    return {
        ...acc,
        apiId: apiIdInput.value.trim(),
        apiHash: apiHashInput.value.trim(),
        phoneNumber: phoneNumberInput.value.trim(),
        authMethod: (authMethodEl?.value || 'qr'),
        password: passwordInput.value
        ,
        proxyHost: (ph?.value || '').trim(),
        proxyPort: (pp?.value || '').trim(),
        proxyUser: (pu?.value || '').trim(),
        proxyPass: (pw?.value || '').trim(),
        betweenGroupsMin: Number(bgMin?.value || 5),
        betweenGroupsMax: Number(bgMax?.value || 10),
        preSendMin: Number(preMin?.value || 2),
        preSendMax: Number(preMax?.value || 5),
        postSendMin: Number(postMin?.value || 3),
        postSendMax: Number(postMax?.value || 7),
    };
}

function getProxyConfigFromInputs() {
    const host = (document.getElementById('accProxyHost')?.value || '').trim();
    const portRaw = (document.getElementById('accProxyPort')?.value || '').trim();
    const user = (document.getElementById('accProxyUser')?.value || '').trim();
    const pass = (document.getElementById('accProxyPass')?.value || '').trim();

    if (!host || !portRaw) return null;
    const port = Number(portRaw);
    if (!Number.isFinite(port) || port <= 0) return null;

    return { type: 'socks5', host, port: Math.trunc(port), username: user, password: pass };
}

function getRateLimitConfigFromInputs() {
    const num = (id, fallback) => {
        const v = Number(document.getElementById(id)?.value);
        return Number.isFinite(v) ? v : fallback;
    };

    return {
        betweenGroupsDelayMin: num('betweenGroupsMin', 5),
        betweenGroupsDelayMax: num('betweenGroupsMax', 10),
        preSendDelayMin: num('preSendMin', 2),
        preSendDelayMax: num('preSendMax', 5),
        postSendDelayMin: num('postSendMin', 3),
        postSendDelayMax: num('postSendMax', 7),
    };
}

function initAccounts() {
    let accounts = loadAccounts();
    let activeId = getActiveAccountId();

    // Enforce edition limits (demo=1, standard=10, premium=100) via appFlags.accountLimit.
    const limit = Number(appFlags.accountLimit) || 10;
    if (accounts.length > limit) {
        accounts = accounts.slice(0, limit);
        saveAccounts(accounts);
        if (!getAccountById(accounts, activeId)) {
            activeId = accounts[0]?.id || '';
            setActiveAccountId(activeId);
        }
    }

    if (!accounts.length) {
        const id = newAccountId();
        accounts = [{
            id,
            label: 'Account 1',
            apiId: '',
            apiHash: '',
            phoneNumber: '',
            authMethod: 'qr',
            password: ''
        }];
        activeId = id;
        saveAccounts(accounts);
        setActiveAccountId(activeId);
    }

    if (!activeId || !getAccountById(accounts, activeId)) {
        activeId = accounts[0].id;
        setActiveAccountId(activeId);
    }

    refreshAccountSelect(accounts, activeId);
    const active = getAccountById(accounts, activeId);
    applyAccountToInputs(active);
}

// Initialize is done after app flags + license status are loaded (DOMContentLoaded).

// Event Listeners
function setupEventListeners() {
    // Accounts
    if (accountSelect) {
        accountSelect.addEventListener('change', (e) => {
            const nextId = e.target.value;
            const prevId = getActiveAccountId();

            if (isScanning) {
                alert('Wait for scanning to finish before switching account.');
                accountSelect.value = prevId;
                return;
            }

            // Persist current account's message/link settings before switching.
            saveDataQuiet();
            saveGroupState(prevId);

            setActiveAccountId(nextId);
            const accounts = loadAccounts();
            const acc = getAccountById(accounts, nextId);
            applyAccountToInputs(acc);
            resetImageSelection();
            loadSavedData(); // per-account data
            loadGroupState(nextId);
            addLog('info', `Switched account: ${acc?.label || acc?.phoneNumber || nextId}`);
            if (prevId && runningAccounts.has(prevId) && prevId !== nextId) {
                addLog('info', `Note: previous account is still running in background (${prevId}).`);
            }
            updateAccountsUiState();
            refreshRunControls();
        });
    }

    if (newAccountBtn) {
        newAccountBtn.addEventListener('click', () => {
            if (isScanning) return alert('Wait for scanning to finish before creating a new account.');

            const limit = Number(appFlags.accountLimit) || 10;
            const existing = loadAccounts();
            if (existing.length >= limit) {
                alert(`Account limit reached for this edition (${existing.length}/${limit}).`);
                return;
            }

            const label = prompt('Account name:', `Account ${loadAccounts().length + 1}`);
            if (!label) return;

            const id = newAccountId();
            const accounts = loadAccounts();
            const active = getAccountById(accounts, getActiveAccountId());
            // Convenience: copy API keys from current account if present.
            accounts.push({
                id,
                label,
                apiId: active?.apiId || '',
                apiHash: active?.apiHash || '',
                phoneNumber: '',
                authMethod: 'qr',
                password: ''
            });
            saveAccounts(accounts);
            setActiveAccountId(id);
            refreshAccountSelect(accounts, id);
            applyAccountToInputs(getAccountById(accounts, id));
            resetGroupsUIForAccountSwitch();
            loadSavedData(); // defaults for new account
            addLog('success', `Account created: ${label}`);

            updateAccountsUiState();
            refreshRunControls();
        });
    }

    const duplicateBtn = document.getElementById('duplicateAccountBtn');
    if (duplicateBtn) {
        duplicateBtn.addEventListener('click', () => {
            if (isScanning) return alert('Wait for scanning to finish before duplicating an account.');
            const activeId = getActiveAccountId();
            if (!activeId) return;

            const accounts = loadAccounts();
            const acc = getAccountById(accounts, activeId);
            if (!acc) return;

            const label = prompt('New account name:', `${acc.label || 'Account'} Copy`);
            if (!label) return;

            const id = newAccountId();
            const clone = { ...acc, id, label, phoneNumber: '', password: '' };
            accounts.push(clone);
            saveAccounts(accounts);
            setActiveAccountId(id);
            refreshAccountSelect(accounts, id);
            applyAccountToInputs(getAccountById(accounts, id));
            resetGroupsUIForAccountSwitch();
            loadSavedData();
            addLog('success', `Account duplicated: ${label}`);
            updateAccountsUiState();
            refreshRunControls();
        });
    }

    if (saveAccountBtn) {
        saveAccountBtn.addEventListener('click', () => {
            const activeId = getActiveAccountId();
            if (isScanning) return alert('Wait for scanning to finish before saving account.');
            if (activeId && runningAccounts.has(activeId)) return alert('Stop this account before saving changes.');
            let accounts = loadAccounts();
            let acc = getAccountById(accounts, activeId);

            if (!acc) {
                const id = newAccountId();
                acc = { id, label: 'Account', apiId: '', apiHash: '', phoneNumber: '', authMethod: 'qr', password: '' };
                accounts.push(acc);
                setActiveAccountId(id);
            }

            const updated = readInputsToAccount(acc);
            accounts = accounts.map(a => (a.id === updated.id ? updated : a));
            saveAccounts(accounts);
            refreshAccountSelect(accounts, updated.id);
            addLog('success', `Account saved: ${updated.label || updated.phoneNumber || updated.id}`);
            updateAccountsUiState();
            refreshRunControls();
        });
    }

    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', () => {
            const activeId = getActiveAccountId();
            if (isScanning) return alert('Wait for scanning to finish before deleting an account.');
            if (activeId && runningAccounts.has(activeId)) return alert('Stop this account before deleting it.');

            const limit = Number(appFlags.accountLimit) || 10;
            if (limit <= 1) {
                alert('This edition only supports 1 account.');
                return;
            }

            const accounts = loadAccounts();
            const acc = getAccountById(accounts, activeId);
            if (!acc) return;

            const ok = confirm(`Delete account "${acc.label || acc.phoneNumber || acc.id}"? This will only remove it from the app. Telegram session files stay on disk.`);
            if (!ok) return;

            const next = accounts.filter(a => a.id !== activeId);
            if (!next.length) {
                alert('At least one account must exist.');
                return;
            }

            saveAccounts(next);
            setActiveAccountId(next[0].id);
            refreshAccountSelect(next, next[0].id);
            applyAccountToInputs(getAccountById(next, next[0].id));
            resetGroupsUIForAccountSwitch();
            addLog('info', 'Account deleted.');

            loadSavedData(); // per-account data for new active account
            updateAccountsUiState();
            refreshRunControls();
        });
    }

    const clearSessionBtn = document.getElementById('clearSessionBtn');
    if (clearSessionBtn) {
        clearSessionBtn.addEventListener('click', async () => {
            const sessionName = getActiveAccountId() || 'default';
            if (runningAccounts.has(sessionName)) return alert('Stop this account before clearing its session.');

            const ok = confirm(`Clear Telegram session for \"${getAccountLabelById(sessionName)}\"? You will need to login again.`);
            if (!ok) return;

            try {
                const res = await ipcRenderer.invoke('clear-telegram-session', sessionName);
                if (!res?.success) return alert(res?.error || 'Failed to clear session');
                addLog('success', `Session cleared for ${getAccountLabelById(sessionName)}`);
            } catch (e) {
                alert(e?.message || String(e));
            }
        });
    }

    // Schedule type change
    scheduleTypeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'daily') {
                document.getElementById('dailyFrequencyGroup').style.display = 'block';
                document.getElementById('intervalGroup').style.display = 'none';
            } else {
                document.getElementById('dailyFrequencyGroup').style.display = 'none';
                document.getElementById('intervalGroup').style.display = 'block';
            }
        });
    });

    // Link count update
    groupLinksInput.addEventListener('input', updateLinkCount);

    // Start button
    startBtn.addEventListener('click', async () => {
        if (!validateInputs()) {
            return;
        }
        await startMessaging();
    });

    // Stop button
    stopBtn.addEventListener('click', async () => {
        await stopMessaging(getActiveAccountId() || 'default');
    });

    // Clear log
    clearLogBtn.addEventListener('click', () => {
        logOutput.innerHTML = '';
    });

    // Stop all (multi-account)
    const stopAllBtn = document.getElementById('stopAllBtn');
    if (stopAllBtn) stopAllBtn.addEventListener('click', stopAllMessaging);

    const exportBtn = document.getElementById('exportAccountsBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            try {
                const accounts = loadAccounts();
                // Do not export secrets by default.
                const sanitized = (accounts || []).map((a) => {
                    const { password, proxyPass, ...rest } = (a || {});
                    return rest;
                });
                const res = await ipcRenderer.invoke('export-accounts', sanitized);
                if (!res?.success) addLog('warning', `Export failed: ${res?.error || 'unknown'}`);
                else addLog('success', `Accounts exported${res?.path ? ': ' + res.path : ''}`);
            } catch (e) {
                addLog('warning', `Export failed: ${e?.message || String(e)}`);
            }
        });
    }

    const importBtn = document.getElementById('importAccountsBtn');
    if (importBtn) {
        importBtn.addEventListener('click', async () => {
            if (isScanning) return alert('Wait for scanning to finish before importing accounts.');
            try {
                const res = await ipcRenderer.invoke('import-accounts');
                if (!res?.success) return addLog('warning', `Import failed: ${res?.error || 'unknown'}`);
                const imported = Array.isArray(res?.accounts) ? res.accounts : [];
                if (!imported.length) return addLog('warning', 'No accounts imported.');

                // Merge by id; imported passwords are not present.
                const existing = loadAccounts();
                const map = new Map();
                for (const a of (existing || [])) if (a?.id) map.set(a.id, a);
                for (const a of imported) if (a?.id) map.set(a.id, { ...map.get(a.id), ...a });
                const merged = Array.from(map.values());

                saveAccounts(merged);
                const activeId = getActiveAccountId();
                const nextActive = getAccountById(merged, activeId) ? activeId : (merged[0]?.id || '');
                setActiveAccountId(nextActive);
                refreshAccountSelect(merged, nextActive);
                applyAccountToInputs(getAccountById(merged, nextActive));
                loadSavedData();
                loadGroupState(nextActive);
                addLog('success', `Accounts imported (${imported.length})`);
                updateAccountsUiState();
                refreshRunControls();
            } catch (e) {
                addLog('warning', `Import failed: ${e?.message || String(e)}`);
            }
        });
    }

    const openLogsBtn = document.getElementById('openLogsBtn');
    if (openLogsBtn) {
        openLogsBtn.addEventListener('click', async () => {
            try { await ipcRenderer.invoke('open-logs-folder'); } catch (e) { }
        });
    }

    const openApiFinderBtn = document.getElementById('openApiFinderBtn');
    if (openApiFinderBtn) {
        openApiFinderBtn.addEventListener('click', openApiFinder);
    }

    // Scan groups button
    scanGroupsBtn.addEventListener('click', async () => {
        if (!validateCredentials()) {
            return;
        }
        await scanGroups();
    });

    // Connect/Login button (no scanning, just create/authorize the Telegram session).
    const connectBtn = document.getElementById('connectAccountBtn');
    if (connectBtn) {
        connectBtn.addEventListener('click', async () => {
            if (!validateCredentials()) return;

            const sessionName = getActiveAccountId() || 'default';
            pendingAuthSessionName = sessionName;

            addLog('info', `Connecting ${getAccountLabelById(sessionName)}...`);
            const config = {
                apiId: apiIdInput.value.trim(),
                apiHash: apiHashInput.value.trim(),
                phoneNumber: phoneNumberInput.value.trim(),
                password: passwordInput.value,
                sessionName,
                authMethod: (document.getElementById('authMethod')?.value || 'qr'),
                proxy: getProxyConfigFromInputs(),
                ...getRateLimitConfigFromInputs(),
                connectOnly: true
            };

            try {
                const res = await ipcRenderer.invoke('start-messaging', config);
                if (!res?.success) addLog('error', `Connect failed: ${res?.error || 'Unknown error'}`);
            } catch (e) {
                addLog('error', `Connect failed: ${e?.message || String(e)}`);
            }
        });
    }

    // Data is no longer saved on input

    // Select all groups checkbox
    const selectAllCheckbox = document.getElementById('selectAllGroups');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const checkboxes = scannedGroupsList.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => {
                cb.checked = e.target.checked;
                const groupId = parseInt(cb.value);
                if (e.target.checked) {
                    selectedGroupIds.add(groupId);
                } else {
                    selectedGroupIds.delete(groupId);
                }
            });
            updateSelectedCount();
            saveGroupState();
        });
    }

    // Image upload
    const imageInput = document.getElementById('imageInput');
    const selectImageBtn = document.getElementById('selectImageBtn');
    const clearImageBtn = document.getElementById('clearImageBtn');

    selectImageBtn.addEventListener('click', () => {
        imageInput.click();
    });

    imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            // Use the file path directly, ensuring proper encoding
            selectedImagePath = file.path.replace(/\\/g, '/');
            document.getElementById('imageName').textContent = file.name;
            document.getElementById('previewImg').src = URL.createObjectURL(file);
            document.getElementById('imagePreview').style.display = 'flex';
            clearImageBtn.style.display = 'inline-flex';
            addLog('info', ` Billede valgt: ${file.name}`);
        }
    });

    clearImageBtn.addEventListener('click', () => {
        selectedImagePath = null;
        imageInput.value = '';
        document.getElementById('imagePreview').style.display = 'none';
        clearImageBtn.style.display = 'none';
        addLog('info', ' Billede fjernet');
    });
    // Login
    const loginBtn = document.getElementById('loginBtn');
    const loginOverlay = document.getElementById('loginOverlay');
    const loginError = document.getElementById('loginError');
    const loginUsernameInput = document.getElementById('loginUsername');
    const loginPasswordInput = document.getElementById('loginPassword');

    loginBtn.addEventListener('click', () => {
        const username = loginUsernameInput.value.trim();
        const password = loginPasswordInput.value.trim();

        if (username === 'admin' && password === 'password123!') {
            loginOverlay.style.display = 'none';
            startDemoTimer();
            addLog('success', ' Logged in as admin');

            // Show guidance on first successful login if no data saved
            if (!localStorage.getItem(messengerDataKey()) && !localStorage.getItem('telegramMessengerData')) {
                showGuidanceModal();
            }
        } else {
            loginError.style.display = 'block';
            setTimeout(() => {
                loginError.style.display = 'none';
            }, 3000);
        }
    });

    loginPasswordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginBtn.click();
    });

    // Settings Modal
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsModal = document.getElementById('closeSettingsModal');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const themeRadios = document.querySelectorAll('input[name="theme"]');

    openSettingsBtn.addEventListener('click', () => {
        // Load saved settings into fields
        document.getElementById('proxyHost').value = localStorage.getItem('proxyHost') || '';
        document.getElementById('proxyPort').value = localStorage.getItem('proxyPort') || '';
        document.getElementById('proxyUser').value = localStorage.getItem('proxyUser') || '';
        document.getElementById('proxyPass').value = localStorage.getItem('proxyPass') || '';
        const licenseKeyInput = document.getElementById('licenseKey');
        if (licenseKeyInput) licenseKeyInput.value = '';

        settingsModal.style.display = 'flex';
        refreshLicenseStatus();
    });

    closeSettingsModal.addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });

    saveSettingsBtn.addEventListener('click', () => {
        // Save Proxy
        localStorage.setItem('proxyHost', document.getElementById('proxyHost').value);
        localStorage.setItem('proxyPort', document.getElementById('proxyPort').value);
        localStorage.setItem('proxyUser', document.getElementById('proxyUser').value);
        localStorage.setItem('proxyPass', document.getElementById('proxyPass').value);

        // Save Theme
        const theme = document.querySelector('input[name="theme"]:checked').value;
        localStorage.setItem('theme', theme);
        if (theme === 'light') {
            document.body.classList.add('light-mode');
        } else {
            document.body.classList.remove('light-mode');
        }

        settingsModal.style.display = 'none';
        addLog('success', ' Settings saved successfully!');
    });

    // Updates (packaged builds only)
    const updateStatusText = document.getElementById('updateStatusText');
    const btnCheckUpdates = document.getElementById('btn-check-updates');
    const btnDownloadUpdate = document.getElementById('btn-download-update');
    const btnInstallUpdate = document.getElementById('btn-install-update');

    function setUpdateStatus(txt) {
        if (updateStatusText) updateStatusText.textContent = `Status: ${txt}`;
    }

    if (btnCheckUpdates) {
        btnCheckUpdates.addEventListener('click', async () => {
            setUpdateStatus('checking...');
            try {
                const res = await ipcRenderer.invoke('check-for-updates');
                if (!res?.success) setUpdateStatus(`error: ${res?.error || 'unknown'}`);
            } catch (e) {
                setUpdateStatus(`error: ${e?.message || String(e)}`);
            }
        });
    }

    if (btnDownloadUpdate) {
        btnDownloadUpdate.addEventListener('click', async () => {
            setUpdateStatus('downloading...');
            try {
                const res = await ipcRenderer.invoke('download-update');
                if (!res?.success) setUpdateStatus(`error: ${res?.error || 'unknown'}`);
            } catch (e) {
                setUpdateStatus(`error: ${e?.message || String(e)}`);
            }
        });
    }

    if (btnInstallUpdate) {
        btnInstallUpdate.addEventListener('click', async () => {
            try {
                await ipcRenderer.invoke('quit-and-install-update');
            } catch (e) {
                setUpdateStatus(`error: ${e?.message || String(e)}`);
            }
        });
    }

    ipcRenderer.on('update-status', (event, st) => {
        const state = st?.state || 'unknown';
        setUpdateStatus(state);
        if (btnDownloadUpdate) btnDownloadUpdate.style.display = (state === 'available') ? 'inline-flex' : 'none';
        if (btnInstallUpdate) btnInstallUpdate.style.display = (state === 'downloaded') ? 'inline-flex' : 'none';
        if (state === 'error') addLog('warning', `Update error: ${st?.error || 'unknown'}`);

        // Auto-update UX: show an "Updating" overlay and let the app update automatically.
        const updatingModal = document.getElementById('updatingModal');
        const updatingText = document.getElementById('updatingText');
        const updatingProgress = document.getElementById('updatingProgress');

        const showUpdating = (txt) => {
            if (updatingText) updatingText.textContent = txt;
            if (updatingModal) updatingModal.style.display = 'flex';
        };
        const hideUpdating = () => {
            if (updatingModal) updatingModal.style.display = 'none';
        };

        if (state === 'available') {
            showUpdating('Update found. Downloading...');
        } else if (state === 'downloading') {
            const p = st?.progress;
            const pct = (p && typeof p.percent === 'number') ? Math.max(0, Math.min(100, p.percent)) : null;
            if (pct !== null && updatingProgress) updatingProgress.style.width = `${pct.toFixed(0)}%`;
            showUpdating(pct !== null ? `Downloading... ${pct.toFixed(0)}%` : 'Downloading...');
        } else if (state === 'downloaded') {
            if (updatingProgress) updatingProgress.style.width = '100%';
            showUpdating('Downloaded. Installing...');
        } else if (state === 'installing') {
            showUpdating('Installing update...');
        } else if (state === 'none') {
            // Only hide if it was shown for updates.
            hideUpdating();
        } else if (state === 'error') {
            hideUpdating();
        }
    });

    const saveLicenseButton = document.getElementById('btn-save-license');
    if (saveLicenseButton) {
        saveLicenseButton.addEventListener('click', () => {
            ipcRenderer.invoke('set-license-key', 'SALES-BUILD-NO-LICENSE')
                .then(() => refreshLicenseStatus())
                .catch(() => refreshLicenseStatus());
        });
    }

    // API Guidance
    const showGuidanceBtn = document.getElementById('showGuidanceBtn');
    const guidanceModal = document.getElementById('guidanceModal');
    const closeGuidanceBtn = document.getElementById('closeGuidanceBtn');

    showGuidanceBtn.addEventListener('click', () => {
        showGuidanceModal();
    });

    closeGuidanceBtn.addEventListener('click', () => {
        guidanceModal.style.display = 'none';
    });

    // Close modals on click outside
    window.addEventListener('click', (e) => {
        if (e.target === guidanceModal) {
            guidanceModal.style.display = 'none';
        }
        if (e.target === settingsModal) {
            settingsModal.style.display = 'none';
        }
    });

    // Top Menu Items
    const menuFile = document.getElementById('menuFile');
    const menuView = document.getElementById('menuView');
    const menuAbout = document.getElementById('menuAbout');

    if (menuFile) {
        menuFile.addEventListener('click', () => {
            // Placeholder for File menu
            addLog('info', ' File menu clicked');
        });
    }

    if (menuView) {
        menuView.addEventListener('click', () => {
            // Placeholder for View menu
            addLog('info', ' View menu clicked');
        });
    }

    if (menuAbout) {
        menuAbout.addEventListener('click', () => {
            // Show about dialog
            alert('Telegram Group Messenger v1.0.0\n\nProfessional messaging automation tool\n\n 2026');
        });
    }

    // Application Closure Logic
    ipcRenderer.on('confirm-app-close', () => {
        showSaveConfirmModal();
    });

    const saveConfirmModal = document.getElementById('saveConfirmModal');
    const saveAndCloseBtn = document.getElementById('saveAndCloseBtn');
    const justCloseBtn = document.getElementById('justCloseBtn');
    const cancelCloseBtn = document.getElementById('cancelCloseBtn');

    saveAndCloseBtn.addEventListener('click', () => {
        saveData();
        ipcRenderer.send('app-closing-confirmed', true);
    });

    justCloseBtn.addEventListener('click', () => {
        ipcRenderer.send('app-closing-confirmed', false);
    });

    cancelCloseBtn.addEventListener('click', () => {
        saveConfirmModal.style.display = 'none';
    });
}

function showSaveConfirmModal() {
    document.getElementById('saveConfirmModal').style.display = 'flex';
}

function showGuidanceModal() {
    document.getElementById('guidanceModal').style.display = 'flex';
}


function updateLinkCount() {
    const text = groupLinksInput.value;
    const linkRegex = /https?:\/\/t\.me\/([a-zA-Z0-9_+]+)/g;
    const matches = [...text.matchAll(linkRegex)];
    linkCountSpan.textContent = matches.length;
}

function validateCredentials() {
    if (!apiIdInput.value.trim()) {
        addLog('error', 'API ID is required');
        return false;
    }
    if (!apiHashInput.value.trim()) {
        addLog('error', 'API Hash is required');
        return false;
    }
    if (!phoneNumberInput.value.trim()) {
        addLog('error', 'Phone number is required');
        return false;
    }
    return true;
}

function validateInputs() {
    if (!validateCredentials()) {
        return false;
    }
    if (!messageInput.value.trim()) {
        addLog('error', 'Message is required');
        return false;
    }
    if (scannedGroups.length > 0 && selectedGroupIds.size === 0) {
        addLog('error', 'Select at least one group from the list');
        return false;
    }
    if (scannedGroups.length === 0 && linkCountSpan.textContent === '0') {
        addLog('error', 'At least one valid Telegram group link is required');
        return false;
    }
    return true;
}

async function scanGroups() {
    if (isScanning) return;
    isScanning = true;
    scanningSessionName = getActiveAccountId() || 'default';
    updateAccountsUiState();
    refreshRunControls();

    // Show loading state
    scanGroupsBtn.disabled = true;
    scanGroupsBtn.classList.add('loading');
    scanIcon.style.display = 'none';
    scanSpinner.style.display = 'inline-block';
    scanBtnText.textContent = 'Scanning...';
    scanningIndicator.style.display = 'flex';
    scanningText.textContent = 'Connecting to Telegram...';

    addLog('info', ` Starting group scan (${getAccountLabelById(scanningSessionName)})...`);

    const config = {
        apiId: apiIdInput.value.trim(),
        apiHash: apiHashInput.value.trim(),
        phoneNumber: phoneNumberInput.value.trim(),
        password: passwordInput.value,
        sessionName: scanningSessionName,
        authMethod: (document.getElementById('authMethod')?.value || 'qr'),
        proxy: getProxyConfigFromInputs(),
        ...getRateLimitConfigFromInputs(),
        scanGroups: true
    };

    console.log('Sending scan config:', config);

    try {
        const result = await ipcRenderer.invoke('scan-groups', config);
        console.log('Scan result:', result);

        if (!result.success) {
            addLog('error', ` Scan error: ${result.error}`);
            resetScanButton('error');
        }
    } catch (error) {
        console.error('Scan error:', error);
        addLog('error', ` Unexpected error: ${error.message}`);
        resetScanButton('error');
    }
}

function resetScanButton(state = 'normal') {
    isScanning = false;
    scanningSessionName = '';
    updateAccountsUiState();
    refreshRunControls();

    scanGroupsBtn.disabled = false;
    scanGroupsBtn.classList.remove('loading');
    scanIcon.style.display = 'inline';
    scanSpinner.style.display = 'none';
    scanBtnText.textContent = 'Scan My Groups';
    scanningIndicator.style.display = 'none';

    if (state === 'success') {
        scanGroupsBtn.classList.add('scan-success');
        setTimeout(() => scanGroupsBtn.classList.remove('scan-success'), 2000);
    } else if (state === 'error') {
        scanGroupsBtn.classList.add('scan-error');
        setTimeout(() => scanGroupsBtn.classList.remove('scan-error'), 2000);
    }
}

function updateScanningStatus(message) {
    scanningText.textContent = message;
    addLog('info', message);
}

function displayScannedGroups(groups) {
    scannedGroups = groups;
    scannedGroupsList.innerHTML = '';

    if (groups.length === 0) {
        addLog('warning', ' No groups found. Are you member of any groups?');
        resetScanButton('error');
        return;
    }

    groups.forEach(group => {
        const groupItem = document.createElement('div');
        groupItem.className = 'group-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `group-${group.id}`;
        checkbox.value = group.id;
        checkbox.checked = selectedGroupIds.has(group.id);
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedGroupIds.add(group.id);
            } else {
                selectedGroupIds.delete(group.id);
            }
            updateSelectedCount();
            saveGroupState();
        });

        const label = document.createElement('label');
        label.htmlFor = `group-${group.id}`;

        const groupType = group.is_channel ? '' : '';
        const memberInfo = group.members_count !== 'N/A' ? ` (${group.members_count} members)` : '';
        label.textContent = `${groupType} ${group.title}${memberInfo}`;

        groupItem.appendChild(checkbox);
        groupItem.appendChild(label);
        scannedGroupsList.appendChild(groupItem);
    });

    scannedGroupsContainer.style.display = 'block';
    manualLinksContainer.style.display = 'none';

    if (isScanning) {
        resetScanButton('success');
        addLog('success', ` ${groups.length} groups found and ready!`);
    }
    updateSelectedCount();
    saveGroupState();
}

function updateSelectedCount() {
    selectedCountSpan.textContent = selectedGroupIds.size;
}

async function startMessaging() {
    const sessionName = getActiveAccountId() || 'default';
    if (runningAccounts.has(sessionName)) return;
    if (isScanning && scanningSessionName === sessionName) return;

    const config = {
        apiId: apiIdInput.value.trim(),
        apiHash: apiHashInput.value.trim(),
        phoneNumber: phoneNumberInput.value.trim(),
        password: passwordInput.value,
        sessionName,
        authMethod: (document.getElementById('authMethod')?.value || 'qr'),
        proxy: getProxyConfigFromInputs(),
        ...getRateLimitConfigFromInputs(),
        message: messageInput.value.trim(),
        imagePath: selectedImagePath,
        scheduleType: document.querySelector('input[name="scheduleType"]:checked').value,
        timesPerDay: timesPerDayInput.value,
        intervalHours: intervalHoursInput.value
    };

    // Add group selection based on mode
    if (scannedGroups.length > 0 && selectedGroupIds.size > 0) {
        config.scanGroups = true;
        config.selectedGroupIds = Array.from(selectedGroupIds);
    } else {
        config.links = groupLinksInput.value.trim();
        config.scanGroups = false;
    }

    // Data is only saved when confirming on exit

    // Show loading state
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="spinner"></span> Connecting...';
    stopBtn.disabled = true;
    updateAccountsUiState();
    refreshRunControls();

    addLog('info', ` Starting message delivery (${getAccountLabelById(sessionName)})...`);

    try {
        const result = await ipcRenderer.invoke('start-messaging', config);

        if (!result.success) {
            addLog('error', ` Error: ${result.error}`);
            refreshRunControls();
        } else {
            runningAccounts.add(sessionName);
            addLog('success', ` Message delivery started (${getAccountLabelById(sessionName)})`);
            refreshRunControls();
        }
    } catch (error) {
        addLog('error', ` Unexpected error: ${error.message}`);
        refreshRunControls();
    } finally {
        updateAccountsUiState();
        refreshRunControls();
    }
}

function resetStartButton() {
    updateAccountsUiState();
    refreshRunControls();
}

async function stopMessaging(sessionName) {
    const s = sessionName || getActiveAccountId() || 'default';

    let result = null;
    try {
        result = await ipcRenderer.invoke('stop-messaging', s);
    } catch (e) {
        result = { success: false, error: e?.message || String(e) };
    } finally {
        resetStartButton();
    }

    if (result?.success) runningAccounts.delete(s);
    if (result?.success) addLog('info', ` Message delivery stopped (${getAccountLabelById(s)})`);
    else addLog('warning', `Stop failed (${getAccountLabelById(s)}): ${result?.error || 'Unknown error'}`);
}

// IPC Listeners
ipcRenderer.on('status-update', (event, payload) => {
    const sessionName = payload?.sessionName || 'default';
    const status = payload || {};

    if (status.stats) accountStats.set(sessionName, status.stats);

    if (status.stats && sessionName === (getActiveAccountId() || 'default')) {
        sentCount.textContent = status.stats.sent || 0;
        failedCount.textContent = status.stats.failed || 0;
        totalCount.textContent = status.stats.total || 0;
    }

    if (status.running) runningAccounts.add(sessionName);
    else runningAccounts.delete(sessionName);

    updateAccountsUiState();
    refreshRunControls();
    renderRunningAccountsList();
});

ipcRenderer.on('log-update', (event, log) => {
    const sessionName = log?.sessionName || '';
    const prefix = sessionName ? `[${getAccountLabelById(sessionName)}] ` : '';
    addLog(log.type || 'info', prefix + (log.message || ''));
});

ipcRenderer.on('error-update', (event, error) => {
    const sessionName = error?.sessionName || '';
    const prefix = sessionName ? `[${getAccountLabelById(sessionName)}] ` : '';
    addLog('error', prefix + (error.message || 'Unknown error'));
});

ipcRenderer.on('needs-code', async (event, data) => {
    pendingAuthSessionName = data?.sessionName || getActiveAccountId() || 'default';
    addLog('info', `Awaiting confirmation code for ${getAccountLabelById(pendingAuthSessionName)}...`);
    showCodeModal();
});

ipcRenderer.on('needs-password', async (event, data) => {
    pendingAuthSessionName = data?.sessionName || getActiveAccountId() || 'default';
    addLog('info', `Awaiting 2FA password for ${getAccountLabelById(pendingAuthSessionName)}...`);
    showPasswordModal();
});

ipcRenderer.on('qr-login', async (event, data) => {
    pendingAuthSessionName = data?.sessionName || getActiveAccountId() || 'default';
    addLog('info', `Scan QR code to login: ${getAccountLabelById(pendingAuthSessionName)}`);
    showQrModal(data?.url || '');
});

// Modal functions
function showCodeModal() {
    const modal = document.getElementById('codeModal');
    const input = document.getElementById('codeInput');
    const submitBtn = document.getElementById('submitCodeBtn');
    const cancelBtn = document.getElementById('cancelCodeBtn');

    modal.style.display = 'flex';
    input.value = '';
    input.focus();

    const handleSubmit = async () => {
        const code = input.value.trim();
        if (code) {
            try {
                addLog('info', 'Sending verification code...');
                const res = await ipcRenderer.invoke('send-code', pendingAuthSessionName || (getActiveAccountId() || 'default'), code);
                if (!res?.success) {
                    addLog('error', res?.error || 'Failed to send verification code');
                    return;
                }
                modal.style.display = 'none';
            } catch (e) {
                addLog('error', e?.message || String(e));
            }
        }
    };

    const handleCancel = async () => {
        modal.style.display = 'none';
        addLog('error', 'Confirmation cancelled.');
        try { await stopMessaging(pendingAuthSessionName || (getActiveAccountId() || 'default')); } catch (e) { }
        if (isScanning) resetScanButton('error');
        resetStartButton();
    };

    submitBtn.onclick = handleSubmit;
    cancelBtn.onclick = handleCancel;
    input.onkeypress = (e) => {
        if (e.key === 'Enter') handleSubmit();
    };
}

function showPasswordModal() {
    const modal = document.getElementById('passwordModal');
    const input = document.getElementById('twoFaInput');
    const submitBtn = document.getElementById('submitPasswordBtn');
    const cancelBtn = document.getElementById('cancelPasswordBtn');

    modal.style.display = 'flex';
    input.value = '';
    input.focus();

    const handleSubmit = async () => {
        const password = input.value;
        if (password) {
            try {
                addLog('info', 'Sending 2FA password...');
                const res = await ipcRenderer.invoke('send-password', pendingAuthSessionName || (getActiveAccountId() || 'default'), password);
                if (!res?.success) {
                    addLog('error', res?.error || 'Failed to send 2FA password');
                    return;
                }
                modal.style.display = 'none';
            } catch (e) {
                addLog('error', e?.message || String(e));
            }
        }
    };

    const handleCancel = async () => {
        modal.style.display = 'none';
        addLog('error', '2FA cancelled.');
        try { await stopMessaging(pendingAuthSessionName || (getActiveAccountId() || 'default')); } catch (e) { }
        if (isScanning) resetScanButton('error');
        resetStartButton();
    };

    submitBtn.onclick = handleSubmit;
    cancelBtn.onclick = handleCancel;
    input.onkeypress = (e) => {
        if (e.key === 'Enter') handleSubmit();
    };
}

ipcRenderer.on('groups-scanned', (event, data) => {
    console.log('Groups scanned received:', data);
    const sessionName = data?.sessionName || 'default';
    const groups = Array.isArray(data?.groups) ? data.groups : [];

    // New scan: reset selection for this account.
    try { localStorage.setItem(selectedGroupIdsKey(sessionName), JSON.stringify([])); } catch (e) { }
    try { localStorage.setItem(scannedGroupsKey(sessionName), JSON.stringify(groups)); } catch (e) { }

    if (sessionName === (getActiveAccountId() || 'default')) {
        selectedGroupIds = new Set();
        displayScannedGroups(groups);
    } else {
        addLog('info', `Scan finished for ${getAccountLabelById(sessionName)} (${groups.length} groups). Switch to that account to select groups.`);
    }
});

ipcRenderer.on('scan-status', (event, data) => {
    console.log('Scan status:', data);
    const sessionName = data?.sessionName || '';
    if (sessionName && scanningSessionName && sessionName !== scanningSessionName) return;
    if (data.message) updateScanningStatus(data.message);
});

ipcRenderer.on('scan-error', (event, data) => {
    console.log('Scan error:', data);
    const sessionName = data?.sessionName || '';
    if (sessionName && scanningSessionName && sessionName !== scanningSessionName) return;
    addLog('error', ` ${data.message || 'Unknown error during scan'}`);
    resetScanButton('error');
});

function addLog(type, message) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const time = new Date().toLocaleTimeString('en-US');
    entry.innerHTML = `<span class="log-time">[${time}]</span>${message}`;

    logOutput.appendChild(entry);
    logOutput.scrollTop = logOutput.scrollHeight;
}

// Data persistence
function collectMessengerData() {
    return {
        message: messageInput.value,
        links: groupLinksInput.value,
        scheduleType: document.querySelector('input[name="scheduleType"]:checked').value,
        timesPerDay: timesPerDayInput.value,
        intervalHours: intervalHoursInput.value
    };
}

function showQrModal(url) {
    const modal = document.getElementById('qrModal');
    const img = document.getElementById('qrImage');
    const cancelBtn = document.getElementById('cancelQrBtn');

    if (!modal || !img) return;

    modal.style.display = 'flex';
    img.src = '';

    // Generate a QR image in-memory. Keep it light and local (no web calls).
    QRCode.toDataURL(url || '', { errorCorrectionLevel: 'M', margin: 1, width: 260 })
        .then((dataUrl) => { img.src = dataUrl; })
        .catch((e) => { addLog('error', e?.message || String(e)); });

    if (cancelBtn) {
        cancelBtn.onclick = async () => {
            modal.style.display = 'none';
            try { await stopMessaging(pendingAuthSessionName || (getActiveAccountId() || 'default')); } catch (e) { }
        };
    }
}

function saveDataQuiet() {
    try {
        localStorage.setItem(messengerDataKey(), JSON.stringify(collectMessengerData()));
    } catch (e) { }
}

function saveData() {
    const data = {
        message: messageInput.value,
        links: groupLinksInput.value,
        scheduleType: document.querySelector('input[name="scheduleType"]:checked').value,
        timesPerDay: timesPerDayInput.value,
        intervalHours: intervalHoursInput.value
    };
    localStorage.setItem(messengerDataKey(), JSON.stringify(data));
    addLog('success', ' Information saved!');
}

function loadSavedData() {
    // Default values (Empty for sales-ready version)
    const defaults = {
        message: '',
        links: '',
        scheduleType: 'daily',
        timesPerDay: '1',
        intervalHours: '1'
    };

    const key = messengerDataKey();
    let saved = localStorage.getItem(key);

    // Backward compat migration: older versions stored a single global key.
    if (!saved) {
        const legacy = localStorage.getItem('telegramMessengerData');
        if (legacy) {
            saved = legacy;
            try { localStorage.setItem(key, legacy); } catch (e) { }
        }
    }
    if (saved) {
        try {
            const data = JSON.parse(saved);

            // Use saved values, but fall back to defaults if empty
            messageInput.value = data.message || defaults.message;
            groupLinksInput.value = data.links || defaults.links;

            if (data.scheduleType) {
                document.querySelector(`input[name="scheduleType"][value="${data.scheduleType}"]`).checked = true;
            } else {
                document.querySelector(`input[name="scheduleType"][value="${defaults.scheduleType}"]`).checked = true;
            }
            scheduleTypeRadios[0].dispatchEvent(new Event('change'));

            timesPerDayInput.value = data.timesPerDay || defaults.timesPerDay;
            intervalHoursInput.value = data.intervalHours || defaults.intervalHours;
            try { updateLinkCount(); } catch (e) { }
        } catch (e) {
            console.error('Error loading saved data:', e);
            // Load defaults on error
            loadDefaults();
        }
    } else {
        // No saved data, load defaults
        loadDefaults();
    }
}

function loadDefaults() {
    messageInput.value = '';
    groupLinksInput.value = '';
    document.querySelector('input[name="scheduleType"][value="daily"]').checked = true;
    scheduleTypeRadios[0].dispatchEvent(new Event('change'));
    timesPerDayInput.value = '1';
    intervalHoursInput.value = '1';
    try { updateLinkCount(); } catch (e) { }
}

// Keyword Monitor (Premium)
let keywordMonitorRunning = false;
let keywordLeadCount = 0;

function keywordStorageKey() {
    return `tgmKeywords:${getActiveAccountId() || 'default'}`;
}

function loadKeywordsToUI() {
    const el = document.getElementById('keywordList');
    if (!el) return;
    el.value = localStorage.getItem(keywordStorageKey()) || '';
}

function saveKeywordsFromUI() {
    const el = document.getElementById('keywordList');
    if (!el) return;
    localStorage.setItem(keywordStorageKey(), el.value || '');
}

function updateKeywordMonitorStatus(status, type) {
    const indicator = document.getElementById('keywordMonitorIndicator');
    const statusText = document.getElementById('keywordMonitorStatusText');
    const statusBox = document.getElementById('keywordMonitorStatus');
    const countEl = document.getElementById('keywordMonitorLeadCount');

    if (statusBox) statusBox.style.display = 'block';
    if (statusText) statusText.textContent = status;
    if (countEl) countEl.textContent = String(keywordLeadCount);

    if (indicator) {
        indicator.style.color = (type === 'success') ? 'var(--success)' : 'var(--error)';
        indicator.textContent = '';
    }
}

function addKeywordMonitorLog(type, message) {
    const logOutput = document.getElementById('keywordMonitorLogOutput');
    if (!logOutput) return;
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${type || 'info'}`;
    logEntry.innerHTML = `<span class="log-time">[${timestamp}]</span> ${message}`;
    logOutput.appendChild(logEntry);
    logOutput.scrollTop = logOutput.scrollHeight;
}

async function startKeywordMonitor() {
    if (keywordMonitorRunning) return;

    if (!appFlags || (appFlags.edition || 'standard') !== 'premium') {
        addLog('error', 'Keyword Monitor is only available in Premium.');
        return;
    }

    if (scannedGroups.length === 0 || selectedGroupIds.size === 0) {
        addLog('error', 'Scan groups and select at least one group to monitor.');
        return;
    }

    const kwEl = document.getElementById('keywordList');
    const raw = (kwEl?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!raw.length) {
        addLog('error', 'Add at least one keyword.');
        return;
    }
    saveKeywordsFromUI();

    const chatIds = Array.from(selectedGroupIds);

    const config = {
        apiId: apiIdInput.value.trim(),
        apiHash: apiHashInput.value.trim(),
        sessionName: getActiveAccountId(),
        chatIds,
        keywords: raw,
        flushSeconds: 600
    };

    const startBtn = document.getElementById('startKeywordMonitorBtn');
    const stopBtn = document.getElementById('stopKeywordMonitorBtn');
    if (startBtn) startBtn.disabled = true;

    const res = await ipcRenderer.invoke('start-keyword-monitor', config);
    if (!res.success) {
        if (startBtn) startBtn.disabled = false;
        addLog('error', `Keyword monitor error: ${res.error}`);
        return;
    }

    keywordMonitorRunning = true;
    updateAccountsUiState();
    if (stopBtn) stopBtn.disabled = false;
    const logsBox = document.getElementById('keywordMonitorLogs');
    if (logsBox) logsBox.style.display = 'block';
    updateKeywordMonitorStatus('Running', 'success');
    addKeywordMonitorLog('success', `Monitoring ${chatIds.length} chats for ${raw.length} keywords. Writing to kunder.csv every 10 minutes (per account).`);
}

async function stopKeywordMonitor() {
    const res = await ipcRenderer.invoke('stop-keyword-monitor');
    keywordMonitorRunning = false;
    updateAccountsUiState();
    const startBtn = document.getElementById('startKeywordMonitorBtn');
    const stopBtn = document.getElementById('stopKeywordMonitorBtn');
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    updateKeywordMonitorStatus('Stopped', 'error');
    addKeywordMonitorLog('info', 'Keyword monitor stopped');
    return res;
}

document.addEventListener('DOMContentLoaded', () => {
    loadKeywordsToUI();
    const startBtn = document.getElementById('startKeywordMonitorBtn');
    const stopBtn = document.getElementById('stopKeywordMonitorBtn');
    const kwEl = document.getElementById('keywordList');

    if (kwEl) kwEl.addEventListener('input', saveKeywordsFromUI);
    if (startBtn) startBtn.addEventListener('click', startKeywordMonitor);
    if (stopBtn) stopBtn.addEventListener('click', stopKeywordMonitor);
});

ipcRenderer.on('keyword-monitor-log', (event, data) => {
    addKeywordMonitorLog(data.type || 'info', data.message);
});

ipcRenderer.on('keyword-monitor-lead', (event, data) => {
    keywordLeadCount += 1;
    updateKeywordMonitorStatus('Running', 'success');
    const who = data.username ? `@${data.username}` : (data.display_name || `user ${data.user_id}`);
    const price = (data.price_dkk !== undefined && data.price_dkk !== null && String(data.price_dkk) !== '')
        ? ` | ${data.price_dkk} kr`
        : '';
    addKeywordMonitorLog('info', `Lead: ${who} matched "${data.keyword}" (chat ${data.chat_id})${price}`);
});

ipcRenderer.on('keyword-monitor-csv', (event, data) => {
    addKeywordMonitorLog('success', `CSV updated: ${data.count} leads -> ${data.path}`);
});

ipcRenderer.on('keyword-monitor-error', (event, data) => {
    addKeywordMonitorLog('error', data.message || 'Keyword monitor error');
    keywordMonitorRunning = false;
    updateAccountsUiState();
    const startBtn = document.getElementById('startKeywordMonitorBtn');
    const stopBtn = document.getElementById('stopKeywordMonitorBtn');
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    updateKeywordMonitorStatus('Stopped', 'error');
});

ipcRenderer.on('keyword-monitor-stopped', (event, data) => {
    keywordMonitorRunning = false;
    updateAccountsUiState();
    const startBtn = document.getElementById('startKeywordMonitorBtn');
    const stopBtn = document.getElementById('stopKeywordMonitorBtn');
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    updateKeywordMonitorStatus('Stopped', 'error');
});

// Bot Plugin (legacy) UI removed.\r\n

