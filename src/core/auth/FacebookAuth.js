import axios from 'axios';
import {config, runtimeConfig} from '../../config/config.js';
import { BaseAuth } from './BaseAuth.js';

export class FacebookAuth extends BaseAuth {

    async authenticate(context, dto) {

        const { cookie, user_name, password, type } = dto;

        const page = await context.newPage();
        let cookieLoginSuccess = false;

        if (cookie) {
            try {
                const cookies = this.normalizeCookies(cookie);
                await context.addCookies(cookies);

                await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(3000);

                if (await this.isLoggedIn(context)) {
                    cookieLoginSuccess = true;
                }
            } catch {}
        }

        if (!cookieLoginSuccess) {

            if (!user_name || !password) {
                throw new Error("Credential missing");
            }

            const MAX_RETRY = 3;
            let loginSuccess = false;

            for (let i = 1; i <= MAX_RETRY; i++) {

                await page.goto('https://www.facebook.com/login', {
                    waitUntil: 'domcontentloaded'
                });

                await page.waitForTimeout(3000);

                // Trường hợp login form bình thường
                const emailInput = page.locator('input[name="email"]');

                if (await emailInput.count() > 0) {
                    await emailInput.fill(user_name);

                    const continueBtn = page.locator('span:has-text("Continue")');

                    if (await continueBtn.count() > 0) {
                        await continueBtn.click();

                        // 🔥 QUAN TRỌNG: đợi password render
                        await page.waitForSelector('input[type="password"]', { timeout: 10000 });
                    }

                    const passInput = page.locator('input[type="password"]');

                    await passInput.fill(password);
                    await page.keyboard.press('Enter');

                } else {
                    const continueBtn = page.getByText('Continue', { exact: true });

                    if (await continueBtn.count() > 0) {
                        await continueBtn.click();
                    }

                    // 🔥 vẫn phải wait
                    await page.waitForSelector('input[type="password"]', { timeout: 10000 });

                    const passInput = page.locator('input[type="password"]');

                    await passInput.fill(password);
                    await page.keyboard.press('Enter');
                }

                await page.waitForTimeout(30000);

                await this.handleFacebookDialogs(page);

                if (await this.isLoggedIn(context)) {
                    loginSuccess = true;
                    break;
                }
            }

            if (!loginSuccess) {
                throw new Error("Login failed after 3 attempts");
            }

            const newCookies = await context.cookies();

            await axios.post(`${runtimeConfig.api.apiUpdateCookie}`, {
                type: type,
                cookie: JSON.stringify(newCookies)
            });
        }

        await page.close();
    }

    async isLoggedIn(context) {
        const cookies = await context.cookies();
        return cookies.some(c => c.name === 'c_user');
    }

    normalizeCookies(rawCookies) {
        if (!rawCookies) return [];

        if (typeof rawCookies === "string") {
            rawCookies = JSON.parse(rawCookies);
        }

        return rawCookies.map(c => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path || "/",
            httpOnly: !!c.httpOnly,
            secure: !!c.secure,
            sameSite: 'None',
            expires: c.expirationDate
                ? Math.floor(c.expirationDate)
                : undefined
        }));
    }

    async handleFacebookDialogs(page) {

        const selectors = [
            // button text
            'span:has-text("Not now")',
            'span:has-text("Không phải bây giờ")',
            'span:has-text("Bỏ qua")',
            'span:has-text("Skip")',
            'span:has-text("Continue")',
            'span:has-text("Tiếp tục")',

            // icon X
            'div[aria-label="Close"]',
            'div[aria-label="Đóng"]',
            '[role="button"][aria-label="Close"]',
            '[role="button"][aria-label="Đóng"]',

            // fallback cho dialog
            'div[role="dialog"] [aria-label="Close"]'
        ];

        for (const selector of selectors) {
            try {
                const btn = page.locator(selector);

                if (await btn.count() > 0 && await btn.first().isVisible()) {
                    await btn.first().click();
                    await page.waitForTimeout(1500);
                    return true;
                }
            } catch {}
        }

        return false;
    }
}
