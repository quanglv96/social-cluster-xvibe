// core/browser/BrowserManager.js

import { chromium } from 'playwright';
import { config } from '../../config/config.js';

let browser = null;
let launching = null;

export class BrowserManager {

    // =========================
    // GET BROWSER (safe)
    // =========================
    static async getBrowser() {

        // Nếu browser tồn tại và còn sống
        if (browser && browser.isConnected()) {
            return browser;
        }

        // Nếu đang launch rồi → đợi
        if (launching) {
            return launching;
        }

        launching = this.#launchBrowser();

        browser = await launching;
        launching = null;

        return browser;
    }

    // =========================
    // PRIVATE LAUNCH
    // =========================
    static async #launchBrowser() {

        console.log('[BrowserManager] Launching new browser...');

        const instance = await chromium.launch({
            headless: config.headless,
            channel: 'chrome',
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        instance.on('disconnected', () => {
            console.warn('[BrowserManager] Browser disconnected');
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
}