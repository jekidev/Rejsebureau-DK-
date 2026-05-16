const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const { app } = require('electron');
const { resolvePython } = require('./python-resolver');

class TelegramMessenger extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.pythonProcess = null;
    this.isActive = false;
    this.stats = {
      sent: 0,
      failed: 0,
      total: 0,
      startTime: null
    };
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      try {
        const python = resolvePython();
        if (!python) {
          reject(new Error('Python not found. Please install Python 3 and try again.'));
          return;
        }

        const pythonScript = app.isPackaged
          ? path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'telegram-messenger.py')
          : path.join(__dirname, 'telegram-messenger.py');

        // Start Python process
        const pythonArgs = [...python.argsPrefix, pythonScript];

        this.pythonProcess = spawn(python.command, pythonArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            // Ensure Telethon session and other writable data goes somewhere writable.
            TGM_USER_DATA: app.getPath('userData')
          },
          windowsHide: true,
        });

        let initResolved = false;
        let initRejected = false;
        let initTimer = null;
        const resolveOnce = () => {
          if (!initResolved && !initRejected) {
            initResolved = true;
            if (initTimer) clearTimeout(initTimer);
            resolve(true);
          }
        };
        const rejectOnce = (err) => {
          if (!initResolved && !initRejected) {
            initRejected = true;
            if (initTimer) clearTimeout(initTimer);
            reject(err);
          }
        };

        // Handle Python output
        this.pythonProcess.stdout.on('data', (data) => {
          const lines = data.toString().split('\n').filter(line => line.trim());
          for (const line of lines) {
            try {
              const output = JSON.parse(line);
              this.handlePythonOutput(output);

              // Resolve when we get groups_scanned or when connected successfully
              if (output.type === 'groups_scanned' ||
                (output.type === 'log' && output.data && output.data.message &&
                  output.data.message.includes('Connected'))) {
                resolveOnce();
              }

              // Also resolve as soon as we're waiting for user input (code/2FA),
              // so the UI can prompt without hitting the timeout.
              if (output.type === 'status' && (output.data?.needsCode || output.data?.needsPassword)) {
                resolveOnce();
              }
            } catch (e) {
              // Not JSON, might be regular print
              console.log('Python output:', line);
            }
          }
        });

        this.pythonProcess.stderr.on('data', (data) => {
          const errorMsg = data.toString();
          const trimmed = errorMsg.trim();

          // Filter out known non-error messages from stderr (pip updates, installation progress, etc.)
          const lowerMsg = errorMsg.toLowerCase();
          if (lowerMsg.includes('install') ||
            lowerMsg.includes('update') ||
            lowerMsg.includes('satisfied') ||
            lowerMsg.includes('checking') ||
            lowerMsg.includes('download') ||
            lowerMsg.includes('%') ||
            lowerMsg.includes('warning') ||
            lowerMsg.includes('*********')) { // Progress bars or dividers
            // Treat as log, or ignore
            this.emit('log', { type: 'debug', message: `System: ${errorMsg}` });
          } else if (/Attempt\s+\d+\s+at connecting failed:/i.test(errorMsg)) {
            // Telethon connection retries often go to stderr; do not treat as fatal.
            this.emit('log', { type: 'warning', message: trimmed || errorMsg });

            // Add a more actionable hint for common Windows network reachability errors.
            if (/\[WinError\s+1231\]|\[WinError\s+1232\]/i.test(errorMsg)) {
              this.emit('log', {
                type: 'info',
                message:
                  'Netværksfejl (WinError 1231/1232): Telegram kan ikke nås fra denne forbindelse. Tjek internet/VPN/proxy/firewall eller prøv et andet netværk.'
              });
            }
          } else {
            console.error('Python stderr:', errorMsg);
            this.emit('error', { message: `Python error: ${errorMsg}` });
          }
        });

        this.pythonProcess.on('close', (code) => {
          if (code !== 0 && this.isActive) {
            this.emit('error', { message: `Python process exited with code ${code}` });
          }
          this.isActive = false;
          this.emit('status', { running: false, stats: this.stats });

          if (!initResolved && !initRejected) {
            // During initialization, any process exit is unexpected. Fail fast so the UI does not continue.
            if (code === 0) rejectOnce(new Error('Python process exited before initialization completed'));
            else rejectOnce(new Error(`Python process exited with code ${code}`));
            return;
          }
        });

        this.pythonProcess.on('error', (err) => {
          console.error('Python process error:', err);
          this.emit('error', { message: `Failed to start Python: ${err.message}` });
          rejectOnce(err);
        });

        // Send config to Python process (keep stdin open for code/password input)
        const configJson = JSON.stringify(this.config);
        this.pythonProcess.stdin.write(configJson + '\n');
        // Don't close stdin - we need it for code/password input

        // Timeout: only resolve on known-good signals (connected / needs input / groups scanned).
        // If none arrives, treat as a failure (otherwise the app will start "sending" while not connected).
        initTimer = setTimeout(() => {
          this.emit('error', { message: 'Initialization timed out (30s) while connecting to Telegram' });
          try { this.pythonProcess?.kill(); } catch (e) { }
          rejectOnce(new Error('Initialization timed out (30s) while connecting to Telegram'));
        }, 30000);

      } catch (error) {
        this.emit('error', { message: `Initialization error: ${error.message}` });
        reject(error);
      }
    });
  }

  handlePythonOutput(output) {
    const { type, data } = output;

    switch (type) {
      case 'log':
        this.emit('log', data);
        break;
      case 'status':
        if (data.stats) {
          this.stats = { ...this.stats, ...data.stats };
        }
        this.isActive = data.running;
        if (data.needsCode) {
          this.emit('needsCode');
        }
        if (data.needsPassword) {
          this.emit('needsPassword');
        }
        this.emit('status', data);
        break;
      case 'groups_scanned':
        this.emit('groupsScanned', data);
        break;
      case 'error':
        this.emit('error', data);
        break;
    }
  }

  sendCode(code) {
    if (this.pythonProcess && this.pythonProcess.stdin.writable) {
      this.pythonProcess.stdin.write(code + '\n');
    }
  }

  sendPassword(password) {
    if (this.pythonProcess && this.pythonProcess.stdin.writable) {
      this.pythonProcess.stdin.write(password + '\n');
    }
  }

  async start() {
    if (this.isActive) {
      return;
    }

    this.isActive = true;
    this.stats.startTime = new Date().toISOString();

    this.emit('status', { running: true, stats: this.stats });
    // Python process will handle the actual messaging
  }

  async stop() {
    this.isActive = false;
    if (this.pythonProcess) {
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
    this.emit('status', { running: false, stats: this.stats });
    this.emit('log', { type: 'info', message: 'Messaging stopped' });
  }

  isRunning() {
    return this.isActive;
  }

  getStats() {
    return { ...this.stats };
  }
}

module.exports = { TelegramMessenger };

