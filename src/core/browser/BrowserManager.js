// core/browser/BrowserManager.js

import { chromium } from 'playwright';

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
        console.log('[BrowserManager] Launch ROOT browser...');

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
            console.warn('[BrowserManager] ROOT browser disconnected');
            browser = null;
        });

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
                console.log('[BrowserManager] Browser closed');
            }
        } catch (err) {
            console.error('[BrowserManager] Error closing browser:', err);
        } finally {
            browser = null;
            launching = null;
        }
    }

    static async newContext(profilePath) {

        if (!profilePath) {
            throw new Error('[BrowserManager] profilePath is required');
        }

        console.log('[BrowserManager] Launch PROFILE:', profilePath);

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
            console.warn('[BrowserManager] PROFILE context closed:', profilePath);
        });

        return context;
    }
}