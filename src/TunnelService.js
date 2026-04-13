import {spawn} from 'child_process';

// =========================
// Log Utils (giống class trước)
// =========================

function nowIso() {
    return new Date().toISOString();
}

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({type: 'LOG', data: {type, msg}});
}

function log(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, message, fields);
    sendToRenderer('info', msg);
}

function logWarn(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, `⚠️ ${message}`, fields);
    sendToRenderer('warn', msg);
}

function logError(requestId, message, err) {
    const msg = formatMsg(requestId, `❌ ${message}`, {
        error: err?.message || err
    });
    sendToRenderer('error', msg);
}

function logOk(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, `✅ ${message}`, fields);
    sendToRenderer('ok', msg);
}

// =========================
// Class
// =========================

const TAG = 'TUNNEL';

export class TunnelService {

    static process = null;
    static url = null;

    static async start(port) {
        const requestId = `${TAG}_${Date.now()}`;

        if (this.url) {
            log(requestId, 'Reuse tunnel', {url: this.url});
            return this.url;
        }

        log(requestId, 'Starting SSH tunnel (serveo)', {port});

        return new Promise((resolve, reject) => {

            const startTime = Date.now();

            const proc = spawn('ssh', [
                '-o', 'StrictHostKeyChecking=no',
                '-o', 'ServerAliveInterval=30',
                '-o', 'ServerAliveCountMax=3',
                '-o', 'ExitOnForwardFailure=yes',
                '-R', `80:localhost:${port}`,
                'serveo.net'
            ], {stdio: ['ignore', 'pipe', 'pipe']});

            this.process = proc;

            const timer = setTimeout(() => {
                proc.kill();
                logError(requestId, 'Tunnel timeout after 30s');
                reject(new Error('Tunnel timeout sau 30s — kiểm tra SSH có sẵn không'));
            }, 30000);

            const onData = (data) => {
                const text = data.toString();

                text.split('\n')
                    .map(l => l.trim())
                    .filter(Boolean)
                    .forEach(l => log(requestId, '[serveo]', {msg: l}));

                const match = text.match(/https:\/\/[a-z0-9\-]+\.serveousercontent\.com/);
                if (match) {
                    clearTimeout(timer);
                    this.url = match[0];

                    logOk(requestId, 'Tunnel ready', {
                        url: this.url,
                        duration: `${Date.now() - startTime}ms`
                    });

                    resolve(this.url);
                }
            };

            proc.stdout.on('data', onData);
            proc.stderr.on('data', onData);

            proc.on('error', (err) => {
                clearTimeout(timer);
                if (err.code === 'ENOENT') {
                    logError(requestId, 'SSH not found', err);
                    reject(new Error('ssh không tìm thấy — cài openssh-client trước'));
                } else {
                    logError(requestId, 'Tunnel process error', err);
                    reject(err);
                }
            });

            proc.on('close', (code) => {
                clearTimeout(timer);

                logWarn(requestId, 'Tunnel closed', {code});

                this.url = null;
                this.process = null;

                if (code !== 0) {
                    logWarn(requestId, 'Reconnecting tunnel...');
                    setTimeout(() => TunnelService.start(port), 3000);
                }
            });
        });
    }

    static async stop() {
        const requestId = `${TAG}_${Date.now()}`;

        if (this.process) {
            this.process.kill();
            this.process = null;
            this.url = null;
            logWarn(requestId, 'Tunnel stopped manually');
        }
    }
}