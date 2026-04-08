import { BrowserManager } from '../browser/BrowserManager.js';
import { FacebookAuth } from '../../auth/FacebookAuth.js';
import { config } from '../../config/config.js';

/**
 * Pool context theo từng Facebook account (key = type).
 * Mỗi account có 1 context riêng, tái sử dụng trong lifeHours ngẫu nhiên.
 */
export class FacebookContextPool {

    // Map<type, { context, createdAt, lifeHours, rootPage }>
    static #pool = new Map();
    static #locks = new Map(); // chống race condition khi init

    // ─────────────────────────────────────────
    // PUBLIC
    // ─────────────────────────────────────────

    static async getContext(dto) {
        const key = dto.type;

        if (!key) throw new Error('[FacebookContextPool] dto.type is required');

        const entry = this.#pool.get(key);
        const expired = entry ? this.#isExpired(entry) : true;

        if (!entry || expired) {
            await this.#ensureInit(dto);
        }

        return this.#pool.get(key).context;
    }

    static async getRootPage(dto) {
        const context = await this.getContext(dto);
        const key = dto.type;
        const entry = this.#pool.get(key);

        if (!entry.rootPage || entry.rootPage.isClosed()) {
            entry.rootPage = await context.newPage();
            await entry.rootPage.goto(config.rootUrl, {
                waitUntil: 'domcontentloaded'
            });
        }

        return entry.rootPage;
    }

    static async createEventPage(dto) {
        const context = await this.getContext(dto);
        return await context.newPage();
    }

    static async closeContext(type) {
        const entry = this.#pool.get(type);
        if (!entry) return;

        try {
            await entry.context.close();
        } catch (e) {
            console.warn(`[FacebookContextPool] close error [${type}]:`, e.message);
        }

        this.#pool.delete(type);
        console.log(`[FacebookContextPool] Context closed and removed [${type}]`);
    }

    static poolStatus() {
        const result = {};
        for (const [key, entry] of this.#pool.entries()) {
            result[key] = {
                createdAt: new Date(entry.createdAt).toISOString(),
                lifeHours: entry.lifeHours,
                expiredIn: Math.round(
                    (entry.createdAt + entry.lifeHours * 3600_000 - Date.now()) / 60_000
                ) + 'min'
            };
        }
        return result;
    }

    // ─────────────────────────────────────────
    // PRIVATE
    // ─────────────────────────────────────────

    static async #ensureInit(dto) {
        const key = dto.type;

        // Chống race condition: nếu đang init thì chờ
        if (this.#locks.has(key)) {
            return this.#locks.get(key);
        }

        const promise = this.#initContext(dto);
        this.#locks.set(key, promise);

        try {
            await promise;
        } finally {
            this.#locks.delete(key);
        }
    }

    static async #initContext(dto) {
        const key = dto.type;

        console.log(`[FacebookContextPool] Initializing context [${key}]...`);

        // Đóng context cũ nếu có
        const old = this.#pool.get(key);
        if (old) {
            try { await old.context.close(); } catch (_) {}
        }

        const browser = await BrowserManager.getBrowser();

        // Rotate fingerprint nhẹ để tránh detect
        const context = await browser.newContext({
            viewport: this.#randomViewport(),
            userAgent: this.#randomUserAgent(),
            locale: 'en-US',
            timezoneId: 'Asia/Ho_Chi_Minh',
        });

        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        // Authenticate ngay khi tạo context
        const auth = new FacebookAuth();
        await auth.authenticate(context, dto);

        const lifeHours = this.#random(5, 24);

        this.#pool.set(key, {
            context,
            createdAt: Date.now(),
            lifeHours,
            rootPage: null
        });

        console.log(
            `[FacebookContextPool] Context ready [${key}] lifetime=${lifeHours}h`
        );
    }

    static #isExpired(entry) {
        const maxLife = entry.lifeHours * 3600_000;
        const expired = Date.now() - entry.createdAt > maxLife;
        if (expired) console.log('[FacebookContextPool] Context expired, reinit...');
        return expired;
    }

    static #random(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    static #randomViewport() {
        const sizes = [
            { width: 1366, height: 768 },
            { width: 1440, height: 900 },
            { width: 1536, height: 864 },
            { width: 1920, height: 1080 },
        ];
        return sizes[Math.floor(Math.random() * sizes.length)];
    }

    static #randomUserAgent() {
        const agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
        ];
        return agents[Math.floor(Math.random() * agents.length)];
    }
}