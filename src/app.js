import express from 'express';
import http from 'http';
import triggerRoutes, {getQueueItems, getActiveRequests, getTotalRequests} from './routes/trigger.routes.js';
import {BrowserManager} from './core/browser/BrowserManager.js';
import {AppRegistryService} from "./AppRegistryService.js";
import {TunnelService} from "./TunnelService.js";
import os from 'os';
import {runtimeConfig} from "./config/config.js";
import {FacebookContextPool} from "./core/auth/FacebookContextPool.js";
import {nowIso} from "./utils/time.js";

const app = express();
const PORT = process.env.PORT || 3002;

const MAX_ACTIVE_REQUESTS = Number(process.env.MAX_ACTIVE_REQUESTS || 20);
const MAX_OVERLOAD_LOGS = 20;
let overloadLogCount = 0;
const RECOVERY_WAIT_TIMEOUT_MS = Number(process.env.RECOVERY_WAIT_TIMEOUT_MS || 10000);

let isRecovering = false;
let isHealthy = false;
let recoveryPromise = null;

// =========================
// Utils
// =========================
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function safeToError(value) {
    if (value instanceof Error) return value;
    try {
        return new Error(typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
        return new Error(String(value));
    }
}

async function waitForActiveRequestsToDrain(timeoutMs = RECOVERY_WAIT_TIMEOUT_MS) {
    const start = Date.now();
    while (getActiveRequests() > 0) {
        if (Date.now() - start >= timeoutMs) {
            logWarn('RECOVERY', `drain timeout, remaining=${getActiveRequests()}`);
            return false;
        }
        await sleep(200);
    }
    return true;
}

// =========================
// Log Utils
// =========================

function formatMsg(module, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${module}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function log(module, message, fields = {}) {
    const msg = formatMsg(module, message, fields);
    originalLog(msg);
    sendToUI('log', { type: 'info', msg });
}

function logWarn(module, message, fields = {}) {
    const msg = formatMsg(module, `⚠️ ${message}`, fields);
    sendToUI('log', { type: 'warn', msg });
}

function logError(module, message, fields = {}) {
    const msg = formatMsg(module, `❌ ${message}`, fields);
    sendToUI('log', { type: 'error', msg });
}

function logOk(module, message, fields = {}) {
    const msg = formatMsg(module, `✅ ${message}`, fields);
    originalLog(msg);
    sendToUI('log', { type: 'ok', msg });
}

// =========================
// Recovery
// =========================
async function recoverSystem(reason, error = null) {
    if (recoveryPromise) {
        logWarn('RECOVERY', `already in progress, skip`, { reason });
        return recoveryPromise;
    }

    recoveryPromise = (async () => {
        isRecovering = true;
        isHealthy = false;
        log('RECOVERY', `♻️ started`, { reason });
        if (error) logError('RECOVERY', 'cause', { error: error.message });

        try {
            await waitForActiveRequestsToDrain();

            if (typeof BrowserManager.reset === 'function') {
                await BrowserManager.reset();
            } else {
                await BrowserManager.closeAll();
                if (typeof BrowserManager.init === 'function') {
                    await BrowserManager.init();
                }
            }

            isHealthy = true;
            logOk('RECOVERY', 'completed');
        } catch (err) {
            logError('RECOVERY', 'failed', { error: err.message });
            isHealthy = false;
        } finally {
            isRecovering = false;
            recoveryPromise = null;
        }
    })();

    return recoveryPromise;
}

// =========================
// Middleware
// =========================
app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({extended: true, limit: '50mb'}));

app.use((req, res, next) => {
    if (!isHealthy || isRecovering) {
        return res.status(503).json({
            success: false,
            error: 'Server is recovering, please try again later'
        });
    }

    if (getActiveRequests() >= MAX_ACTIVE_REQUESTS) {
        if (overloadLogCount < MAX_OVERLOAD_LOGS) {
            overloadLogCount++;
            logWarn('MIDDLEWARE', `overload warning`, { active: getActiveRequests(), max: MAX_ACTIVE_REQUESTS, logCount: overloadLogCount });
        }
    }

    next();
});

// =========================
// Routes
// =========================
app.use('', triggerRoutes);

app.use((req, res) => {
    res.status(404).json({success: false, error: 'Route not found'});
});

app.use((err, req, res, next) => {
    logError('EXPRESS', `unhandled error`, { error: err.message });

    if (!res.headersSent) {
        res.status(500).json({
            success: false,
            error: err.message || 'Internal server error',
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }

    const message = (err?.message || '').toLowerCase();
    const shouldRecover =
        message.includes('target closed') ||
        message.includes('browser has been closed') ||
        message.includes('context closed') ||
        message.includes('page crashed') ||
        message.includes('protocol error');

    if (shouldRecover) {
        recoverSystem(`express error: ${err.message}`, err).catch();
    }
});

// =========================
// Server
// =========================
const server = http.createServer(app);

server.keepAliveTimeout = 5000;
server.headersTimeout = 10000;

async function registerWithRetry(publicUrl) {
    let attempt = 0;
    try {
        return await AppRegistryService.register(publicUrl);
    } catch (err) {
        attempt++;
        logError('REGISTRY', `register failed`, { attempt, error: err.message });
    }
}

async function bootstrap() {
    sendToUI('status', 'RUNNING');
    log('APP', `🚀 starting`, { port: PORT });
    log('APP', `config=${JSON.stringify(runtimeConfig)}`);

    try {
        if (typeof BrowserManager.init === 'function') {
            await BrowserManager.init();
        }
        logOk('BROWSER', 'initialized');

        await new Promise((resolve, reject) => {
            server.listen(PORT, (err) => {
                if (err) return reject(err);
                logOk('SERVER', `listening`, { port: PORT });
                resolve();
            });
        });

        // const publicUrl = await TunnelService.start(PORT);
        // log('TUNNEL', `started`, { url: publicUrl });
        //
        // await registerWithRetry(publicUrl);

        isHealthy = true;
        logOk('APP', '🎉 bootstrap complete');

    } catch (err) {
        logError('APP', 'bootstrap failed', { error: err.message });
        process.exit(1);
    }
}

// app.js
export async function resetTunnelServer() { // ← thêm async, sửa typo Server
    // const publicUrl = await TunnelService.start(PORT);
    // log('TUNNEL', `started`, { url: publicUrl });
    // await registerWithRetry(publicUrl);
}

// =========================
// Process handlers
// =========================

let isExiting = false;

async function gracefulExit(signal) {
    if (isExiting) return;
    isExiting = true;

    log('APP', `👋 shutting down`, { signal });

    isRecovering = true;
    isHealthy = false;

    const forceTimer = setTimeout(() => {
        logWarn('APP', 'force exit after 5s timeout');
        process.exit(1);
    }, 5000);
    forceTimer.unref();

    try {
        await TunnelService.stop();
        log('TUNNEL', 'stopped');

        await FacebookContextPool.closeAll(); // 🔥 đóng pool trước
        await BrowserManager.closeAll();      // 🔥 sau đó đóng browser
        log('BROWSER', 'closed');
    } catch (err) {
        logError('APP', `cleanup error on ${signal}`, { error: err.message });
    }

    server.close(() => {
        clearTimeout(forceTimer);
        logOk('SERVER', 'closed — bye!');
        process.exit(0);
    });

    sendToUI('status', 'STOPPED');
}

process.on('SIGINT',  () => gracefulExit('SIGINT'));
process.on('SIGTERM', () => gracefulExit('SIGTERM'));

process.on('unhandledRejection', (reason) => {
    const error = safeToError(reason);
    logError('PROCESS', 'unhandledRejection', { error: error.message });
    recoverSystem('unhandledRejection', error).catch();
});

process.on('uncaughtException', async (err) => {
    logError('PROCESS', 'uncaughtException', { error: err.message });
    await gracefulExit('uncaughtException');
});

// =========================
// IPC with Electron
// =========================

function sendToUI(type, data) {
    if (process.send) {
        process.send({ type, data });
    }
}

const originalLog = console.log;

process.on('message', async (msg) => {
    if (!msg) return;

    if (msg.type === 'CONFIG_UPDATE') {
        const { updateConfig } = await import('./config/config.js');
        const needRestart =
            msg.payload.host ||
            msg.payload.apiImportImage ||
            msg.payload.apiUpdatePage;

        updateConfig(msg.payload);
        logOk('CONFIG', 'updated from UI');

        if (needRestart) {
            log('CONFIG', '🔁 critical config changed — restarting');
            await gracefulExit('CONFIG_CHANGE');
            process.exit(0);
        }
    }

    if (msg.type === 'CONTROL') {
        if (msg.cmd === 'stop') {
            await gracefulExit('UI_STOP');
        }
        if (msg.cmd === 'restart') {
            await gracefulExit('UI_RESTART');
            process.exit(0);
        }
    }

    if (msg.type === 'SET_HEADLESS') {
        log('CONFIG', '🖥️ headless changed', {
            payload: msg.payload,
            activeContexts: BrowserManager.getActiveContextCount?.() ?? 'unknown'
        });
        await BrowserManager.setVisibility(msg.payload);
        log('CONFIG', '🖥️ setVisibility done');
    }

    if (msg.type === 'OPEN_PROFILE') {

        const { profilePath, type } = msg.payload;
        try {
            // Mở context (hoặc reuse nếu đã mở)
            const context = await BrowserManager.newContext(profilePath);

            // Lấy page đầu tiên hoặc tạo mới
            let page = context.pages()[0];
            if (!page || page.isClosed()) {
                page = await context.newPage();
            }
            const targetUrl =
                type === 'twitter'
                    ? 'https://x.com/'
                    : 'https://www.facebook.com/';

            await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

            process.send?.({ type: 'LOG', data: { type: 'ok', msg: `[PROFILES] ✅ Opened profile: ${profilePath}` } });

        } catch (err) {
            process.send?.({ type: 'LOG', data: { type: 'error', msg: `[PROFILES] ❌ Failed to open profile: ${err.message}` } });
        }
        return;
    }

    if (msg.type === 'CLOSE_PROFILE') {
        const { profilePath } = msg.payload;
        try {
            await BrowserManager.closeContext(profilePath);
            log('PROFILES', '✅ context closed before delete', { profilePath });
        } catch (err) {
            logWarn('PROFILES', 'close context error', { error: err.message });
        }
        return;
    }
});

// =========================
// Stats interval — chỉ gửi stats, KHÔNG gửi queue
// Queue được gửi realtime từ trigger.routes.js qua sendQueueToUI()
// =========================

let errorCount = 0;

export function reportError() {
    errorCount++;
    logError('STATS', `error reported`, { total: errorCount });
}

setInterval(() => {
    const cpuLoad = os.loadavg()[0] || 0;
    const memory = Math.round(process.memoryUsage().rss / 1024 / 1024);

    sendToUI('stats', {
        cpu: cpuLoad.toFixed(2),
        memory,
        requests: getTotalRequests(),
        error: errorCount
    });

    // ✅ Đồng bộ queue từ routes mỗi giây (backup, phòng khi realtime miss)
    sendToUI('queue', getQueueItems());

}, 1000);



bootstrap();