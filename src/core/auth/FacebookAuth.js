import axios from 'axios';
import {config, runtimeConfig} from '../../config/config.js';
import { BaseAuth } from './BaseAuth.js';

// =========================
// Log Utils
// =========================

function nowIso() {
    return new Date().toISOString();
}

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({ type: 'LOG', data: { type, msg } });
}

function log(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, message, fields);
    sendToRenderer('info', msg);
}

function logWarn(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, `⚠️ ${message}`, fields);
    sendToRenderer('warn', msg);
}

function logError(requestId, message, err) {
    const msg = formatMsg(requestId, `❌ ${message}`, { error: err?.message || err });
    sendToRenderer('error', msg);
}

function logOk(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, `✅ ${message}`, fields);
    sendToRenderer('ok', msg);
}

// =========================
// Class
// =========================

const TAG = 'FB_AUTH';

export class FacebookAuth extends BaseAuth {

    async authenticate(context, dto) {

        const { cookie, user_name, password, type } = dto;

        const page = await context.newPage();
        let cookieLoginSuccess = false;

        if (cookie) {
            try {
                log(TAG, `Trying cookie login`);
                const cookies = this.normalizeCookies(cookie);
                await context.addCookies(cookies);

                await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(3000);

                if (await this.isLoggedIn(context)) {
                    cookieLoginSuccess = true;
                    logOk(TAG, `Cookie login success`);
                } else {
                    logWarn(TAG, `Cookie login failed, falling back to credentials`);
                }
            } catch (err) {
                logWarn(TAG, `Cookie login error`, { error: err?.message });
            }
        }

        if (!cookieLoginSuccess) {

            if (!user_name || !password) {
                throw new Error("Credential missing");
            }

            const MAX_RETRY = 3;
            let loginSuccess = false;

            for (let i = 1; i <= MAX_RETRY; i++) {
                log(TAG, `Attempting credential login`, { attempt: `${i}/${MAX_RETRY}` });

                await page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(3000);

                const emailInput = page.locator('input[name="email"]');

                if (await emailInput.count() > 0) {
                    await emailInput.fill(user_name);

                    const continueBtn = page.locator('span:has-text("Continue")');
                    if (await continueBtn.count() > 0) {
                        await continueBtn.click();
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

                    await page.waitForSelector('input[type="password"]', { timeout: 10000 });

                    const passInput = page.locator('input[type="password"]');
                    await passInput.fill(password);
                    await page.keyboard.press('Enter');
                }

                await page.waitForTimeout(30000);
                await this.handleFacebookDialogs(page);

                if (await this.isLoggedIn(context)) {
                    loginSuccess = true;
                    logOk(TAG, `Credential login success`, { attempt: i });
                    break;
                }

                logWarn(TAG, `Login attempt failed`, { attempt: i });
            }

            if (!loginSuccess) {
                throw new Error("Login failed after 3 attempts");
            }

            const newCookies = await context.cookies();
            await axios.post(`${runtimeConfig.api.apiUpdateCookie}`, {
                type,
                cookie: JSON.stringify(newCookies)
            });

            logOk(TAG, `Cookies saved to backend`);
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
            expires: c.expirationDate ? Math.floor(c.expirationDate) : undefined
        }));
    }

    async handleFacebookDialogs(page) {
        const selectors = [
            'span:has-text("Not now")',
            'span:has-text("Không phải bây giờ")',
            'span:has-text("Bỏ qua")',
            'span:has-text("Skip")',
            'span:has-text("Continue")',
            'span:has-text("Tiếp tục")',
            'div[aria-label="Close"]',
            'div[aria-label="Đóng"]',
            '[role="button"][aria-label="Close"]',
            '[role="button"][aria-label="Đóng"]',
            'div[role="dialog"] [aria-label="Close"]'
        ];

        for (const selector of selectors) {
            try {
                const btn = page.locator(selector);
                if (await btn.count() > 0 && await btn.first().isVisible()) {
                    await btn.first().click();
                    await page.waitForTimeout(1500);
                    log(TAG, `Dialog dismissed`, { selector });
                    return true;
                }
            } catch {}
        }

        return false;
    }
}