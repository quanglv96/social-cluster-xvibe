import {BaseAuth} from './BaseAuth.js';
import axios from "axios";
import {config, runtimeConfig} from "../../config/config.js";

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

const TAG = 'TW_AUTH';

export class TwitterAuth extends BaseAuth {

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

    async inputUsernameWithRetry(page, username) {
        const maxRetry = 3;

        log(TAG, `START inputUsernameWithRetry`, { username });

        for (let attempt = 1; attempt <= maxRetry; attempt++) {
            log(TAG, `USERNAME attempt`, { attempt: `${attempt}/${maxRetry}` });

            try {
                log(TAG, `Clearing username input...`);
                const usernameInput = page.locator('input[name="text"]');
                await usernameInput.waitFor({ state: 'visible', timeout: 10000 });

                await this.humanClick(page, 'input[name="text"]');
                await this.sleep(300);
                await usernameInput.clear();
                await this.sleep(500);

                log(TAG, `Typing username...`);
                await this.humanType(page, 'input[name="text"]', username);

                const typedValue = await usernameInput.inputValue();
                log(TAG, `Typed value verified`, { value: typedValue });

                if (typedValue !== username) {
                    throw new Error(`Value mismatch: expected "${username}", got "${typedValue}"`);
                }

                if (attempt === 2) {
                    log(TAG, `Attempt 2 — pressing Enter`);
                    await page.keyboard.press('Enter');
                } else {
                    log(TAG, `Clicking outside to trigger validation...`);
                    const box = await usernameInput.boundingBox();
                    const outsideX = box.x + box.width + 50;
                    const outsideY = box.y + 50;

                    await page.mouse.move(outsideX, outsideY, { steps: 20 });
                    await this.sleep(200);
                    await page.mouse.click(outsideX, outsideY);
                    await this.sleep(1500);

                    const valueAfterBlur = await usernameInput.inputValue();
                    if (valueAfterBlur !== username) {
                        throw new Error(`Username changed after blur: "${valueAfterBlur}"`);
                    }

                    log(TAG, `Clicking NEXT button...`);
                    const nextButton = page.getByRole('button', { name: 'Next' }).first();
                    await nextButton.waitFor({ state: 'visible', timeout: 10000 });

                    const nextBox = await nextButton.boundingBox();
                    if (!nextBox) throw new Error('Cannot get Next button position');

                    const nextX = nextBox.x + nextBox.width * (0.3 + Math.random() * 0.4);
                    const nextY = nextBox.y + nextBox.height * (0.3 + Math.random() * 0.4);

                    log(TAG, `Moving to Next button`, { x: Math.round(nextX), y: Math.round(nextY) });

                    const currentPos = await page.evaluate(() => ({ x: window.mouseX || 0, y: window.mouseY || 0 }));
                    await this.moveMouseHumanLike(page, currentPos.x, currentPos.y, nextX, nextY);
                    await this.sleep(100 + Math.random() * 200);
                    await page.mouse.click(nextX, nextY);

                    await page.evaluate(({ x, y }) => { window.mouseX = x; window.mouseY = y; }, { x: nextX, y: nextY });

                    logOk(TAG, `Next button clicked`);
                    await this.sleep(2000);
                }

                const result = await Promise.race([
                    page.waitForSelector('input[name="password"]', { timeout: 10000 }).then(() => 'PASSWORD'),
                    page.waitForSelector('input[name="text"]', { timeout: 10000 }).then(() => 'USERNAME_AGAIN'),
                    page.waitForSelector('input[data-testid="ocfEnterTextTextInput"]', { timeout: 10000 }).then(() => 'PHONE_VERIFICATION')
                ]);

                log(TAG, `Detected state`, { result });

                if (result === 'PASSWORD') {
                    logOk(TAG, `Username accepted — moving to password`);
                    return;
                }

                if (result === 'PHONE_VERIFICATION') {
                    throw new Error('Twitter requires phone verification');
                }

                if (result === 'USERNAME_AGAIN') {
                    logWarn(TAG, `Still on username screen — retrying`);
                    await this.sleep(2000);
                    continue;
                }

            } catch (err) {
                logError(TAG, `Error at username attempt ${attempt}`, err);

                if (attempt < maxRetry) {
                    log(TAG, `Retrying in 3s...`);
                    await this.sleep(3000);
                    continue;
                } else {
                    logError(TAG, `All ${maxRetry} username attempts failed`, err);
                }
            }
        }

        throw new Error(`Username input failed after ${maxRetry} attempts`);
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

    async authenticate(context, dto) {
        const { cookie, user_name, password } = dto;

        const page = await context.newPage();
        log(TAG, `🚀 START AUTH`);

        try {
            let loggedIn = false;

            if (cookie) {
                loggedIn = await this.tryCookieLogin(context, page, cookie);
            }

            if (!loggedIn) {
                if (!user_name || !password) throw new Error('Missing credentials');

                await this.sleep(2000 + Math.random() * 2000);

                log(TAG, `STEP 1: Opening login page`);
                await this.ensureLoginPage(page);
                await this.sleep(2000);

                log(TAG, `STEP 2: Entering username`);
                await this.inputUsernameWithRetry(page, user_name);
                await this.sleep(2000);

                log(TAG, `STEP 3: Entering password`);
                await this.humanType(page, 'input[name="password"]', password);
                await this.sleep(1000);

                log(TAG, `STEP 4: Clicking login`);
                const loginButton = page.getByRole('button', { name: /Log in|Đăng nhập/i }).first();
                await loginButton.waitFor({ state: 'visible', timeout: 10000 });

                const box = await loginButton.boundingBox();
                if (!box) throw new Error('No login button box');

                await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);

                log(TAG, `Waiting for home...`);
                await page.waitForSelector('a[data-testid="SideNav_NewTweet_Button"]', { timeout: 30000 });
                logOk(TAG, `Login success`);

                const newCookies = await context.cookies();
                await axios.post(`${runtimeConfig.api.apiUpdateCookie}`, {
                    type: dto.type,
                    cookie: JSON.stringify(newCookies)
                });
                logOk(TAG, `Cookies saved to backend`);
            }

        } catch (err) {
            logError(TAG, `Auth failed`, err);

            try {
                await page.screenshot({ path: 'auth-error.png' });
            } catch {}

            throw err;

        } finally {
            await page.close();
        }
    }

    async tryCookieLogin(context, page, cookie) {
        try {
            log(TAG, `Trying cookie login...`);

            const cookies = typeof cookie === 'string' ? JSON.parse(cookie) : cookie;
            if (!Array.isArray(cookies)) throw new Error('Invalid cookie format');

            await context.addCookies(cookies);
            await this.safeGoto(page, 'https://x.com/home');
            await this.sleep(4000);

            if (await page.$('a[data-testid="SideNav_NewTweet_Button"]')) {
                logOk(TAG, `Cookie login success`);
                return true;
            }

        } catch (err) {
            logWarn(TAG, `Cookie login failed`, { error: err.message });
        }

        return false;
    }

    async ensureLoginPage(page) {
        const maxRetry = 2;

        for (let i = 1; i <= maxRetry; i++) {
            try {
                log(TAG, `Ensure login page`, { attempt: i });
                await this.safeGoto(page, 'https://x.com/login');
                await page.waitForSelector('input[name="text"]', { timeout: 10000 });
                logOk(TAG, `Login page ready`);
                return;

            } catch (err) {
                logError(TAG, `Ensure login page failed`, err);
                if (i === maxRetry) throw err;

                try {
                    if (page.url() !== 'about:blank') {
                        log(TAG, `Reloading...`);
                        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                    }
                } catch (e) {
                    logWarn(TAG, `Reload also failed`, { error: e.message });
                }

                await this.sleep(2000 + Math.random() * 2000);
            }
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
                await this.sleep(2000 + Math.random() * 3000);
            }
        }
    }
}