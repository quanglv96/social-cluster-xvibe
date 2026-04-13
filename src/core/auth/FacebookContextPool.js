import { config, runtimeConfig } from '../../config/config.js';
import path from 'path';
import fs from 'fs';
import { FacebookAuth } from "./FacebookAuth.js";
import { BrowserManager, HEADLESS } from "../browser/BrowserManager.js";

// =========================
// Log Utils
// =========================
function nowIso() { return new Date().toISOString(); }

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({ type: 'LOG', data: { type, msg } });
}

function log(requestId, message, fields = {}) {
    sendToRenderer('info', formatMsg(requestId, message, fields));
}

function logWarn(requestId, message, fields = {}) {
    sendToRenderer('warn', formatMsg(requestId, `⚠️ ${message}`, fields));
}

function logError(requestId, message, err, fields = {}) {
    sendToRenderer('error', formatMsg(requestId, `❌ ${message}`, {
        ...fields,
        error: err?.message || err
    }));
}

function logOk(requestId, message, fields = {}) {
    sendToRenderer('ok', formatMsg(requestId, `✅ ${message}`, fields));
}

// =========================
const TAG = 'FB_POOL';

export class FacebookContextPool {

    static #pool  = new Map();
    static #locks = new Map();

    // =========================
    // PUBLIC: GET CONTEXT
    // =========================
    static async getContext(dto) {
        const key       = dto.user_name;
        const requestId = `${TAG}_${key}`;
        if (!key) throw new Error('username is required');

        const entry   = this.#pool.get(key);
        const expired = entry ? this.#isExpired(entry, requestId) : true;

        if (!entry || expired) {
            await this.#ensureInit(dto, requestId);
        }

        return this.#pool.get(key).context;
    }

    // =========================
    // PUBLIC: GET ROOT PAGE (reuse hoặc tạo mới)
    // =========================
    static async getRootPage(dto) {
        const key       = dto.user_name;
        const requestId = `${TAG}_${key}`;
        const context   = await this.getContext(dto);
        const entry     = this.#pool.get(key);

        if (!entry.rootPage || entry.rootPage.isClosed()) {
            log(requestId, 'Creating rootPage');
            entry.rootPage = await context.newPage();
            await entry.rootPage.goto(runtimeConfig.rootUrl, { waitUntil: 'domcontentloaded' });

            // 🔥 Page mới → apply visibility ngay (tránh nhảy lên màn hình)
            await BrowserManager.applyVisibilityToPage(entry.rootPage);
        } else {
            log(requestId, 'Reusing rootPage');
        }

        return entry.rootPage;
    }

    // =========================
    // PUBLIC: CREATE EVENT PAGE
    // =========================
    static async createEventPage(dto) {
        const key       = dto.user_name;
        const requestId = `${TAG}_${key}`;
        const context   = await this.getContext(dto);
        const entry     = this.#pool.get(key);

        if (!entry.eventPage || entry.eventPage.isClosed()) {
            entry.eventPage = await context.newPage();
            await entry.eventPage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });

            // 🔥 Page mới → apply visibility ngay
            await BrowserManager.applyVisibilityToPage(entry.eventPage);

            logOk(requestId, 'eventPage created');
        } else {
            log(requestId, 'eventPage reused');
        }

        return entry.eventPage;
    }

    // =========================
    // PUBLIC: CLOSE SINGLE
    // =========================
    static async closeContext(userName) {
        const requestId = `${TAG}_${userName}`;
        const entry     = this.#pool.get(userName);
        if (!entry) return;

        const safeKey    = userName.replace(/[^a-zA-Z0-9]/g, '_');
        const profileDir = path.resolve(runtimeConfig.facebookProfileDir, safeKey);

        // Dùng BrowserManager → tự xóa khỏi activeContexts
        await BrowserManager.closeContext(profileDir);

        this.#pool.delete(userName);
        logWarn(requestId, 'Context closed manually');
    }

    // =========================
    // PUBLIC: CLOSE ALL (gọi khi shutdown)
    // =========================
    static async closeAll() {
        for (const [userName] of this.#pool) {
            try { await this.closeContext(userName); } catch (_) {}
        }
        log(TAG, '✅ all contexts closed');
    }

    // =========================
    // PRIVATE: LOCK GUARD
    // =========================
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

    // =========================
    // PRIVATE: INIT CONTEXT
    // =========================
    static async #initContext(dto, requestId) {
        const key     = dto.user_name;
        const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_');

        log(requestId, 'Init context');

        const profileDir = path.resolve(runtimeConfig.facebookProfileDir, safeKey);
        if (!fs.existsSync(profileDir)) {
            fs.mkdirSync(profileDir, { recursive: true });
        }

        let context;

        try {
            // BrowserManager tự track vào activeContexts + apply visibility
            context = await BrowserManager.newContext(profileDir);

            context.on('close', () => {
                logWarn(requestId, 'Context closed unexpectedly');
                this.#pool.delete(key);
            });

            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
            });

            // --- Kiểm tra login ---
            const checkPage = await context.newPage();

            // 🔥 Apply visibility ngay trước khi navigate — tránh flash lên màn hình
            await BrowserManager.applyVisibilityToPage(checkPage);

            await checkPage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });

            const url       = checkPage.url();
            const cookies   = await context.cookies();
            const isLoggedIn =
                cookies.some(c => c.name === 'c_user') &&
                !url.includes('login') &&
                !url.includes('checkpoint');

            log(requestId, 'Login check', { url, isLoggedIn });

            if (!isLoggedIn) {
                logWarn(requestId, 'Not logged in → run auth');
                const auth = new FacebookAuth();
                // Auth có thể cần hiện browser — FacebookAuth tự xử lý nếu cần
                await auth.authenticate(context, dto);
            }

            // 🔥 Đóng checkPage sau khi done — rootPage/eventPage sẽ tạo sau theo nhu cầu
            await checkPage.close();

            // Đóng entry cũ nếu có (expired reinit)
            const old = this.#pool.get(key);
            if (old) {
                try { await old.context.close(); } catch (_) {}
            }

            const lifeHours = this.#random(5, 24);

            this.#pool.set(key, {
                context,
                createdAt: Date.now(),
                lifeHours,
                rootPage:  null,
                eventPage: null,
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

    // =========================
    // PRIVATE: HELPERS
    // =========================
    static #isExpired(entry, requestId) {
        const maxLife = entry.lifeHours * 3600_000;
        const expired = Date.now() - entry.createdAt > maxLife;
        if (expired) logWarn(requestId, 'Context expired → reinit');
        return expired;
    }

    static #random(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}