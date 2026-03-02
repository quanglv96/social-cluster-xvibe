import axios from 'axios';
import { config } from '../../config/config.js';
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
                const passInput = page.locator('input[name="pass"]');

                if (await emailInput.count() > 0) {
                    await emailInput.fill(user_name);

                    // Có thể Facebook yêu cầu bấm Continue trước
                    const continueBtn = page.locator('span:has-text("Continue")');

                    if (await continueBtn.count() > 0) {
                        await continueBtn.click();
                        await page.waitForTimeout(3000);
                    }

                    if (await passInput.count() > 0) {
                        await passInput.fill(password);
                    }

                    // Sau khi nhập password xong
                    await page.keyboard.press('Tab');
                    await page.keyboard.press('Tab');
                    await page.keyboard.press('Enter');

                } else {
                    const continueBtn = page.getByText('Continue', { exact: true })
                    if (await continueBtn.count() > 0) {
                        await continueBtn.click();
                    }

                    await page.waitForTimeout(3000);

                    if (await passInput.count() > 0) {
                        await passInput.fill(password);
                    }

                    // Sau khi nhập password xong
                    await page.keyboard.press('Tab');
                    await page.keyboard.press('Tab');
                    await page.keyboard.press('Enter');
                }

                await page.waitForTimeout(8000);

                if (await this.isLoggedIn(context)) {
                    loginSuccess = true;
                    break;
                }
            }

            if (!loginSuccess) {
                throw new Error("Login failed after 3 attempts");
            }

            const newCookies = await context.cookies();

            await axios.post(`${config.updateCookie}`, {
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
}
