// core/browser/BrowserManager.js

import { chromium } from 'playwright';
import { config } from '../../config/config.js';

let browser;

export class BrowserManager {

    static async getBrowser() {
        if (!browser) {
            browser = await chromium.launch({
                headless: config.headless,
                args: ['--disable-blink-features=AutomationControlled']
            });
        }
        return browser;
    }
}
