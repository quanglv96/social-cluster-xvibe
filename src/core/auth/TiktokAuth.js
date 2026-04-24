import { BaseAuth } from './BaseAuth.js';
import axios from 'axios';
import { config, runtimeConfig } from '../../config/config.js';

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

const TAG = 'TK_AUTH';

export class TiktokAuth extends BaseAuth {

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async humanType(page, selector, text) {
        const locator = page.locator(selector);
        await locator.waitFor({ state: 'visible', timeout: 30000 });
        await locator.click({ delay: 200 });
        await this.sleep(400);

        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await this.sleep(300);

        for (const char of text) {
            await page.keyboard.type(char, { delay: 80 + Math.random() * 120 });
        }

        await this.sleep(800);
    }

    async moveMouseHumanLike(page, fromX, fromY, toX, toY) {
        const steps = 20 + Math.floor(Math.random() * 10);

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = fromX + (toX - fromX) * t + (Math.random() - 0.5) * 5;
            const y = fromY + (toY - fromY) * t + (Math.random() - 0.5) * 5;
            await page.mouse.move(x, y);
            await this.sleep(10 + Math.random() * 20);
        }
    }

    async humanClick(page, selector) {
        log(TAG, `Human-like click`, { selector });

        const element = page.locator(selector);
        await element.waitFor({ state: 'visible', timeout: 10000 });

        const box = await element.boundingBox();
        if (!box) throw new Error(`Cannot get bounding box for ${selector}`);

        const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
        const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

        const currentPos = await page.evaluate(() => ({ x: window.mouseX || 0, y: window.mouseY || 0 }));
        await this.moveMouseHumanLike(page, currentPos.x, currentPos.y, targetX, targetY);
        await this.sleep(100 + Math.random() * 200);
        await page.mouse.click(targetX, targetY);

        await page.evaluate(({ x, y }) => { window.mouseX = x; window.mouseY = y; }, { x: targetX, y: targetY });

        log(TAG, `Clicked`, { x: Math.round(targetX), y: Math.round(targetY) });
    }

    // ------------------------------------------------
    // CAPTCHA: gọi backend báo verify
    // ------------------------------------------------
    async notifyCaptcha(page) {
        log(TAG, `Detected CAPTCHA — notifying backend...`);

        try {
            await axios.post(`${runtimeConfig.api.baseUrl}/api/vibe/verify-capcha/TIKTOK`);
            logOk(TAG, `Backend notified about CAPTCHA`);
        } catch (err) {
            logWarn(TAG, `Failed to notify backend about CAPTCHA`, { error: err.message });
        }

        // Chờ người dùng / hệ thống giải captcha tối đa 60s
        log(TAG, `Waiting for CAPTCHA to be resolved (max 60s)...`);
        const resolved = await Promise.race([
            page.waitForURL('**/tiktokstudio**', { timeout: 60000 }).then(() => 'STUDIO'),
            page.waitForURL('**/foryou**', { timeout: 60000 }).then(() => 'HOME'),
            page.waitForSelector('input[name="username"]', { timeout: 60000 }).then(() => 'STILL_LOGIN'),
            this.sleep(60000).then(() => 'TIMEOUT'),
        ]).catch(() => 'TIMEOUT');

        log(TAG, `CAPTCHA wait result`, { resolved });
        return resolved;
    }

    // ------------------------------------------------
    // STEP 1: Mở trang TikTok & click nút Đăng nhập
    // ------------------------------------------------
    async ensureLoginPage(page) {
        const maxRetry = 2;

        for (let i = 1; i <= maxRetry; i++) {
            try {
                log(TAG, `Ensure TikTok login page`, { attempt: i });
                await this.safeGoto(page, 'https://www.tiktok.com/');
                await this.sleep(2000);

                // Click nút "Đăng nhập" trên top bar
                log(TAG, `Clicking top-right Login button...`);
                const loginBtn = page.locator('#top-right-action-bar-login-button');
                await loginBtn.waitFor({ state: 'visible', timeout: 15000 });
                await this.humanClick(page, '#top-right-action-bar-login-button');

                logOk(TAG, `Login modal opened`);
                return;

            } catch (err) {
                logError(TAG, `ensureLoginPage failed`, err);
                if (i === maxRetry) throw err;
                await this.sleep(3000 + Math.random() * 2000);
            }
        }
    }

    // ------------------------------------------------
    // STEP 2+3: Chọn phương thức đăng nhập → Email/Username
    // ------------------------------------------------
    async selectEmailLoginMethod(page) {
        log(TAG, `Selecting login method: phone/email/username...`);

        // Click vào item "Sử dụng số điện thoại/email/tên người dùng"
        const phoneEmailOption = page.locator('[data-e2e="channel-item"]').filter({
            hasText: /số điện thoại|email|tên người dùng/i
        }).first();

        await phoneEmailOption.waitFor({ state: 'visible', timeout: 15000 });

        const box = await phoneEmailOption.boundingBox();
        if (!box) throw new Error('Cannot get bounding box for phone/email option');

        const tx = box.x + box.width * (0.3 + Math.random() * 0.4);
        const ty = box.y + box.height * (0.3 + Math.random() * 0.4);
        const pos = await page.evaluate(() => ({ x: window.mouseX || 0, y: window.mouseY || 0 }));
        await this.moveMouseHumanLike(page, pos.x, pos.y, tx, ty);
        await this.sleep(100 + Math.random() * 200);
        await page.mouse.click(tx, ty);
        logOk(TAG, `Phone/email option clicked`);

        await this.sleep(1500);

        // Click link "Đăng nhập bằng email hoặc tên người dùng"
        log(TAG, `Switching to email/username login...`);
        const emailLink = page.locator('a[href="/login/phone-or-email/email"]');
        await emailLink.waitFor({ state: 'visible', timeout: 10000 });
        await this.humanClick(page, 'a[href="/login/phone-or-email/email"]');
        logOk(TAG, `Email/username login selected`);

        await this.sleep(1500);
    }

    // ------------------------------------------------
    // STEP 4+5: Nhập username → Tab → nhập password → Enter
    // ------------------------------------------------
    async inputCredentials(page, username, password) {
        const maxRetry = 3;

        for (let attempt = 1; attempt <= maxRetry; attempt++) {
            log(TAG, `Credentials attempt`, { attempt: `${attempt}/${maxRetry}` });

            try {
                // --- Username ---
                log(TAG, `Typing username/email...`);
                const usernameInput = page.locator('input[name="username"]');
                await usernameInput.waitFor({ state: 'visible', timeout: 15000 });

                await this.humanClick(page, 'input[name="username"]');
                await this.sleep(300);
                await usernameInput.clear();
                await this.sleep(300);

                await this.humanType(page, 'input[name="username"]', username);

                const typedUser = await usernameInput.inputValue();
                if (typedUser !== username) {
                    throw new Error(`Username mismatch: expected "${username}", got "${typedUser}"`);
                }
                logOk(TAG, `Username typed`, { value: typedUser });

                // --- Tab sang password ---
                log(TAG, `Pressing Tab to move to password field...`);
                await page.keyboard.press('Tab');
                await this.sleep(600);

                // --- Password ---
                log(TAG, `Typing password...`);
                const passwordInput = page.locator('input[type="password"]');
                await passwordInput.waitFor({ state: 'visible', timeout: 10000 });

                for (const char of password) {
                    await page.keyboard.type(char, { delay: 80 + Math.random() * 120 });
                }
                await this.sleep(800);

                const typedPass = await passwordInput.inputValue();
                if (!typedPass || typedPass.length !== password.length) {
                    throw new Error(`Password length mismatch`);
                }
                logOk(TAG, `Password typed`);

                // --- Enter để submit ---
                log(TAG, `Pressing Enter to submit login...`);
                await page.keyboard.press('Enter');
                await this.sleep(2000);

                return; // thành công

            } catch (err) {
                logError(TAG, `Credentials attempt ${attempt} failed`, err);
                if (attempt < maxRetry) {
                    await this.sleep(3000);
                    continue;
                }
                throw new Error(`Credentials input failed after ${maxRetry} attempts`);
            }
        }
    }

    // ------------------------------------------------
    // STEP 6: Kiểm tra & xử lý captcha
    // ------------------------------------------------
    async handlePostLogin(page) {
        log(TAG, `Waiting for post-login state...`);

        const state = await Promise.race([
            page.waitForURL('**/tiktokstudio**', { timeout: 20000 }).then(() => 'STUDIO'),
            page.waitForURL('**/@**', { timeout: 20000 }).then(() => 'PROFILE'),
            page.waitForURL('**/foryou**', { timeout: 20000 }).then(() => 'HOME'),
            page.waitForSelector('[class*="captcha"]', { timeout: 20000 }).then(() => 'CAPTCHA'),
            page.waitForSelector('[id*="captcha"]', { timeout: 20000 }).then(() => 'CAPTCHA'),
            page.waitForSelector('iframe[src*="captcha"]', { timeout: 20000 }).then(() => 'CAPTCHA'),
            page.waitForSelector('[data-e2e="captcha"]', { timeout: 20000 }).then(() => 'CAPTCHA'),
            this.sleep(20000).then(() => 'TIMEOUT'),
        ]).catch(() => 'TIMEOUT');

        log(TAG, `Post-login state detected`, { state });

        if (state === 'CAPTCHA') {
            logWarn(TAG, `CAPTCHA detected — handling...`);
            const captchaResult = await this.notifyCaptcha(page);

            if (captchaResult === 'TIMEOUT' || captchaResult === 'STILL_LOGIN') {
                throw new Error('CAPTCHA not resolved in time');
            }

            log(TAG, `CAPTCHA resolved, state=${captchaResult}`);
            return captchaResult;
        }

        if (state === 'TIMEOUT') {
            // Kiểm tra thêm URL hiện tại
            const currentUrl = page.url();
            log(TAG, `Timeout — current URL`, { url: currentUrl });

            if (currentUrl.includes('tiktok.com') && !currentUrl.includes('login')) {
                logWarn(TAG, `Seems logged in but slow redirect — continuing`);
                return 'HOME';
            }
            throw new Error('Login timed out — unknown state');
        }

        return state;
    }

    // ------------------------------------------------
    // STEP 7: Điều hướng sang TikTok Studio
    // ------------------------------------------------
    async goToStudio(page) {
        log(TAG, `Navigating to TikTok Studio...`);
        await this.safeGoto(page, 'https://www.tiktok.com/tiktokstudio?lang=vi-VN');
        await this.sleep(3000);
        logOk(TAG, `TikTok Studio loaded`, { url: page.url() });
    }

    // ------------------------------------------------
    // STEP 8: Click nút "Tải lên" trong Studio sidebar
    // ------------------------------------------------
    async clickUploadButton(page) {
        const maxRetry = 3;

        log(TAG, `Looking for Upload button in Studio...`);

        for (let attempt = 1; attempt <= maxRetry; attempt++) {
            try {
                log(TAG, `Upload button attempt`, { attempt: `${attempt}/${maxRetry}` });

                // Ưu tiên selector ổn định nhất: data-tt + text content
                // Fallback theo thứ tự từ cụ thể → tổng quát
                const selectors = [
                    'button[data-tt="Sidebar_Sidebar_Button"]:has(span.TUXText)',
                    'button[data-tt="Sidebar_Sidebar_Button"]',
                    // Fallback: tìm theo text "Tải lên" bên trong button
                    'button:has(span.TUXText)',
                ];

                let uploadBtn = null;

                for (const sel of selectors) {
                    try {
                        const candidates = page.locator(sel);
                        const count = await candidates.count();

                        for (let i = 0; i < count; i++) {
                            const el = candidates.nth(i);
                            const text = await el.innerText().catch(() => '');
                            if (text.includes('Tải lên')) {
                                uploadBtn = el;
                                log(TAG, `Upload button found via selector`, { selector: sel, index: i });
                                break;
                            }
                        }

                        if (uploadBtn) break;
                    } catch (_) {
                        // thử selector tiếp
                    }
                }

                if (!uploadBtn) throw new Error('Upload button not found in DOM');

                // Chờ button visible & không còn disabled
                await uploadBtn.waitFor({ state: 'visible', timeout: 10000 });

                // Kiểm tra trạng thái disabled — chờ tối đa 10s nếu đang loading
                let isDisabled = await uploadBtn.getAttribute('data-disabled');
                if (isDisabled === 'true') {
                    log(TAG, `Button is disabled/loading — waiting up to 10s...`);
                    await page.waitForFunction(
                        (btn) => btn.getAttribute('data-disabled') !== 'true',
                        await uploadBtn.elementHandle(),
                        { timeout: 10000 }
                    ).catch(() => logWarn(TAG, `Button still disabled after wait — clicking anyway`));
                }

                const box = await uploadBtn.boundingBox();
                if (!box) throw new Error('Cannot get bounding box for Upload button');

                const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
                const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

                const currentPos = await page.evaluate(() => ({ x: window.mouseX || 0, y: window.mouseY || 0 }));
                await this.moveMouseHumanLike(page, currentPos.x, currentPos.y, targetX, targetY);
                await this.sleep(150 + Math.random() * 200);
                await page.mouse.click(targetX, targetY);

                await page.evaluate(({ x, y }) => { window.mouseX = x; window.mouseY = y; }, { x: targetX, y: targetY });

                logOk(TAG, `Upload button clicked`, { x: Math.round(targetX), y: Math.round(targetY) });
                await this.sleep(1500);
                return;

            } catch (err) {
                logError(TAG, `Upload button attempt ${attempt} failed`, err);
                if (attempt < maxRetry) {
                    await this.sleep(2000 + Math.random() * 1000);
                    continue;
                }
                throw new Error(`Click Upload button failed after ${maxRetry} attempts: ${err.message}`);
            }
        }
    }

    // ------------------------------------------------
    // Cookie login
    // ------------------------------------------------
    async tryCookieLogin(context, page, cookie) {
        try {
            log(TAG, `Trying cookie login...`);

            const cookies = typeof cookie === 'string' ? JSON.parse(cookie) : cookie;
            if (!Array.isArray(cookies)) throw new Error('Invalid cookie format');

            await context.addCookies(cookies);
            await this.safeGoto(page, 'https://www.tiktok.com/foryou');
            await this.sleep(4000);

            const url = page.url();
            if (!url.includes('/login')) {
                logOk(TAG, `Cookie login success`, { url });
                return true;
            }

        } catch (err) {
            logWarn(TAG, `Cookie login failed`, { error: err.message });
        }

        return false;
    }

    // ------------------------------------------------
    // safeGoto
    // ------------------------------------------------
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
                await this.sleep(2000 + Math.random() * 3000);
            }
        }
    }

    // ------------------------------------------------
    // Main authenticate
    // ------------------------------------------------
    async authenticate(context, dto) {
        const { cookie, user_name, password } = dto;

        const page = await context.newPage();
        log(TAG, `🚀 START TIKTOK AUTH`);

        try {
            let loggedIn = false;

            // --- Thử cookie trước ---
            if (cookie) {
                loggedIn = await this.tryCookieLogin(context, page, cookie);
            }

            if (!loggedIn) {
                if (!user_name || !password) throw new Error('Missing credentials: user_name & password required');

                await this.sleep(2000 + Math.random() * 2000);

                // STEP 1: Mở TikTok & click Đăng nhập
                log(TAG, `STEP 1: Open TikTok & click Login button`);
                await this.ensureLoginPage(page);
                await this.sleep(1500);

                // STEP 2+3: Chọn phương thức → email/username
                log(TAG, `STEP 2+3: Select email/username login method`);
                await this.selectEmailLoginMethod(page);
                await this.sleep(1000);

                // STEP 4+5: Nhập credentials
                log(TAG, `STEP 4+5: Enter credentials`);
                await this.inputCredentials(page, user_name, password);

                // STEP 6: Xử lý captcha / chờ redirect
                log(TAG, `STEP 6: Handle post-login (captcha / redirect)`);
                const postState = await this.handlePostLogin(page);
                log(TAG, `Post-login state resolved`, { postState });
            }

            // STEP 7: Điều hướng sang Studio
            log(TAG, `STEP 7: Navigate to TikTok Studio`);
            await this.goToStudio(page);
            logOk(TAG, `🎉 TikTok login complete — now in Studio`);

            // STEP 8: Click nút Tải lên
            log(TAG, `STEP 8: Click Upload button`);
            await this.clickUploadButton(page);

            // Lưu cookie mới về backend
            const newCookies = await context.cookies();
            await axios.post(`${runtimeConfig.api.apiUpdateCookie}`, {
                type: dto.type,
                cookie: JSON.stringify(newCookies),
            });
            logOk(TAG, `Cookies saved to backend`);

        } catch (err) {
            logError(TAG, `Auth failed`, err);

            try {
                await page.screenshot({ path: 'tiktok-auth-error.png' });
            } catch {}

            throw err;

        } finally {
            await page.close();
        }
    }
}