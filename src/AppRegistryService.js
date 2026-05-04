import { runtimeConfig } from "./config/config.js";
import {nowIso} from "./utils/time.js";

// =========================
// Log Utils
// =========================

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
// Class
// =========================

const TAG = 'APP_REGISTRY';

export class AppRegistryService {

    static async register(publicUrl) {

        const requestId = `${TAG}_${Date.now()}`;
        const url = runtimeConfig.api.apiRegisterSever;
        const startTime = Date.now();

        try {
            log(requestId, 'Registering app with backend', { url, publicUrl });

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: publicUrl
                })
            });

            if (!res.ok) {
                logWarn(requestId, 'Registry request failed', { status: res.status });
                throw new Error(`Registry failed: ${res.status}`);
            }

            const text = await res.text();

            logOk(requestId, 'Registered successfully', {
                response: text,
                duration: `${Date.now() - startTime}ms`
            });

            return text;

        } catch (err) {
            logError(requestId, 'Register app failed', err);
            throw err;
        }
    }
}