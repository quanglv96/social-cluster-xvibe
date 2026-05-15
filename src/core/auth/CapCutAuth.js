import { BaseAuth } from './BaseAuth.js';
import axios from "axios";
import { config, runtimeConfig } from "../../config/config.js";
import { nowIso } from "../../utils/time.js";

// =========================
// Log Utils
// =========================

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

const TAG = 'CAPCUT_AUTH';

export class CapCutAuth extends BaseAuth {

    async authenticate(context, dto) {
        const { user_name, password, cookie } = dto;

        const page = await context.newPage();
        log(TAG, '🚀 START CAPCUT AUTH');

        try {
            // =========================
            // 1. Cookie login
            // =========================
            if (cookie) {
                log(TAG, 'Cookie provided — attempting cookie login...');
                const loggedIn = await this.tryCookieLogin(context, page, cookie);
                log(TAG, 'Cookie login result', { loggedIn });
                if (loggedIn) {
                    logOk(TAG, 'Already logged in via cookie — skip credential flow');
                    return;
                }
                logWarn(TAG, 'Cookie login failed — falling back to credential login');
            } else {
                log(TAG, 'No cookie provided — using credential login');
            }

            if (!user_name || !password) {
                throw new Error('Missing credentials');
            }

            // =========================
            // B1: open homepage
            // =========================
            log(TAG, 'B1: open homepage');
            await page.goto('https://www.capcut.com/vi-vn/', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            await page.waitForTimeout(2000);

            // =========================
            // B2: click "Dùng thử trực tuyến"
            // =========================
            log(TAG, 'B2: click login link');
            await page.locator('a[role="button"][href*="/login"]').first().click();
            await page.waitForTimeout(3000);

            // =========================
            // B3: nhập email
            // =========================
            log(TAG, 'B3: input email');
            const emailInput = page.locator('input[name="signUsername"]');
            await emailInput.waitFor({ state: 'visible', timeout: 15000 });
            await emailInput.fill(user_name);

            const emailValue = await emailInput.inputValue();
            if (emailValue !== user_name) {
                throw new Error('Email input mismatch');
            }

            // =========================
            // B4: click tiếp tục
            // =========================
            log(TAG, 'B4: click continue');
            await page.locator('button:has-text("Tiếp tục")').click();
            await page.waitForTimeout(3000);

            // =========================
            // B5: nhập password
            // =========================
            log(TAG, 'B5: input password');
            const passInput = page.locator('input[type="password"]');
            await passInput.waitFor({ state: 'visible', timeout: 10000 });
            await passInput.fill(password);

            // =========================
            // B6: click đăng nhập
            // =========================
            log(TAG, 'B6: click login');
            await page.locator('button:has-text("Đăng nhập")').click();

            // =========================
            // VERIFY LOGIN
            // =========================
            log(TAG, 'VERIFY LOGIN...');
            await page.waitForTimeout(3000);

            const currentUrl = page.url();
            log(TAG, 'VERIFY: current url', { url: currentUrl });

            // Chụp ảnh để debug
            try {
                await page.screenshot({ path: 'capcut-verify.png' });
            } catch {}

            // Kiểm tra URL — sau login thường redirect về /my-edit hoặc /
            const isLoggedInByUrl = currentUrl.includes('/my-edit')
                || currentUrl.includes('/home')
                || (!currentUrl.includes('/login') && !currentUrl.includes('/sign'));

            // Kiểm tra DOM — thử nhiều selector
            const loggedInSelectors = [
                'img[alt="avatar"]',
                '[class*="user-avatar"]',
                '[class*="userAvatar"]',
                '[class*="my-edit"]',
                '[data-id="user-info"]',
            ];

            let isLoggedInByDom = false;
            for (const sel of loggedInSelectors) {
                try {
                    await page.waitForSelector(sel, { timeout: 3000 });
                    log(TAG, 'VERIFY: dom match', { sel });
                    isLoggedInByDom = true;
                    break;
                } catch {
                    // tiếp tục thử selector tiếp
                }
            }

            // Kiểm tra vẫn còn password input => chưa login
            const stillOnLogin = await page.$('input[type="password"]');

            log(TAG, 'VERIFY result', {
                isLoggedInByUrl,
                isLoggedInByDom,
                stillOnLogin: !!stillOnLogin,
            });

            if (stillOnLogin) {
                throw new Error('Login failed — still on login screen (password input still visible)');
            }

            if (!isLoggedInByUrl && !isLoggedInByDom) {
                throw new Error(`Login failed — unknown state at url: ${currentUrl}`);
            }

            logOk(TAG, '🎉 LOGIN SUCCESS');

            // =========================
            // SAVE COOKIE
            // =========================
            const newCookies = await context.cookies();
            await axios.post(`${runtimeConfig.api.apiUpdateCookie}`, {
                type: dto.type,
                cookie: JSON.stringify(newCookies)
            });

            logOk(TAG, 'Cookies saved');

        } catch (err) {
            logError(TAG, 'AUTH FAILED', err);

            try {
                await page.screenshot({ path: 'capcut-auth-error.png' });
            } catch {}

            throw err;

        } finally {
            await page.close();
        }
    }

    async tryCookieLogin(context, page, cookie) {
        try {
            log(TAG, 'Trying cookie login...');

            let cookies = [];
            try {
                cookies = typeof cookie === 'string' ? JSON.parse(cookie) : cookie;
            } catch {
                logWarn(TAG, 'Invalid cookie JSON');
                return false;
            }

            if (!Array.isArray(cookies) || !cookies.length) {
                logWarn(TAG, 'Cookie is not array or empty');
                return false;
            }

            log(TAG, 'Adding cookies to context...', { count: cookies.length });
            await context.addCookies(cookies);

            log(TAG, 'Navigating to /my-edit...');
            await this.safeGoto(page, 'https://www.capcut.com/my-edit');
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(3000);

            const currentUrl = page.url();
            log(TAG, 'Cookie check: current url', { url: currentUrl });

            // Nếu bị redirect về login → cookie hết hạn
            if (currentUrl.includes('/login') || currentUrl.includes('/sign')) {
                logWarn(TAG, 'Redirected to login page → cookie expired');
                return false;
            }

            try {
                await page.waitForLoadState('networkidle').catch(() => {});

                await page.waitForFunction(() => {
                    const avatar = document.querySelector('.user-avatar');
                    const loginInput = document.querySelector('input[type="password"]');

                    return avatar &&
                        avatar.offsetParent !== null &&
                        !loginInput;
                }, { timeout: 30000 });

                logOk(TAG, 'Cookie login success (avatar detected)');
                return true;

            } catch {
                logWarn(TAG, 'Avatar not found — checking other indicators...');
            }

            // Fallback: kiểm tra thêm các dấu hiệu đã login
            const loggedInIndicators = [
                '[class*="user-avatar"]',
                '[class*="userAvatar"]',
                'img[alt="avatar"]',
                '[data-id="user-info"]',
            ];

            for (const sel of loggedInIndicators) {
                try {
                    await page.waitForSelector(sel, { timeout: 3000 });
                    logOk(TAG, 'Cookie login success', { indicator: sel });
                    return true;
                } catch { /* continue */ }
            }

            logWarn(TAG, 'Cookie login: no logged-in indicator found → cookie invalid');
            return false;

        } catch (err) {
            logWarn(TAG, 'Cookie login failed', { error: err.message });
            return false;
        }
    }

    async safeGoto(page, url, options = {}) {
        const maxRetry = 3;

        for (let i = 1; i <= maxRetry; i++) {
            try {
                log(TAG, `GOTO`, { attempt: i, url });
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000, ...options });

                const content = await page.content();
                if (page.url() === 'about:blank' || content.length < 1000) {
                    throw new Error('Empty or blank page');
                }

                logOk(TAG, `GOTO success`, { url });
                return;

            } catch (err) {
                logError(TAG, `GOTO failed`, err);
                if (i === maxRetry) throw err;
                await page.waitForTimeout(2000);
            }
        }
    }
}