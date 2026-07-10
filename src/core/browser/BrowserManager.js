import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from "fs";
import { nowIso } from "../../utils/time.js";

// =========================
// Stealth Plugin
// =========================
chromium.use(StealthPlugin());

// =========================
// Log Utils
// =========================
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
// Stealth Args
// =========================
const STEALTH_ARGS = [
    '--disable-blink-features=AutomationControlled',
    '--disable-automation',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-infobars',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--use-fake-ui-for-media-stream',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-ipc-flooding-protection',
    '--password-store=basic',
    '--use-mock-keychain',
    '--lang=vi-VN',
];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// =========================
// Window Bounds
// =========================
const OFFSCREEN = { left: -32000, top: -32000, width: 1366, height: 768, windowState: 'normal' };
const ONSCREEN  = { windowState: 'maximized' };

// =========================
// Stealth Init Script — truyền dạng STRING để serialize đúng
// =========================
const STEALTH_INIT_SCRIPT = `(${function () {
    // 1. Xóa webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // 2. Fake plugins — PluginArray-like
    Object.defineProperty(navigator, 'plugins', {
        get: () => {
            const defs = [
                { name: 'Chrome PDF Plugin',  filename: 'internal-pdf-viewer' },
                { name: 'Chrome PDF Viewer',  filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                { name: 'Native Client',      filename: 'internal-nacl-plugin' },
            ];
            const arr = defs.map(({ name, filename }) => ({
                name, filename, description: name, length: 1,
                item: () => null, namedItem: () => null,
            }));
            arr.item      = (i) => arr[i] ?? null;
            arr.namedItem = (n) => arr.find(p => p.name === n) ?? null;
            arr.refresh   = () => {};
            Object.defineProperty(arr, 'length', { value: arr.length });
            return arr;
        }
    });

    // 3. Languages khớp locale vi-VN
    Object.defineProperty(navigator, 'languages', {
        get: () => ['vi-VN', 'vi', 'en-US', 'en'],
    });

    // 4. Chrome runtime object
    if (!window.chrome) {
        window.chrome = {
            runtime: {
                id: undefined,
                connect: () => {},
                sendMessage: () => {},
                onMessage: { addListener: () => {}, removeListener: () => {} },
            },
            loadTimes: function () { return {}; },
            csi:       function () { return {}; },
            app:       { isInstalled: false },
        };
    }

    // 5. Patch permissions
    const origQuery = window.navigator.permissions.query.bind(navigator.permissions);
    window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : origQuery(params);

    // 6. Ẩn playwright/puppeteer trong Error stack
    const OrigError = window.Error;
    window.Error = function (...args) {
        const err = new OrigError(...args);
        if (err.stack) {
            err.stack = err.stack.replace(/playwright|puppeteer/gi, 'chrome');
        }
        return err;
    };
    Object.assign(window.Error, OrigError);

    // 7. Patch iframe contentWindow.navigator (Facebook dùng cái này)
    const origGetter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')?.get;
    if (origGetter) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
            get: function () {
                const win = origGetter.call(this);
                if (win && win.navigator) {
                    try {
                        Object.defineProperty(win.navigator, 'webdriver', { get: () => undefined });
                    } catch {}
                }
                return win;
            }
        });
    }
}})()`;

// =========================
// Helper: inject stealth + reload pages đang mở
// =========================
async function applyStealthToContext(context, profileLabel = '?') {
    // Inject vào mọi page mới (kể cả chưa load)
    await context.addInitScript(STEALTH_INIT_SCRIPT);

    // Reload các page đang sống để script có hiệu lực ngay
    const pages = context.pages();
    if (pages.length) {
        log('BROWSER', `🔄 reloading ${pages.length} existing page(s) for stealth`, { profile: profileLabel });
        await Promise.all(
            pages.map(p =>
                p.isClosed()
                    ? Promise.resolve()
                    : p.reload({ waitUntil: 'domcontentloaded' })
                        .catch(err => logWarn('BROWSER', 'reload failed', { error: err.message }))
            )
        );
    }
}

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
    static async resetContext(profilePath) {

        const context = activeContexts.get(profilePath);

        if (!context) {
            return;
        }

        activeContexts.delete(profilePath);

        try {
            await context.close();
        } catch {}

        return await BrowserManager.newContext(profilePath);

    }
    static async #launchBrowser() {
        log('BROWSER', '🚀 launching root browser');

        const instance = await chromium.launch({
            headless: false,
            args: STEALTH_ARGS,
            viewport: null,
            acceptDownloads: true,
        });

        instance.on('disconnected', () => {
            logWarn('BROWSER', 'root browser disconnected');
            browser = null;
        });

        // Stealth cho mọi context mới của root browser
        instance.on('context', async (ctx) => {
            await applyStealthToContext(ctx, 'root')
                .catch(err => logWarn('BROWSER', 'root context stealth failed', { error: err.message }));
        });

        // Visibility cho mọi page mới
        instance.on('page', async (page) => {
            await BrowserManager.#moveWindow(page)
                .catch(() => {});
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
            headless:   false,
            args:       STEALTH_ARGS,
            locale:     'vi-VN',
            timezoneId: 'Asia/Ho_Chi_Minh',
            userAgent:  USER_AGENT,
            viewport:   null,
            timeout:    30000,
        });

        // ✅ Inject stealth + reload pages đang mở
        await applyStealthToContext(context, profilePath);

        activeContexts.set(profilePath, context);

        context.on('close', () => {
            logWarn('BROWSER', 'profile context closed', { profile: profilePath });
            activeContexts.delete(profilePath);
        });

        // Apply visibility
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
    // SET VISIBILITY
    // HEADLESS=true  → offscreen
    // HEADLESS=false → maximized
    // =========================
    static async setVisibility(headless) {
        HEADLESS = headless;
        log('BROWSER', '🖥️ setVisibility', { headless, contexts: activeContexts.size });

        const tasks = [];

        for (const [profilePath, context] of activeContexts) {
            tasks.push(
                BrowserManager.#applyVisibilityToContext(context, profilePath)
                    .catch(err => logError('BROWSER', 'setVisibility failed', {
                        profile: profilePath,
                        error: err.message,
                    }))
            );
        }

        if (browser?.isConnected()) {
            for (const ctx of browser.contexts()) {
                for (const page of ctx.pages()) {
                    tasks.push(
                        BrowserManager.#moveWindow(page)
                            .catch(err => logWarn('BROWSER', 'root browser moveWindow failed', {
                                error: err.message,
                            }))
                    );
                }
            }
        }

        await Promise.all(tasks);
        log('BROWSER', '🖥️ setVisibility done', { headless });
    }

    // =========================
    // PUBLIC: gọi ngay sau newPage()
    // =========================
    static async applyVisibilityToPage(page) {
        await BrowserManager.#moveWindow(page);
    }

    // =========================
    // INTERNAL: apply visibility cho toàn bộ pages trong 1 context
    // =========================
    static async #applyVisibilityToContext(context, profilePath = '?') {
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
                    windowId,
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
                        error: err.message,
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