import {config, runtimeConfig} from '../../config/config.js';
import path from 'path';
import fs from 'fs';
import {FacebookAuth} from "./FacebookAuth.js";
import {chromium} from "playwright";
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
        const key = dto.user_name; // 👈 đúng

        if (!key) throw new Error('username is required');

        const entry = this.#pool.get(key);
        const expired = entry ? this.#isExpired(entry) : true;

        if (!entry || expired) {
            await this.#ensureInit(dto);
        }

        return this.#pool.get(key).context;
    }

    static async getRootPage(dto) {
        const context = await this.getContext(dto);
        const key = dto.user_name;

        const entry = this.#pool.get(key);

        if (!entry.rootPage || entry.rootPage.isClosed()) {
            entry.rootPage = await context.newPage();
            await entry.rootPage.goto(runtimeConfig.rootUrl, {
                waitUntil: 'domcontentloaded'
            });
        }

        return entry.rootPage;
    }

    static async createEventPage(dto) {
        const key = dto.user_name;
        const context = await this.getContext(dto);

        const entry = this.#pool.get(key);

        if (!entry.eventPage || entry.eventPage.isClosed()) {
            entry.eventPage = await context.newPage();

            await entry.eventPage.goto('https://www.facebook.com/', {
                waitUntil: 'domcontentloaded'
            });

            console.log(`[FB POOL] New eventPage created user=${key}`);
        } else {
            console.log(`[FB POOL] Reuse eventPage user=${key}`);
        }

        return entry.eventPage;
    }

    static async closeContext(userName) {
        const entry = this.#pool.get(userName);
        if (!entry) return;

        await entry.context.close();
        this.#pool.delete(userName);
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
        const key = dto.user_name;

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
        const key = dto.user_name;
        const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_');

        console.log(`[FacebookContextPool] Init user=${key}`);

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
                console.warn(`[FB CONTEXT CLOSED] ${key}`);
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

            console.log('[FB CHECK]', { url, isLoggedIn });

            if (!isLoggedIn) {
                const auth = new FacebookAuth();
                await auth.authenticate(context, dto);
            }

            await page.close();

            const old = this.#pool.get(key);
            if (old) {
                try { await old.context.close(); } catch (_) {}
            }

            this.#pool.set(key, {
                context,
                createdAt: Date.now(),
                lifeHours: this.#random(5, 24),
                rootPage: null
            });

            console.log(`[FacebookContextPool] READY user=${key}`);

        } catch (err) {
            if (context) {
                try { await context.close(); } catch (_) {}
            }
            throw err;
        }
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