// core/browser/ContextFactory.js

import { BrowserManager } from './BrowserManager.js';
import {SocialFactory} from "../factory/SocialFactory.js";

export class ContextFactory {

    static async create(dto) {

        const browser = await BrowserManager.getBrowser();

        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            locale: 'en-US',
            timezoneId: 'Asia/Ho_Chi_Minh'
        });

        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false
            });
        });

        const social = SocialFactory.create(dto.type, context);

        await social.authenticate(dto);

        return { context, social };
    }
}
