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
    static async launchBrowser(profilePath) {
        console.log('[BrowserManager] Launching new browser...');

        const args = [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-accelerated-2d-canvas',
            '--use-gl=swiftshader',
            '--font-render-hinting=none',
            '--force-device-scale-factor=1',
        ];

        const instance = await chromium.launchPersistentContext(
            profilePath || undefined, // nếu truyền profilePath thì dùng profile riêng
            {
                headless: false, // bật Chrome thật
                args,
                viewport: { width: 1366, height: 768 },
                userAgent:
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                locale: 'en-US',
                timezoneId: 'Asia/Ho_Chi_Minh',
            }
        );

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