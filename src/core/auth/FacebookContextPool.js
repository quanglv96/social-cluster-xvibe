import { config, runtimeConfig } from '../../config/config.js';
import path from 'path';
import fs from 'fs';
import { FacebookAuth } from "./FacebookAuth.js";
import { chromium } from "playwright";

// =========================
// Log Utils (chuẩn hệ thống)
// =========================

function nowIso() {
    return new Date().toISOString();
}

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');

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

function logError(requestId, message, err, fields = {}) {
    const msg = formatMsg(requestId, `❌ ${message}`, {
        ...fields,
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

const TAG = 'FB_POOL';

export class FacebookContextPool {

    static #pool = new Map();
    static #locks = new Map();

    static async getContext(dto) {
        const key = dto.user_name;
        const requestId = `${TAG}_${key}`;

        if (!key) throw new Error('username is required');

        const entry = this.#pool.get(key);
        const expired = entry ? this.#isExpired(entry, requestId) : true;

        if (!entry || expired) {
            await this.#ensureInit(dto, requestId);
        }

        return this.#pool.get(key).context;
    }

    static async getRootPage(dto) {
        const key = dto.user_name;
        const requestId = `${TAG}_${key}`;

        const context = await this.getContext(dto);
        const entry = this.#pool.get(key);

        if (!entry.rootPage || entry.rootPage.isClosed()) {
            log(requestId, 'Creating rootPage');

            entry.rootPage = await context.newPage();
            await entry.rootPage.goto(runtimeConfig.rootUrl, {
                waitUntil: 'domcontentloaded'
            });

        } else {
            log(requestId, 'Reusing rootPage');
        }

        return entry.rootPage;
    }

    static async createEventPage(dto) {
        const key = dto.user_name;
        const requestId = `${TAG}_${key}`;

        const context = await this.getContext(dto);
        const entry = this.#pool.get(key);

        if (!entry.eventPage || entry.eventPage.isClosed()) {
            entry.eventPage = await context.newPage();
            await entry.eventPage.goto('https://www.facebook.com/', {
                waitUntil: 'domcontentloaded'
            });

            logOk(requestId, 'eventPage created');

        } else {
            log(requestId, 'eventPage reused');
        }

        return entry.eventPage;
    }

    static async closeContext(userName) {
        const requestId = `${TAG}_${userName}`;
        const entry = this.#pool.get(userName);
        if (!entry) return;

        await entry.context.close();
        this.#pool.delete(userName);

        logWarn(requestId, 'Context closed manually');
    }

    static async #ensureInit(dto, requestId) {
        const key = dto.user_name;

        if (this.#locks.has(key)) {
            log(requestId, 'Waiting for existing init lock');
            return this.#locks.get(key);
        }

        const promise = this.#initContext(dto, requestId);
        this.#locks.set(key, promise);

        try {
            await promise;
        } finally {
            this.#locks.delete(key);
        }
    }

    static async #initContext(dto, requestId) {
        const key = dto.user_name;
        const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_');

        log(requestId, 'Init context');

        const profileDir = path.resolve(runtimeConfig.facebookProfileDir, safeKey);

        if (!fs.existsSync(profileDir)) {
            fs.mkdirSync(profileDir, { recursive: true });
        }

        let context;

        try {
            context = await chromium.launchPersistentContext(profileDir, {
                headless: false,
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox'
                ],
                viewport: { width: 1366, height: 768 }
            });

            context.on('close', () => {
                logWarn(requestId, 'Context closed unexpectedly');
                this.#pool.delete(key);
            });

            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => false
                });
            });

            const page = await context.newPage();

            await page.goto('https://www.facebook.com/', {
                waitUntil: 'domcontentloaded'
            });

            const url = page.url();
            const cookies = await context.cookies();

            const isLoggedIn =
                cookies.some(c => c.name === 'c_user') &&
                !url.includes('login') &&
                !url.includes('checkpoint');

            log(requestId, 'Login check', { url, isLoggedIn });

            if (!isLoggedIn) {
                logWarn(requestId, 'Not logged in → run auth');
                const auth = new FacebookAuth();
                await auth.authenticate(context, dto);
            }

            await page.close();

            const old = this.#pool.get(key);
            if (old) {
                try { await old.context.close(); } catch (_) {}
            }

            const lifeHours = this.#random(5, 24);

            this.#pool.set(key, {
                context,
                createdAt: Date.now(),
                lifeHours,
                rootPage: null
            });

            logOk(requestId, 'Context ready', { lifeHours });

        } catch (err) {
            logError(requestId, 'Init context failed', err);
            if (context) {
                try { await context.close(); } catch (_) {}
            }
            throw err;
        }
    }

    static #isExpired(entry, requestId) {
        const maxLife = entry.lifeHours * 3600_000;
        const expired = Date.now() - entry.createdAt > maxLife;

        if (expired) {
            logWarn(requestId, 'Context expired → reinit');
        }

        return expired;
    }

    static #random(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}