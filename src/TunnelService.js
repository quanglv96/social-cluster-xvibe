import { spawn } from 'child_process';
import path from 'path';
import { nowIso } from "./utils/time.js";
import { ensureCloudflared } from "./ensureCloudflared.js";

const TAG = 'TUNNEL';

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');

    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({ type: 'LOG', data: { type, msg } });
}

function log(id, msg, f = {}) {
    sendToRenderer('info', formatMsg(id, msg, f));
}

function logWarn(id, msg, f = {}) {
    sendToRenderer('warn', formatMsg(id, `⚠️ ${msg}`, f));
}

function logError(id, msg, err) {
    sendToRenderer(
        'error',
        formatMsg(id, `❌ ${msg}`, {
            error: err?.message || err
        })
    );
}

function logOk(id, msg, f = {}) {
    sendToRenderer('ok', formatMsg(id, `✅ ${msg}`, f));
}

export class TunnelService {

    static process = null;
    static url = 'https://tunnel-social.xvibe.me';

    static async start() {

        const requestId = `${TAG}_${Date.now()}`;

        if (this.process) {

            log(requestId, 'Reuse tunnel', {
                url: this.url
            });

            return this.url;
        }

        try {

            // =========================
            // PATHS
            // =========================

            const basePath = path.join(process.cwd(), 'src', 'resources');

            const cloudflareExe = path.join(
                basePath,
                'bin',
                'cloudflared.exe'
            );

            const configPath = path.join(
                basePath,
                'cloudflare',
                'config.yml'
            );

            // ensure binary exists
            await ensureCloudflared(cloudflareExe);

            log(requestId, 'Starting Cloudflare Tunnel', {
                config: configPath
            });

            // =========================
            // SPAWN
            // =========================

            const proc = spawn(
                cloudflareExe,
                [
                    'tunnel',
                    '--config',
                    configPath,
                    'run'
                ],
                {
                    windowsHide: true,
                    stdio: ['ignore', 'pipe', 'pipe']
                }
            );

            this.process = proc;

            let connected = false;

            const handleOutput = (data) => {

                const text = data.toString();

                text.split('\n')
                    .map(v => v.trim())
                    .filter(Boolean)
                    .forEach(v => {

                        log(requestId, '[cloudflared]', { msg: v });

                        if (
                            v.includes('Registered tunnel connection')
                            && !connected
                        ) {
                            connected = true;

                            logOk(requestId, 'Tunnel ready', {
                                url: this.url
                            });
                        }

                    });

            };

            proc.stdout.on('data', handleOutput);
            proc.stderr.on('data', handleOutput);

            proc.on('error', (err) => {

                logError(requestId, 'Tunnel process error', err);
                this.process = null;

            });

            proc.on('close', (code) => {

                logWarn(requestId, 'Tunnel closed', { code });

                this.process = null;

                setTimeout(() => {

                    TunnelService.start().catch(err => {

                        logError(requestId, 'Reconnect failed', err);

                    });

                }, 5000);

            });

            return this.url;

        } catch (err) {

            logError(requestId, 'Tunnel start failed', err);
            throw err;

        }
    }

    static async stop() {

        const requestId = `${TAG}_${Date.now()}`;

        if (this.process) {

            this.process.kill();
            this.process = null;

            logWarn(requestId, 'Tunnel stopped manually');
        }
    }
}