const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');
const { app } = require('electron');
const { resolvePython } = require('./python-resolver');

class ApiFetcher extends EventEmitter {
    constructor() {
        super();
        this.process = null;
    }

    start() {
        return new Promise((resolve, reject) => {
            try {
                const python = resolvePython();
                if (!python) {
                    reject(new Error('Python not found. Please install Python 3 and try again.'));
                    return;
                }

                const scriptPath = app.isPackaged
                    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'api_fetcher.py')
                    : path.join(__dirname, 'api_fetcher.py');

                const pythonArgs = [...python.argsPrefix, scriptPath];

                this.process = spawn(python.command, pythonArgs, {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: {
                        ...process.env,
                        TGM_USER_DATA: app.getPath('userData')
                    },
                    windowsHide: true,
                });

                this.process.stdout.on('data', (data) => {
                    const lines = data.toString().split('\n').filter(line => line.trim());
                    for (const line of lines) {
                        try {
                            const json = JSON.parse(line);
                            this.handleOutput(json);
                        } catch (e) {
                            console.log('Fetcher raw output:', line);
                        }
                    }
                });

                this.process.stderr.on('data', (data) => {
                    const errorMsg = data.toString();
                    const lowerMsg = errorMsg.toLowerCase();

                    if (lowerMsg.includes('install') ||
                        lowerMsg.includes('update') ||
                        lowerMsg.includes('satisfied') ||
                        lowerMsg.includes('checking') ||
                        lowerMsg.includes('download') ||
                        lowerMsg.includes('warning') ||
                        lowerMsg.includes('%')) {
                        console.log('Fetcher stderr (ignored):', errorMsg);
                    } else {
                        console.error('Fetcher stderr:', errorMsg);
                        this.emit('error', errorMsg);
                    }
                });

                this.process.on('close', (code) => {
                    this.emit('status', { running: false, code });
                    this.process = null;
                });

                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    handleOutput(output) {
        if (output.type === 'log') {
            this.emit('log', output.data);
        } else if (output.type === 'input_request') {
            this.emit('input_request', output.data);
        } else if (output.type === 'result') {
            this.emit('result', output.data);
        } else if (output.type === 'error') {
            this.emit('error', output.data.message);
        }
    }

    sendInput(text) {
        if (this.process && this.process.stdin.writable) {
            this.process.stdin.write(text + '\n');
        }
    }

    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
}

module.exports = { ApiFetcher };
