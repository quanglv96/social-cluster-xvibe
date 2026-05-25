import { spawn } from 'child_process';
import path from 'path';
import { nowIso } from "./utils/time.js";
import { ensureCloudflared } from "./ensureCloudflared.js";
import fs from "fs";
import electron from 'electron';

const { app } = electron;
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

        // const requestId = `${TAG}_${Date.now()}`;
        //
        // try {
        //
        //     log(requestId, 'ENTER start', {
        //         basePath,
        //         resourcesPath: process.resourcesPath,
        //         isPackaged: app.isPackaged
        //     });
        //
        //     const resourceBase = app.isPackaged
        //         ? process.resourcesPath
        //         : path.join(process.cwd(), 'src', 'resources');
        //
        //     const cloudflareExe = path.join(
        //         resourceBase,
        //         'bin',
        //         'cloudflared.exe'
        //     );
        //
        //     const configPath = path.join(
        //         resourceBase,
        //         'cloudflare',
        //         'config.yml'
        //     );
        //
        //     const tunnelJsonPath = path.join(
        //         resourceBase,
        //         'cloudflare',
        //         'tunnel.json'
        //     );
        //
        //     log(requestId, 'Resolved paths', {
        //         exe: cloudflareExe,
        //         config: configPath,
        //         tunnel: tunnelJsonPath
        //     });
        //
        //     if (!fs.existsSync(cloudflareExe)) {
        //         throw new Error(`cloudflared.exe missing`);
        //     }
        //
        //     if (!fs.existsSync(configPath)) {
        //         throw new Error(`config.yml missing`);
        //     }
        //
        //     if (!fs.existsSync(tunnelJsonPath)) {
        //         throw new Error(`tunnel.json missing`);
        //     }
        //
        //     const proc = spawn(
        //         cloudflareExe,
        //         [
        //             'tunnel',
        //             '--config',
        //             configPath,
        //             '--cred-file',
        //             tunnelJsonPath,
        //             'run'
        //         ],
        //         {
        //             windowsHide: true,
        //             stdio: ['ignore', 'pipe', 'pipe']
        //         }
        //     );
        //
        //     this.process = proc;
        //
        //     log(requestId, 'Tunnel spawned', {
        //         pid: proc.pid
        //     });
        //
        //     proc.stdout.on('data', (d) => {
        //         log(requestId, '[stdout]', {
        //             msg: d.toString()
        //         });
        //     });
        //
        //     proc.stderr.on('data', (d) => {
        //         log(requestId, '[stderr]', {
        //             msg: d.toString()
        //         });
        //     });
        //
        //     proc.on('error', (err) => {
        //         logError(requestId, 'spawn error', err);
        //     });
        //
        //     proc.on('close', (code) => {
        //         logWarn(requestId, 'process closed', {
        //             code
        //         });
        //
        //         this.process = null;
        //     });
        //
        // } catch (err) {
        //
        //     logError(requestId, 'failed to start', err);
        //
        //     throw err;
        // }
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

        const isDev = !app.isPackaged;

        const srcBase = isDev
            ? path.join(process.cwd(), 'src', 'resources')
            : process.resourcesPath;

        // =========================
        // CONFIG
        // =========================

        const configSrc = path.join(
            srcBase,
            'cloudflare',
            'config.yml'
        );

        const configDest = path.join(
            basePath,
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
            basePath,
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