// core/browser/BrowserManager.js

import { chromium } from 'playwright';

// =========================
// Log Utils
// =========================

function nowIso() {
    return new Date().toISOString();
}

function formatMsg(module, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${module}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({ type: 'LOG', data: { type, msg } });
}

function log(module, message, fields = {}) {
    const msg = formatMsg(module, message, fields);
    sendToRenderer('info', msg);
}

function logWarn(module, message, fields = {}) {
    const msg = formatMsg(module, `⚠️ ${message}`, fields);
    sendToRenderer('warn', msg);
}

function logError(module, message, fields = {}) {
    const msg = formatMsg(module, `❌ ${message}`, fields);
    sendToRenderer('error', msg);
}

function logOk(module, message, fields = {}) {
    const msg = formatMsg(module, `✅ ${message}`, fields);
    sendToRenderer('ok', msg);
}

// =========================

let browser = null;
let launching = null;

export class BrowserManager {

    // =========================
    // GET BROWSER (safe)
    // =========================
    static async getBrowser() {
        if (browser && browser.isConnected()) {
            return browser;
        }

        if (launching) {
            return launching;
        }

        launching = this.#launchBrowser();
        browser = await launching;
        launching = null;

        return browser;
    }

    static async #launchBrowser() {
        log('BROWSER', '🚀 launching root browser');

        const instance = await chromium.launch({
            headless: false,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
            ]
        });

        instance.on('disconnected', () => {
            logWarn('BROWSER', 'root browser disconnected');
            browser = null;
        });

        logOk('BROWSER', 'root browser launched');
        return instance;
    }

    // =========================
    // CLOSE ALL
    // =========================
    static async closeAll() {
        if (!browser) return;

        try {
            if (browser.isConnected()) {
                await browser.close();
                logOk('BROWSER', 'closed');
            }
        } catch (err) {
            logError('BROWSER', 'error closing browser', { error: err.message });
        } finally {
            browser = null;
            launching = null;
        }
    }

    static async newContext(profilePath) {
        if (!profilePath) {
            throw new Error('[BrowserManager] profilePath is required');
        }

        log('BROWSER', '🚀 launching profile context', { profile: profilePath });

        const context = await chromium.launchPersistentContext(profilePath, {
            headless: false,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
            ],
            viewport: { width: 1366, height: 768 },
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            locale: 'en-US',
            timezoneId: 'Asia/Ho_Chi_Minh',
        });

        context.on('close', () => {
            logWarn('BROWSER', 'profile context closed', { profile: profilePath });
        });

        logOk('BROWSER', 'profile context ready', { profile: profilePath });
        return context;
    }
}