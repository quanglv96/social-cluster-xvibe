import axios from 'axios';
import { config, runtimeConfig } from "../config/config.js";

// =========================
// Log Utils
// =========================

function nowIso() {
    return new Date().toISOString();
}

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({ type: 'LOG', data: { type, msg } });
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
// Function
// =========================

const TAG = 'CHECKPOINT';

export async function logCheckpoint(page, {
    step = 'unknown',
    message = 'success',
} = {}) {

    const requestId = `${TAG}_${Date.now()}`;
    const startTime = Date.now();

    try {

        log(requestId, 'Capture checkpoint', { step });

        let base64 = null;

        const buffer = await page.screenshot({
            fullPage: false,
            type: 'jpeg',
            quality: 60
        });

        base64 = buffer.toString('base64');

        const payload = {
            step,
            message,
            url: page.url(),
            title: await page.title().catch(() => ''),
            timestamp: Date.now(),
            metadata: base64
        };

        log(requestId, 'Sending checkpoint', {
            step,
            url: payload.url
        });

        await axios.post(runtimeConfig.api.apiLogCheckPoint, payload, {
            timeout: 10000
        });

        logOk(requestId, 'Checkpoint sent', {
            step,
            duration: `${Date.now() - startTime}ms`
        });

    } catch (err) {
        logError(requestId, 'Checkpoint failed', err);
    }
}