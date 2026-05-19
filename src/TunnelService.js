import { spawn } from 'child_process';
import path from 'path';
import { nowIso } from "./utils/time.js";
import { ensureCloudflared } from "./ensureCloudflared.js";
import fs from "fs";

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
    sendToRenderer('error', formatMsg(id, `❌ ${msg}`, {
        error: err?.message || err
    }));
}

function logOk(id, msg, f = {}) {
    sendToRenderer('ok', formatMsg(id, `✅ ${msg}`, f));
}

export class TunnelService {

    static process = null;
    static url = 'https://tunnel-social.xvibe.me';

    static async start(basePath) {
        this.ensureResources(basePath);
        console.log('🔥 ENTER TunnelService.start', basePath);
        log('TUNNEL', 'ENTER start', { basePath });
        const requestId = `${TAG}_${Date.now()}`;

        if (this.process) {
            log(requestId, 'Reuse existing tunnel', {
                url: this.url
            });
            return this.url;
        }

        try {

            // =========================
            // PATHS
            // =========================
            const cloudflareExe = path.join(basePath, 'bin', 'cloudflared.exe');
            const configPath = path.join(basePath, 'cloudflare', 'config.yml');
            if (!fs.existsSync(cloudflareExe)) {
                throw new Error(`cloudflared not found: ${cloudflareExe}`);
            }

            if (!fs.existsSync(configPath)) {
                throw new Error(`config not found: ${configPath}`);
            }
            await ensureCloudflared(cloudflareExe);

            log(requestId, 'Starting Cloudflare Tunnel', {
                config: configPath
            });

            // =========================
            // SPAWN PROCESS
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

            log(requestId, 'Tunnel process spawned', {
                pid: proc.pid
            });

            log(requestId, 'Tunnel initializing...');

            let connected = false;

            const handleOutput = (data) => {

                const text = data.toString();

                text.split('\n')
                    .map(v => v.trim())
                    .filter(Boolean)
                    .forEach(v => {

                        log(requestId, '[cloudflared]', { msg: v });

                        // =========================
                        // extract tunnel url
                        // =========================
                        const match = v.match(/https:\/\/[a-zA-Z0-9.-]+/);

                        if (match && !this.url) {
                            this.url = match[0];

                            logOk(requestId, 'Tunnel URL detected', {
                                url: this.url
                            });
                        }

                        // =========================
                        // connection ready
                        // =========================
                        if (v.includes('Registered tunnel connection') && !connected) {

                            connected = true;

                            logOk(requestId, 'Tunnel fully connected', {
                                url: this.url,
                                status: 'READY'
                            });
                        }

                    });

            };

            proc.stdout.on('data', handleOutput);
            proc.stderr.on('data', handleOutput);

            proc.on('error', (err) => {

                logError(requestId, 'Tunnel process error', err);

                this.process = null;
                this.url = null;
            });

            proc.on('close', (code) => {

                logWarn(requestId, 'Tunnel closed', { code });

                this.process = null;
                this.url = null;

                // =========================
                // SAFE RECONNECT (no duplicate)
                // =========================
                setTimeout(() => {

                    if (!this.process) {
                        TunnelService.start(basePath).catch(err => {
                            logError(requestId, 'Reconnect failed', err);
                        });
                    }

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
            this.url = null;

            logWarn(requestId, 'Tunnel stopped manually');
        }
    }

    static ensureResources(basePath) {

        const isDev = !process.mainModule.filename.includes('app.asar');

        const srcBase = isDev
            ? path.join(process.cwd(), 'src', 'resources')
            : process.resourcesPath;

        const destBase = basePath;

        // =========================
        // CONFIG
        // =========================

        const configSrc = path.join(
            srcBase,
            'cloudflare',
            'config.yml'
        );

        const configDest = path.join(
            destBase,
            'cloudflare',
            'config.yml'
        );

        if (!fs.existsSync(configDest)) {

            fs.mkdirSync(
                path.dirname(configDest),
                { recursive: true }
            );

            fs.copyFileSync(configSrc, configDest);
        }

        // =========================
        // TUNNEL JSON
        // =========================

        const tunnelSrc = path.join(
            srcBase,
            'cloudflare',
            'tunnel.json'
        );

        const tunnelDest = path.join(
            destBase,
            'cloudflare',
            'tunnel.json'
        );

        if (!fs.existsSync(tunnelDest)) {

            fs.mkdirSync(
                path.dirname(tunnelDest),
                { recursive: true }
            );

            fs.copyFileSync(tunnelSrc, tunnelDest);
        }
    }
}