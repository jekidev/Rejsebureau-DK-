const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function tryRegSzValue(keyPath, valueName) {
  if (process.platform !== 'win32') return null;
  try {
    // Output format:
    // <key>
    //     <valueName>    REG_SZ    <value>
    const out = execSync(`reg query "${keyPath}" /v "${valueName}"`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      encoding: 'utf8',
    });
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const hit = lines.find((l) => l.toLowerCase().startsWith(valueName.toLowerCase()));
    if (!hit) return null;

    // Split on runs of whitespace: name, type, value...
    const parts = hit.split(/\s{2,}/);
    if (parts.length < 3) return null;
    const val = parts.slice(2).join('  ').trim();
    return val || null;
  } catch {
    return null;
  }
}

function canRun(command, args) {
  const r = spawnSync(command, args, { windowsHide: true });
  return r && r.status === 0;
}

function requirementsPath() {
  const candidates = [
    path.join(__dirname, '..', 'requirements.txt'),
  ];

  if (process.resourcesPath) {
    candidates.unshift(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'requirements.txt')
    );
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function ensurePythonRequirements(python) {
  const req = requirementsPath();
  if (!req) return;

  const importCheck = spawnSync(
    python.command,
    [...python.argsPrefix, '-c', 'import telethon, requests, bs4, watchdog'],
    { windowsHide: true, stdio: 'ignore', timeout: 30000 }
  );
  if (importCheck.status === 0) return;

  const usesVenv = /[\\/]venv[\\/]/i.test(python.command);
  const pipArgs = [...python.argsPrefix, '-m', 'pip', 'install'];
  if (!usesVenv) pipArgs.push('--user');
  pipArgs.push('-r', req);

  spawnSync(python.command, pipArgs, {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 180000,
  });
}

/**
 * Returns a command + args prefix that can run Python.
 * Prefers a per-user venv set up by the NSIS installer (or by a previous run).
 */
function resolvePython() {
  let resolved = null;

  if (process.env.TGM_PYTHON && exists(process.env.TGM_PYTHON)) {
    resolved = { command: process.env.TGM_PYTHON, argsPrefix: [] };
    ensurePythonRequirements(resolved);
    return resolved;
  }

  if (process.platform === 'win32') {
    const regKey = 'HKCU\\Software\\TelegramGroupMessenger';
    const regVenv = tryRegSzValue(regKey, 'VenvPython');
    if (regVenv && exists(regVenv)) {
      resolved = { command: regVenv, argsPrefix: [] };
      ensurePythonRequirements(resolved);
      return resolved;
    }

    const localAppData =
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const defaultVenv = path.join(
      localAppData,
      'TelegramGroupMessenger',
      'venv',
      'Scripts',
      'python.exe'
    );
    if (exists(defaultVenv)) {
      resolved = { command: defaultVenv, argsPrefix: [] };
      ensurePythonRequirements(resolved);
      return resolved;
    }

    if (canRun('python', ['--version'])) {
      resolved = { command: 'python', argsPrefix: [] };
      ensurePythonRequirements(resolved);
      return resolved;
    }

    // Windows Python launcher
    if (canRun('py', ['-3', '--version'])) {
      resolved = { command: 'py', argsPrefix: ['-3'] };
      ensurePythonRequirements(resolved);
      return resolved;
    }
  } else {
    if (canRun('python3', ['--version'])) {
      resolved = { command: 'python3', argsPrefix: [] };
      ensurePythonRequirements(resolved);
      return resolved;
    }
    if (canRun('python', ['--version'])) {
      resolved = { command: 'python', argsPrefix: [] };
      ensurePythonRequirements(resolved);
      return resolved;
    }
  }

  return null;
}

module.exports = { resolvePython };
