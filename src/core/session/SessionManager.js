import { BrowserManager } from '../browser/BrowserManager.js';
import {XvibeNavigator} from "../social/XvibeNavigator.js";

export class SessionManager {

    static context = null;
    static rootPage = null;
    static createdAt = null;
    static lifeHours = null;
    static initializing = null; // prevent race condition

    // =========================
    // PUBLIC
    // =========================
    static async getRootPage() {
        const { rootPage } = await this.getSession();
        return rootPage;
    }
    static async getSession() {

        if (!this.context || await this.#isExpired()) {
            await this.#ensureInit();
        }

        if (!this.rootPage || this.rootPage.isClosed()) {
            this.rootPage = await this.context.newPage();
            await this.#gotoRoot();
        }

        return {
            context: this.context,
            rootPage: this.rootPage
        };
    }
    static async #gotoRoot() {

        await this.rootPage.goto('https://xvibe.me', {
            waitUntil: 'domcontentloaded'
        });
    }
    /**
     * Tạo page cho event (post, crawl, ...)
     * Page lifecycle sẽ được caller quản lý
     */
    static async createEventPage() {
        const { context } = await this.getSession();
        return await context.newPage();
    }
    static hasEvent = false;
    static navigator = null;
    /**
     * Đóng event page và restore root
     */
    static async closeEventPage(page) {

        if (!page) return;

        try {
            if (!page.isClosed()) {
                await page.close();
            }
        } catch (e) {
            console.warn('[SessionManager] Cannot close event page:', e.message);
        }

        await this.#restoreRoot();

        // reset event state
        this.hasEvent = false;

        if (this.rootPage && !this.rootPage.isClosed()) {

            this.navigator = new XvibeNavigator(
                this.rootPage,
                async () => this.hasEvent // callback stop condition
            );

            // chạy nền không block Express
            this.navigator.start().catch(err =>
                console.warn('[Navigator Error]', err.message)
            );
        }
    }

    // =========================
    // PRIVATE
    // =========================

    /**
     * Đảm bảo chỉ init 1 lần khi concurrent call
     */
    static async #ensureInit() {

        if (this.initializing) {
            return this.initializing;
        }

        this.initializing = this.#initSession();
        await this.initializing;
        this.initializing = null;
    }

    static async #initSession() {

        console.log('[SessionManager] Initializing new session...');

        // Close old context if exists
        if (this.context) {
            try {
                await this.context.close();
            } catch (e) {
                console.warn('[SessionManager] Error closing old context:', e.message);
            }
        }

        const browser = await BrowserManager.getBrowser();

        this.context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            locale: 'en-US',
            timezoneId: 'Asia/Ho_Chi_Minh'
        });

        await this.context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false
            });
        });

        this.rootPage = await this.context.newPage();
        await this.#gotoRoot();

        this.createdAt = Date.now();
        this.lifeHours = this.#random(5, 24);

        console.log(
            `[SessionManager] Session started. Lifetime: ${this.lifeHours}h`
        );
    }

    static async #isExpired() {

        if (!this.createdAt) return true;

        const now = Date.now();
        const maxLife = this.lifeHours * 60 * 60 * 1000;

        const expired = now - this.createdAt > maxLife;

        if (expired) {
            console.log('[SessionManager] Session expired. Recreating...');
        }

        return expired;
    }

    static async #restoreRoot() {

        if (!this.rootPage) return;
        if (this.rootPage.isClosed()) return;

        try {
            await this.rootPage.bringToFront();

            // Nếu không còn ở domain → goto lại
            if (!this.rootPage.url().includes('xvibe.me')) {
                await this.#gotoRoot();
                return;
            }

            // Nếu vẫn ở xvibe → reload sạch state
            await this.rootPage.reload({
                waitUntil: 'domcontentloaded'
            });

        } catch (e) {
            console.warn('[SessionManager] Cannot restore root:', e.message);
        }
    }

    static #random(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}