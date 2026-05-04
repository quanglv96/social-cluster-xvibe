import {BrowserManager} from '../browser/BrowserManager.js';
import {XvibeNavigator} from "../social/XvibeNavigator.js";
import {config, runtimeConfig} from "../../config/config.js";
import {nowIso} from "../../utils/time.js";

// =========================
// Log Utils
// =========================


function formatMsg(module, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${module}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({type: 'LOG', data: {type, msg}});
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
// SessionManager
// =========================

export class SessionManager {

    static context = null;
    static rootPage = null;
    static createdAt = null;
    static lifeHours = null;
    static initializing = null;

    // =========================
    // PUBLIC
    // =========================

    static async forceLogout(reason = 'unknown') {
        const start = Date.now();
        log('FORCE_LOGOUT', '🚀 started', {reason});

        try {
            if (this.navigator) {
                try {
                    await this.navigator.stop();
                } catch (e) {
                    logWarn('FORCE_LOGOUT', 'navigator stop error', {error: e.message});
                }
                this.navigator = null;
            }

            if (this.context) {
                const pages = this.context.pages();

                for (const page of pages) {
                    try {
                        await page.goto('https://www.facebook.com', {
                            waitUntil: 'domcontentloaded',
                            timeout: 15000
                        });

                        await page.click(
                            '[aria-label="Trang cá nhân của bạn"], [aria-label="Your profile"], [aria-label="Account"]'
                        );

                        await Promise.all([
                            page.waitForNavigation({waitUntil: 'load', timeout: 10000}),
                            page.click('text=/Đăng xuất|Log Out/i')
                        ]);

                        if (!page.url().includes('login')) {
                            await page.goto('https://www.facebook.com/logout.php');
                        }

                        await page.evaluate(async () => {
                            localStorage.clear();
                            sessionStorage.clear();
                        });

                    } catch (err) {
                        logWarn('FORCE_LOGOUT', 'page logout failed, using fallback', {error: err.message});
                        await page.goto('https://www.facebook.com/logout.php');
                    }
                }

                try {
                    await this.context.clearCookies();
                } catch (e) {
                    logWarn('FORCE_LOGOUT', 'clearCookies error', {error: e.message});
                }

                try {
                    await this.context.close();
                } catch (e) {
                    logWarn('FORCE_LOGOUT', 'close context error', {error: e.message});
                }
            }

            this.context = null;
            this.rootPage = null;
            this.createdAt = null;
            this.lifeHours = null;
            this.hasEvent = false;

            logOk('FORCE_LOGOUT', 'done', {ms: Date.now() - start});

        } catch (err) {
            logError('FORCE_LOGOUT', 'failed', {error: err.message});
            throw err;
        }
    }

    static async getSession() {
        const start = Date.now();

        console.log('[DEBUG][getSession] START', {
            hasContext: !!this.context,
            hasRootPage: !!this.rootPage
        });

        try {
            // ===== CHECK EXPIRED =====
            let expired = false;
            if (this.context) {
                try {
                    expired = await this.#isExpired();
                } catch (err) {
                    console.error('[DEBUG][getSession] isExpired ERROR', err);
                }
            }

            console.log('[DEBUG][getSession] CHECK', {
                hasContext: !!this.context,
                expired
            });

            // ===== INIT IF NEEDED =====
            if (!this.context || expired) {
                console.log('[DEBUG][getSession] INIT SESSION TRIGGERED');
                await this.#ensureInit();
                console.log('[DEBUG][getSession] INIT SESSION DONE', {
                    hasContext: !!this.context
                });
            }

            // ===== ROOT PAGE =====
            if (!this.rootPage || this.rootPage.isClosed()) {
                console.log('[DEBUG][getSession] CREATE ROOT PAGE');

                this.rootPage = await this.context.newPage();

                console.log('[DEBUG][getSession] ROOT PAGE CREATED', {
                    isClosed: this.rootPage.isClosed()
                });

                await this.#gotoRoot();

                console.log('[DEBUG][getSession] GOTO ROOT DONE', {
                    url: this.rootPage.url?.()
                });
            } else {
                console.log('[DEBUG][getSession] REUSE ROOT PAGE', {
                    isClosed: this.rootPage.isClosed()
                });
            }

            const duration = Date.now() - start;

            console.log('[DEBUG][getSession] SUCCESS', {
                durationMs: duration,
                hasContext: !!this.context,
                hasRootPage: !!this.rootPage
            });

            return {
                context: this.context,
                rootPage: this.rootPage
            };

        } catch (err) {
            console.error('[DEBUG][getSession] FAILED', {
                error: err?.message,
                stack: err?.stack,
                durationMs: Date.now() - start
            });
            throw err;
        }
    }

    static async #gotoRoot() {
        await this.rootPage.goto(`${runtimeConfig.rootUrl}`, {
            waitUntil: 'domcontentloaded'
        });
    }

    static async createEventPage() {
        const {context} = await this.getSession();
        const page = await context.newPage();

        // ✅ Apply visibility cho event page
        await BrowserManager.applyVisibilityToPage(page);

        return page;
    }

    static hasEvent = false;
    static navigator = null;

    static async closeEventPage(page) {
        if (!page) return;

        try {
            const context = page.context();

            if (!page.isClosed()) {
                await page.close();
            }

            // Chỉ close context nếu không phải context của rootPage
            if (context !== this.rootPage?.context()) {
                await context.close();
            }
        } catch (e) {
            logWarn('SESSION', 'cannot close event page', {error: e.message});
        }

        await this.restoreRootOnly();
    }

    static async restoreRootOnly() {
        try {
            await this.#restoreRoot();
        } catch (e) {
            logWarn('SESSION', 'restoreRootOnly error', {error: e.message});
        }

        this.hasEvent = false;

        if (!this.navigator && this.rootPage && !this.rootPage.isClosed()) {
            this.navigator = new XvibeNavigator(
                this.rootPage,
                async () => this.hasEvent
            );

            this.navigator.start().catch(err =>
                logWarn('NAVIGATOR', 'start error', {error: err.message})
            );
        }
    }

    // =========================
    // PRIVATE
    // =========================

    static async #ensureInit() {
        if (this.initializing) {
            return this.initializing;
        }

        this.initializing = this.#initSession();
        await this.initializing;
        this.initializing = null;
    }

    // SessionManager.js — sửa #initSession
    static async #initSession() {
        log('SESSION', '🚀 initializing new session');

        if (this.context) {
            try {
                await this.context.close();
            } catch (e) {
                logWarn('SESSION', 'error closing old context', {error: e.message});
            }
        }

        const browser = await BrowserManager.getBrowser();

        this.context = await browser.newContext({
            viewport: {width: 1366, height: 768},
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            locale: 'en-US',
            timezoneId: 'Asia/Ho_Chi_Minh'
        });

        await this.context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {get: () => false});
        });

        this.rootPage = await this.context.newPage();

        // ✅ Apply visibility ngay sau khi tạo page
        await BrowserManager.applyVisibilityToPage(this.rootPage);

        // ✅ Lắng nghe page mới trong context này
        this.context.on('page', async (page) => {
            await BrowserManager.applyVisibilityToPage(page);
        });

        await this.#gotoRoot();

        this.createdAt = Date.now();
        this.lifeHours = this.#random(5, 24);

        logOk('SESSION', 'initialized', {lifeHours: this.lifeHours});
    }

    static async #isExpired() {
        if (!this.createdAt) return true;

        const now = Date.now();
        const maxLife = this.lifeHours * 60 * 60 * 1000;
        const expired = now - this.createdAt > maxLife;

        if (expired) {
            log('SESSION', '⏰ session expired, recreating');
        }

        return expired;
    }

    static async #restoreRoot() {
        if (!this.rootPage) return;
        if (this.rootPage.isClosed()) return;

        try {
            await this.rootPage.bringToFront();

            if (!this.rootPage.url().includes(`${config.rootUrl}`)) {
                await this.#gotoRoot();
            }

            await this.rootPage.waitForTimeout(1000);

            await this.rootPage.evaluate(() => {
                sessionStorage.clear();
            });

            await this.rootPage.reload({waitUntil: 'domcontentloaded'});

        } catch (e) {
            logWarn('SESSION', 'cannot restore root', {error: e.message});
        }
    }

    static #random(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    static status = 'running';

    static async sleep() {
        log('BOT', '😴 going to sleep');

        if (!this.context) return;

        try {
            await this.context.close();
        } catch (e) {
            logWarn('BOT', 'sleep close error', {error: e.message});
        }

        this.context = null;
        this.rootPage = null;
        this.navigator = null;
        this.hasEvent = false;

        logOk('BOT', 'sleeping');
    }

    static async wakeup() {
        if (this.context) {
            logWarn('BOT', 'wakeup called but already running');
            return;
        }

        log('BOT', '⏰ waking up');

        await this.#ensureInit();

        if (!this.rootPage || this.rootPage.isClosed()) {
            this.rootPage = await this.context.newPage();
            await this.#gotoRoot();
        }

        this.hasEvent = false;

        this.navigator = new XvibeNavigator(
            this.rootPage,
            async () => this.hasEvent
        );

        this.navigator.start().catch(err =>
            logWarn('NAVIGATOR', 'start error', {error: err.message})
        );

        logOk('BOT', 'navigator started');
    }
}