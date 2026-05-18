import localtunnel from 'localtunnel';
import { nowIso } from "./utils/time.js";

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
    sendToRenderer('error',
        formatMsg(id, `❌ ${msg}`, {
            error: err?.message || err
        })
    );
}

function logOk(id, msg, f = {}) {
    sendToRenderer('ok', formatMsg(id, `✅ ${msg}`, f));
}

export class TunnelService {

    static tunnel = null;
    static url = null;

    static async start(port) {

        const requestId = `${TAG}_${Date.now()}`;

        if (this.url) {
            log(requestId, 'Reuse tunnel', {
                url: this.url
            });

            return this.url;
        }

        try {

            log(requestId, 'Starting LocalTunnel', {
                port
            });

            const tunnel = await localtunnel({
                port
            });

            this.tunnel = tunnel;
            this.url = tunnel.url;

            logOk(requestId, 'Tunnel ready', {
                url: tunnel.url
            });

            tunnel.on('close', async () => {

                logWarn(requestId, 'Tunnel closed');

                this.url = null;
                this.tunnel = null;

                setTimeout(() => {
                    TunnelService.start(port)
                        .catch(err => {
                            logError(requestId, 'Reconnect failed', err);
                        });
                }, 3000);

            });

            return tunnel.url;

        } catch (err) {

            logError(requestId, 'Tunnel start failed', err);
            throw err;

        }
    }

    static async stop() {

        const requestId = `${TAG}_${Date.now()}`;

        if (this.tunnel) {

            await this.tunnel.close();

            this.tunnel = null;
            this.url = null;

            logWarn(requestId, 'Tunnel stopped manually');
        }
    }
}