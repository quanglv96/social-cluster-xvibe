import { spawn } from 'child_process';
import {nowIso} from "./utils/time.js";

const TAG = 'TUNNEL';


function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({ type: 'LOG', data: { type, msg } });
}

function log(id, msg, f = {}) { sendToRenderer('info', formatMsg(id, msg, f)); }
function logWarn(id, msg, f = {}) { sendToRenderer('warn', formatMsg(id, `⚠️ ${msg}`, f)); }
function logError(id, msg, err) {
    sendToRenderer('error', formatMsg(id, `❌ ${msg}`, { error: err?.message || err }));
}
function logOk(id, msg, f = {}) { sendToRenderer('ok', formatMsg(id, `✅ ${msg}`, f)); }

export class TunnelService {
    static process = null;
    static url = null;

    static async start(port) {
        const requestId = `${TAG}_${Date.now()}`;

        if (this.url) {
            log(requestId, 'Reuse tunnel', { url: this.url });
            return this.url;
        }

        log(requestId, 'Starting SSH tunnel (serveo)', { port });

        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            let resolved = false;

            const proc = spawn('ssh', [
                '-o', 'StrictHostKeyChecking=no',
                '-o', 'ServerAliveInterval=30',
                '-o', 'ServerAliveCountMax=3',
                '-o', 'ExitOnForwardFailure=yes',
                '-R', `80:localhost:${port}`,
                'serveo.net'
            ], { stdio: ['ignore', 'pipe', 'pipe'] });

            this.process = proc;

            const timer = setTimeout(() => {
                if (!resolved) {
                    proc.kill();
                    logError(requestId, 'Tunnel timeout after 30s');
                    reject(new Error('Tunnel timeout sau 30s'));
                }
            }, 30000);

            const handleOutput = (data) => {
                const text = data.toString();

                text.split('\n')
                    .map(l => l.trim())
                    .filter(Boolean)
                    .forEach(l => log(requestId, '[serveo]', { msg: l }));

                /**
                 * Serveo có nhiều format output:
                 * - Forwarding HTTP traffic from http://xxx
                 * - https://xxx
                 * => chỉ cần lấy domain
                 */
                const domainMatch = text.match(/([a-z0-9\-]+\.serveousercontent\.com)/);

                if (domainMatch && !resolved) {
                    resolved = true;
                    clearTimeout(timer);

                    const domain = domainMatch[1];

                    // 🔥 ép dùng HTTP để tránh SSL lỗi
                    this.url = `http://${domain}`;

                    logOk(requestId, 'Tunnel ready', {
                        url: this.url,
                        duration: `${Date.now() - startTime}ms`
                    });

                    resolve(this.url);
                }
            };

            proc.stdout.on('data', handleOutput);
            proc.stderr.on('data', handleOutput);

            proc.on('error', (err) => {
                clearTimeout(timer);
                if (err.code === 'ENOENT') {
                    logError(requestId, 'SSH not found', err);
                    reject(new Error('Thiếu SSH (openssh-client)'));
                } else {
                    logError(requestId, 'Tunnel process error', err);
                    reject(err);
                }
            });

            proc.on('close', (code) => {
                clearTimeout(timer);

                logWarn(requestId, 'Tunnel closed', { code });

                this.url = null;
                this.process = null;

                if (code !== 0) {
                    logWarn(requestId, 'Reconnecting tunnel...');
                    setTimeout(() => TunnelService.start(port), 3000);
                }
            });
        });
    }

    static stop() {
        const requestId = `${TAG}_${Date.now()}`;

        if (this.process) {
            this.process.kill();
            this.process = null;
            this.url = null;
            logWarn(requestId, 'Tunnel stopped manually');
        }
    }
}