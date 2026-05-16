const { spawn } = require('child_process');
const { resolvePython } = require('./python-resolver');
const path = require('path');
const fs = require('fs');
const os = require('os');

class BotPluginWrapper {
    constructor() {
        this.process = null;
        this.isRunning = false;
        this.eventHandlers = new Map();
    }

    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }

    emit(event, data) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error in ${event} handler:`, error);
                }
            });
        }
    }

    async start(config) {
        if (this.isRunning) {
            throw new Error('Bot plugin is already running');
        }

        const python = resolvePython();
        if (!python) {
            throw new Error('Python not found');
        }

        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        const venvDir = path.join(localAppData, 'TelegramGroupMessenger', 'venv');
        const venvPython = path.join(venvDir, 'Scripts', 'python.exe');

        const scriptPath = path.join(__dirname, 'bot_plugin.py');

        if (!fs.existsSync(scriptPath)) {
            throw new Error('bot_plugin.py not found');
        }

        return new Promise((resolve, reject) => {
            const args = [
                ...python.argsPrefix,
                scriptPath,
                JSON.stringify(config)
            ];

            this.process = spawn(venvPython, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true
            });

            this.isRunning = true;

            this.process.stdout.on('data', (data) => {
                const lines = data.toString().split('\n').filter(line => line.trim());
                lines.forEach(line => {
                    try {
                        const message = JSON.parse(line);
                        this.emit(message.type, message.data);
                    } catch (error) {
                        // Ignore non-JSON output
                    }
                });
            });

            this.process.stderr.on('data', (data) => {
                this.emit('error', { message: data.toString() });
            });

            this.process.on('close', (code) => {
                this.isRunning = false;
                this.process = null;
                this.emit('stopped', { code });
            });

            this.process.on('error', (error) => {
                this.isRunning = false;
                this.process = null;
                this.emit('error', { message: error.message });
                reject(error);
            });

            // Wait a moment for initialization
            setTimeout(() => {
                if (this.isRunning) {
                    resolve();
                } else {
                    reject(new Error('Failed to start bot plugin'));
                }
            }, 1000);
        });
    }

    stop() {
        if (this.process && this.isRunning) {
            this.process.kill();
            this.isRunning = false;
            this.process = null;
        }
    }

    addBot(botNumber) {
        if (!this.isRunning || !this.process) {
            throw new Error('Bot plugin is not running');
        }

        // Send command to add new bot
        this.process.stdin.write(JSON.stringify({
            action: 'add_bot',
            bot_number: botNumber
        }) + '\n');
    }

    sendCode(code) {
        if (!this.isRunning || !this.process) {
            throw new Error('Bot plugin is not running');
        }

        this.process.stdin.write(JSON.stringify({
            action: 'send_code',
            code: code
        }) + '\n');
    }

    sendPassword(password) {
        if (!this.isRunning || !this.process) {
            throw new Error('Bot plugin is not running');
        }

        this.process.stdin.write(JSON.stringify({
            action: 'send_password',
            password: password
        }) + '\n');
    }
}

module.exports = { BotPluginWrapper };
