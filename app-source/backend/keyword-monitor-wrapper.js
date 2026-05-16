const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');
const { app } = require('electron');
const { resolvePython } = require('./python-resolver');

class KeywordMonitor extends EventEmitter {
  constructor() {
    super();
    this.process = null;
  }

  start(config) {
    return new Promise((resolve, reject) => {
      try {
        const python = resolvePython();
        if (!python) {
          reject(new Error('Python not found. Please install Python 3 and try again.'));
          return;
        }

        const scriptPath = app.isPackaged
          ? path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'keyword_monitor.py')
          : path.join(__dirname, 'keyword_monitor.py');

        const pythonArgs = [...python.argsPrefix, scriptPath, JSON.stringify(config)];

        this.process = spawn(python.command, pythonArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            TGM_USER_DATA: app.getPath('userData'),
          },
          windowsHide: true,
        });

        this.process.stdout.on('data', (data) => {
          const lines = data.toString().split('\n').filter((l) => l.trim());
          for (const line of lines) {
            try {
              const msg = JSON.parse(line);
              this._handle(msg);
            } catch {
              // ignore
            }
          }
        });

        this.process.stderr.on('data', (data) => {
          const s = data.toString();
          if (s.trim()) this.emit('error', { message: s });
        });

        this.process.on('close', (code) => {
          this.emit('stopped', { code });
          this.process = null;
        });

        this.process.on('error', (err) => {
          this.emit('error', { message: err.message });
          reject(err);
        });

        // Consider the process started once we have a PID.
        setTimeout(() => {
          if (this.process) resolve();
          else reject(new Error('Failed to start keyword monitor'));
        }, 250);
      } catch (e) {
        reject(e);
      }
    });
  }

  _handle(msg) {
    const { type, data } = msg || {};
    if (!type) return;
    this.emit(type, data);
  }

  stop() {
    try {
      this.process?.kill();
    } catch { }
    this.process = null;
  }
}

module.exports = { KeywordMonitor };

