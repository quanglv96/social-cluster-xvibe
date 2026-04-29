import { chromium } from 'playwright';

// =========================
// Log Utils
// =========================
function nowIso() { return new Date().toISOString(); }
function formatMsg(module, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${module}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}
function sendToRenderer(type, msg) { process.send?.({ type: 'LOG', data: { type, msg } }); }
function log(module, message, fields = {})     { sendToRenderer('info',  formatMsg(module, message,         fields)); }
function logWarn(module, message, fields = {}) { sendToRenderer('warn',  formatMsg(module, `⚠️ ${message}`, fields)); }
function logError(module, message, fields = {}){ sendToRenderer('error', formatMsg(module, `❌ ${message}`, fields)); }
function logOk(module, message, fields = {})   { sendToRenderer('ok',    formatMsg(module, `✅ ${message}`, fields)); }

// =========================
// State
// =========================
export let HEADLESS = true; // true = ẩn (off-screen), false = hiện

export function setHeadless(val) { HEADLESS = val; }

let browser   = null;
let launching = null;

const activeContexts = new Map(); // profilePath → BrowserContext

// =========================
// Args
// =========================


const STEALTH_ARGS = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    // 🔥 Ẩn khỏi taskbar Windows
    '--disable-infobars',
    '--window-position=-32000,-32000',  // spawn thẳng off-screen, không flash
];

const OFFSCREEN = { left: -32000, top: -32000, width: 1366, height: 768, windowState: 'normal' };
const ONSCREEN  = { left: 100,    top: 100,    width: 1366, height: 768, windowState: 'normal' };

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
        const instance = await chromium.launchPersistentContext({
            headless: false,
            args: STEALTH_ARGS,
        });
        instance.on('disconnected', () => { logWarn('BROWSER', 'root browser disconnected'); browser = null; });
        logOk('BROWSER', 'root browser launched');
        return instance;
    }

    // =========================
    // PERSISTENT CONTEXT (per profile)
    // =========================
    static async newContext(profilePath) {
        if (!profilePath) throw new Error('[BrowserManager] profilePath is required');

        if (activeContexts.has(profilePath)) {
            log('BROWSER', 'reusing existing context', { profile: profilePath });
            return activeContexts.get(profilePath);
        }

        log('BROWSER', '🚀 launching profile context', { profile: profilePath });

        const context = await chromium.launchPersistentContext(profilePath, {
            headless: false,       // luôn false — visibility điều khiển bằng CDP off-screen
            args: STEALTH_ARGS,
            viewport:   { width: 1366, height: 768 },
            // userAgent:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            locale:     'vi-VN',
            timezoneId: 'Asia/Ho_Chi_Minh',
        });

        activeContexts.set(profilePath, context);

        context.on('close', () => {
            logWarn('BROWSER', 'profile context closed', { profile: profilePath });
            activeContexts.delete(profilePath);
        });
        await new Promise(r => setTimeout(r, 300));
        // Apply visibility cho page mặc định ngay khi launch
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
    // SET VISIBILITY — realtime, không restart
    // =========================
    static async setVisibility(hide) {
        HEADLESS = hide;
        log('BROWSER', '🖥️ setVisibility', { hide, contexts: activeContexts.size });

        for (const [profilePath, context] of activeContexts) {
            try {
                await BrowserManager.#applyVisibilityToContext(context, profilePath);
            } catch (err) {
                logError('BROWSER', 'setVisibility failed', { profile: profilePath, error: err.message });
            }
        }

        if (browser?.isConnected()) {
            for (const ctx of browser.contexts()) {
                for (const page of ctx.pages()) {
                    await BrowserManager.#moveWindow(page);
                }
            }
        }
    }

    // =========================
    // PUBLIC: apply cho 1 page mới tạo
    // Pool gọi ngay sau context.newPage() để tránh flash lên màn hình
    // =========================
    static async applyVisibilityToPage(page) {
        await BrowserManager.#moveWindow(page);
    }

    // =========================
    // INTERNAL
    // =========================
    static async #applyVisibilityToContext(context, profilePath = '?') {
        const pages = context.pages();
        if (!pages.length) {
            logWarn('BROWSER', 'no pages in context, skip', { profile: profilePath });
            return;
        }
        for (const page of pages) {
            await BrowserManager.#moveWindow(page);
        }
    }

    // HEADLESS=true  → off-screen (ẩn, render đầy đủ, không steal focus)
    // HEADLESS=false → on-screen  (hiện, không steal focus)
    static async #moveWindow(page) {
        try {
            if (!page || page.isClosed()) return;

            const context = page.context();

            if (!context || context._closed) return;

            // SAFE attach
            let session;
            try {
                session = await context.newCDPSession(page);
            } catch {
                return;
            }

            const { windowId } = await session.send('Browser.getWindowForTarget');

            await session.send('Browser.setWindowBounds', {
                windowId,
                bounds: HEADLESS ? OFFSCREEN : ONSCREEN,
            });

            await session.detach?.();
        } catch (err) {
            logWarn('BROWSER', 'CDP moveWindow failed', { error: err.message });
        }
    }

    // =========================
    // CLOSE ALL
    // =========================
    static async closeAll() {
        for (const [profilePath, context] of activeContexts) {
            try {
                await context.close();
                log('BROWSER', 'context closed', { profile: profilePath });
            } catch (err) {
                logError('BROWSER', 'error closing context', { profile: profilePath, error: err.message });
            }
        }
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