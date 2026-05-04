import { chromium } from 'playwright';
import fs from "fs";

// =========================
// Log Utils
// =========================
function nowIso() { return new Date().toISOString(); }
function formatMsg(module, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${module}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}
function sendToRenderer(type, msg) { process.send?.({ type: 'LOG', data: { type, msg } }); }
function log(module, message, fields = {})      { sendToRenderer('info',  formatMsg(module, message,          fields)); }
function logWarn(module, message, fields = {})  { sendToRenderer('warn',  formatMsg(module, `⚠️ ${message}`,  fields)); }
function logError(module, message, fields = {}) { sendToRenderer('error', formatMsg(module, `❌ ${message}`,  fields)); }
function logOk(module, message, fields = {})    { sendToRenderer('ok',    formatMsg(module, `✅ ${message}`,  fields)); }

// =========================
// State
// =========================
export let HEADLESS = true;
export function setHeadless(val) { HEADLESS = val; }

let browser   = null;
let launching = null;
const activeContexts = new Map();

// =========================
// Args — KHÔNG có remote-debugging-port, không có window-position
// =========================
const STEALTH_ARGS = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-infobars',
];

const OFFSCREEN = { left: -32000, top: -32000, width: 1366, height: 768, windowState: 'normal' };
const ONSCREEN  = { windowState: 'maximized' };

// =========================
export class BrowserManager {

    // =========================
    // ROOT BROWSER
    // =========================
    static async getBrowser() {
        if (browser?.isConnected()) return browser;
        if (launching) return launching;
        launching = BrowserManager.#launchBrowser();
        browser   = await launching;
        launching = null;
        return browser;
    }

    static async #launchBrowser() {
        log('BROWSER', '🚀 launching root browser');
        const instance = await chromium.launch({
            headless: false,
            args: STEALTH_ARGS,
        });
        instance.on('disconnected', () => {
            logWarn('BROWSER', 'root browser disconnected');
            browser = null;
        });
        logOk('BROWSER', 'root browser launched');
        return instance;
    }
    static getActiveContextCount() {
        return activeContexts.size;
    }
    // =========================
    // PERSISTENT CONTEXT (per profile)
    // =========================
    static async newContext(profilePath) {
        if (!profilePath) throw new Error('[BrowserManager] profilePath is required');

        if (!fs.existsSync(profilePath)) {
            throw new Error(`Profile path does not exist: ${profilePath}`);
        }

        if (activeContexts.has(profilePath)) {
            log('BROWSER', 'reusing existing context', { profile: profilePath });
            return activeContexts.get(profilePath);
        }

        log('BROWSER', '🚀 launching profile context', { profile: profilePath });

        const context = await chromium.launchPersistentContext(profilePath, {
            headless: false,
            args: STEALTH_ARGS,
            locale:     'vi-VN',
            timezoneId: 'Asia/Ho_Chi_Minh',
            viewport:   null,  // full theo window size
            timeout:    30000,
        });

        activeContexts.set(profilePath, context);

        context.on('close', () => {
            logWarn('BROWSER', 'profile context closed', { profile: profilePath });
            activeContexts.delete(profilePath);
        });

        // Apply visibility ngay sau launch
        await BrowserManager.#applyVisibilityToContext(context, profilePath);

        logOk('BROWSER', 'profile context ready', { profile: profilePath });
        return context;
    }

    // =========================
    // CLOSE SINGLE CONTEXT
    // =========================
    static async closeContext(profilePath) {
        const context = activeContexts.get(profilePath);
        if (!context) return;
        try {
            await context.close();
            log('BROWSER', 'context closed', { profile: profilePath });
        } catch (err) {
            logError('BROWSER', 'error closing context', { profile: profilePath, error: err.message });
        } finally {
            activeContexts.delete(profilePath);
        }
    }

    // =========================
    // SET VISIBILITY — realtime toggle ẩn/hiện
    // Gọi từ main.js khi nhận SET_HEADLESS
    // HEADLESS=true  → ẩn (off-screen)
    // HEADLESS=false → hiện (maximized)
    // =========================
    static async setVisibility(headless) {
        HEADLESS = headless;
        log('BROWSER', '🖥️ setVisibility', { headless, contexts: activeContexts.size });

        const tasks = [];

        // Apply cho tất cả profile contexts
        for (const [profilePath, context] of activeContexts) {
            tasks.push(
                BrowserManager.#applyVisibilityToContext(context, profilePath)
                    .catch(err => logError('BROWSER', 'setVisibility failed', {
                        profile: profilePath,
                        error: err.message
                    }))
            );
        }

        await Promise.all(tasks);
        log('BROWSER', '🖥️ setVisibility done', { headless });
    }

    // =========================
    // PUBLIC: gọi ngay sau newPage() để tránh flash
    // =========================
    static async applyVisibilityToPage(page) {
        await BrowserManager.#moveWindow(page);
    }

    // =========================
    // INTERNAL: apply cho toàn bộ pages trong 1 context
    // =========================
    static async #applyVisibilityToContext(context, profilePath = '?') {
        // Chờ page xuất hiện tối đa 5s
        let pages = context.pages();

        if (!pages.length) {
            try {
                await context.waitForEvent('page', { timeout: 5000 });
                pages = context.pages();
            } catch {
                pages = context.pages();
            }
        }

        if (!pages.length) {
            logWarn('BROWSER', 'no pages found, skip visibility', { profile: profilePath });
            return;
        }

        for (const page of pages) {
            await BrowserManager.#moveWindow(page);
        }
    }

    // =========================
    // INTERNAL: CDP move window
    // =========================
    static async #moveWindow(page) {
        try {
            if (!page || page.isClosed()) return;

            const context = page.context();
            if (!context || context._closed) return;

            let session;
            try {
                session = await context.newCDPSession(page);
            } catch {
                return;
            }

            try {
                const { windowId } = await session.send('Browser.getWindowForTarget');

                await session.send('Browser.setWindowBounds', {
                    windowId,
                    bounds: HEADLESS ? OFFSCREEN : ONSCREEN,
                });

                log('BROWSER', `🖥️ window moved`, {
                    state: HEADLESS ? 'OFFSCREEN' : 'ONSCREEN',
                    windowId
                });

            } finally {
                await session.detach?.().catch(() => {});
            }

        } catch (err) {
            logWarn('BROWSER', 'CDP moveWindow failed', { error: err.message });
        }
    }

    // =========================
    // CLOSE ALL
    // =========================
    static async closeAll() {
        const closePromises = [];

        for (const [profilePath, context] of activeContexts) {
            closePromises.push(
                context.close()
                    .then(() => log('BROWSER', 'context closed', { profile: profilePath }))
                    .catch(err => logError('BROWSER', 'error closing context', {
                        profile: profilePath,
                        error: err.message
                    }))
            );
        }

        await Promise.all(closePromises);
        activeContexts.clear();

        if (browser) {
            try {
                if (browser.isConnected()) await browser.close();
                logOk('BROWSER', 'root browser closed');
            } catch (err) {
                logError('BROWSER', 'error closing root browser', { error: err.message });
            } finally {
                browser   = null;
                launching = null;
            }
        }
    }
}