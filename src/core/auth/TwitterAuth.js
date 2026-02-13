import { BaseAuth } from './BaseAuth.js';
import axios from "axios";
import {config} from "../../config/config.js";

export class TwitterAuth extends BaseAuth {

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    log(message) {
        console.log(`[TwitterAuth] ${message}`);
    }

    async humanType(page, selector, text) {
        const locator = page.locator(selector);
        await locator.waitFor({ state: 'visible', timeout: 30000 });
        await locator.click({ delay: 200 });
        await this.sleep(400);

        // Clear old value
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await this.sleep(300);

        for (const char of text) {
            await page.keyboard.type(char, {
                delay: 80 + Math.random() * 120
            });
        }

        await this.sleep(800);
    }

    async inputUsernameWithRetry(page, username) {
        const maxRetry = 3;

        this.log(`🎬 START inputUsernameWithRetry()`);

        for (let attempt = 1; attempt <= maxRetry; attempt++) {

            this.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            this.log(`👤 USERNAME Attempt ${attempt}/${maxRetry}`);

            try {
                // Clear trước khi nhập
                this.log(`🧹 Clearing username input...`);
                const usernameInput = page.locator('input[name="text"]');

                await usernameInput.waitFor({ state: 'visible', timeout: 10000 });

                // ✅ Human click vào input
                await this.humanClick(page, 'input[name="text"]');
                await this.sleep(300);

                await usernameInput.clear();
                await this.sleep(500);

                this.log(`✅ Input cleared`);

                // Nhập username
                this.log(`⌨️ Typing username: ${username}`);
                await this.humanType(page, 'input[name="text"]', username);

                // Verify value
                const typedValue = await usernameInput.inputValue();
                this.log(`📝 Typed value: "${typedValue}"`);

                if (typedValue !== username) {
                    throw new Error(`Value mismatch: expected "${username}", got "${typedValue}"`);
                }

                // ✅ Click ra ngoài với human movement
                this.log(`👆 Clicking outside to trigger validation...`);

                // Di chuyển chuột đến vùng trống và click
                const box = await usernameInput.boundingBox();
                const outsideX = box.x + box.width + 50;
                const outsideY = box.y + 50;

                await page.mouse.move(outsideX, outsideY, { steps: 20 });
                await this.sleep(200);
                await page.mouse.click(outsideX, outsideY);

                await this.sleep(1500);
                this.log(`✅ Blur triggered`);

                // Verify lại value sau blur
                const valueAfterBlur = await usernameInput.inputValue();
                this.log(`📝 Value after blur: "${valueAfterBlur}"`);

                if (valueAfterBlur !== username) {
                    throw new Error(`Username changed after blur: "${valueAfterBlur}"`);
                }

                this.log(`➡️ Clicking NEXT button...`);

                // ✅ FIX: Dùng role="button" hoặc .first()
                // Cách 1: Dùng button role (tốt nhất)
                const nextButton = page.getByRole('button', { name: 'Next' }).first();
                await nextButton.waitFor({ state: 'visible', timeout: 10000 });

                const nextBox = await nextButton.boundingBox();
                if (!nextBox) {
                    throw new Error('Cannot get Next button position');
                }

                const nextX = nextBox.x + nextBox.width * (0.3 + Math.random() * 0.4);
                const nextY = nextBox.y + nextBox.height * (0.3 + Math.random() * 0.4);

                this.log(`🖱️ Moving to Next button (${Math.round(nextX)}, ${Math.round(nextY)})`);

                // Get current mouse position
                const currentPos = await page.evaluate(() => {
                    return { x: window.mouseX || 0, y: window.mouseY || 0 };
                });

                await this.moveMouseHumanLike(page, currentPos.x, currentPos.y, nextX, nextY);
                await this.sleep(100 + Math.random() * 200);
                await page.mouse.click(nextX, nextY);

                // Track mouse position
                await page.evaluate(({ x, y }) => {
                    window.mouseX = x;
                    window.mouseY = y;
                }, { x: nextX, y: nextY });

                this.log(`✅ Next button clicked`);

                this.log(`⏳ Waiting for next state (10s timeout)...`);
                await this.sleep(2000);

                const result = await Promise.race([
                    page.waitForSelector('input[name="password"]', { timeout: 10000 }).then(() => 'PASSWORD'),
                    page.waitForSelector('input[name="text"]', { timeout: 10000 }).then(() => 'USERNAME_AGAIN'),
                    page.waitForSelector('input[data-testid="ocfEnterTextTextInput"]', { timeout: 10000 }).then(() => 'PHONE_VERIFICATION')
                ]);

                this.log(`🎯 Detected state: ${result}`);

                if (result === 'PASSWORD') {
                    this.log(`✅✅✅ Username accepted! Moving to password...`);
                    return; // SUCCESS!
                }

                if (result === 'PHONE_VERIFICATION') {
                    this.log(`📱 Phone verification required`);
                    throw new Error('Twitter requires phone verification');
                }

                if (result === 'USERNAME_AGAIN') {
                    this.log(`⚠️ Still on username screen`);
                    await this.sleep(2000);
                    continue; // Retry
                }

            } catch (err) {
                this.log(`❌ Error at attempt ${attempt}: ${err.message}`);

                if (attempt < maxRetry) {
                    this.log(`🔄 Will retry in 3s...`);
                    await this.sleep(3000);
                    continue;
                } else {
                    this.log(`💀 All ${maxRetry} attempts failed`);
                }
            }
        }

        throw new Error(`❌ Username input failed after ${maxRetry} attempts`);
    }
    async moveMouseHumanLike(page, fromX, fromY, toX, toY) {
        const steps = 20 + Math.floor(Math.random() * 10); // 20-30 steps

        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;

            // Bezier curve để tạo đường cong tự nhiên
            const t = progress;
            const x = fromX + (toX - fromX) * t + (Math.random() - 0.5) * 5;
            const y = fromY + (toY - fromY) * t + (Math.random() - 0.5) * 5;

            await page.mouse.move(x, y);
            await this.sleep(10 + Math.random() * 20); // 10-30ms mỗi step
        }
    }

    async humanClick(page, selector) {
        this.log(`🖱️ Human-like click: ${selector}`);

        const element = page.locator(selector);
        await element.waitFor({ state: 'visible', timeout: 10000 });

        // Lấy vị trí element
        const box = await element.boundingBox();

        if (!box) {
            throw new Error(`Cannot get bounding box for ${selector}`);
        }

        // Vị trí ngẫu nhiên trong element (không click chính giữa)
        const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
        const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

        // Di chuyển chuột từ vị trí hiện tại đến target
        const currentPos = await page.evaluate(() => {
            return { x: window.mouseX || 0, y: window.mouseY || 0 };
        });

        this.log(`🖱️ Moving from (${Math.round(currentPos.x)}, ${Math.round(currentPos.y)}) to (${Math.round(targetX)}, ${Math.round(targetY)})`);

        await this.moveMouseHumanLike(page, currentPos.x, currentPos.y, targetX, targetY);

        // Đợi một chút trước khi click
        await this.sleep(100 + Math.random() * 200);

        // Click
        await page.mouse.click(targetX, targetY);

        // ✅ FIX: Track vị trí chuột - wrap arguments trong object
        await page.evaluate(({ x, y }) => {
            window.mouseX = x;
            window.mouseY = y;
        }, { x: targetX, y: targetY });

        this.log(`✅ Clicked at (${Math.round(targetX)}, ${Math.round(targetY)})`);
    }

    async authenticate(context, dto) {

        const { cookie, user_name, password } = dto;

        const page = await context.newPage();
        let loggedIn = false;

        this.log('🚀 START AUTHENTICATION');

        // Try cookie first
        if (cookie) {
            try {
                this.log('🍪 Trying cookie login...');

                // Fix: check if cookie is valid JSON array
                const cookies = typeof cookie === 'string' ? JSON.parse(cookie) : cookie;

                if (!Array.isArray(cookies)) {
                    throw new Error('Cookie must be an array');
                }

                await context.addCookies(cookies);

                await page.goto('https://x.com/home', {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                });

                await this.sleep(5000);

                if (await page.$('a[data-testid="SideNav_NewTweet_Button"]')) {
                    loggedIn = true;
                    this.log('✅ Cookie login successful');
                }
            } catch (err) {
                this.log(`⚠️ Cookie login failed: ${err.message}`);
            }
        }

        // Manual login with retry
        if (!loggedIn) {

            if (!user_name || !password) {
                throw new Error("Twitter credential missing");
            }

            this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            this.log('📍 STEP 1: Open login page');

            try {
                // Fix: dùng domcontentloaded thay vì networkidle
                await page.goto('https://x.com/i/flow/login', {
                    waitUntil: 'domcontentloaded', // ✅ Thay đổi này
                    timeout: 30000
                });

                this.log('✅ Page loaded');

                // Đợi input xuất hiện (chắc chắn DOM ready)
                await page.waitForSelector('input[name="text"]', { timeout: 10000 });

                this.log('✅ Login form ready');

            } catch (err) {
                this.log(`❌ Page load error: ${err.message}`);

                // Fallback: thử load lại không chờ networkidle
                this.log('🔄 Trying fallback load...');
                await page.goto('https://x.com/i/flow/login', {
                    timeout: 30000
                });

                await page.waitForSelector('input[name="text"]', { timeout: 15000 });
            }

            await this.sleep(3000);

            // STEP 2 - USERNAME WITH RETRY
            this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            this.log('📍 STEP 2: Input username');

            await this.inputUsernameWithRetry(page, user_name);

            this.log('✅ Username step complete');
            await this.sleep(2000);

            // STEP 3 - PASSWORD
            this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            this.log('📍 STEP 3: Input password');

            await this.humanType(page, 'input[name="password"]', password);

            this.log('✅ Password entered');
            await this.sleep(1000);

            // STEP 4 - LOGIN
            this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            this.log('📍 STEP 4: Click login button');

            // ✅ FIX: Dùng getByRole hoặc text chính xác
            try {
                // Thử tìm button "Log in" hoặc "Đăng nhập"
                const loginButton = page.getByRole('button', { name: /Log in|Đăng nhập/i }).first();

                await loginButton.waitFor({ state: 'visible', timeout: 10000 });

                this.log('✅ Login button found');

                // Human click vào login button
                const loginBox = await loginButton.boundingBox();

                if (!loginBox) {
                    throw new Error('Cannot get login button position');
                }

                const loginX = loginBox.x + loginBox.width * (0.3 + Math.random() * 0.4);
                const loginY = loginBox.y + loginBox.height * (0.3 + Math.random() * 0.4);

                this.log(`🖱️ Moving to Login button (${Math.round(loginX)}, ${Math.round(loginY)})`);

                // Get current mouse position
                const currentPos = await page.evaluate(() => {
                    return { x: window.mouseX || 0, y: window.mouseY || 0 };
                });

                await this.moveMouseHumanLike(page, currentPos.x, currentPos.y, loginX, loginY);
                await this.sleep(100 + Math.random() * 200);
                await page.mouse.click(loginX, loginY);

                // Track mouse position
                await page.evaluate(({ x, y }) => {
                    window.mouseX = x;
                    window.mouseY = y;
                }, { x: loginX, y: loginY });

                this.log('✅ Login button clicked');

            } catch (err) {
                this.log(`⚠️ Cannot find button with role, trying alternative selector...`);

                // Fallback: dùng span text
                const loginSpan = page.locator('span:has-text("Log in"), span:has-text("Đăng nhập")').first();
                await loginSpan.waitFor({ state: 'visible', timeout: 10000 });
                await loginSpan.click({ delay: 200 });

                this.log('✅ Login button clicked (fallback method)');
            }

            this.log('⏳ Waiting for homepage...');

            // Fix: đợi element thay vì networkidle
            await page.waitForSelector('a[data-testid="SideNav_NewTweet_Button"]', {
                timeout: 30000
            });

            this.log('✅✅✅ LOGIN SUCCESS ✅✅✅');
            const newCookies = await context.cookies();
            await axios.post(`${config.updateCookie}`, {
                type: dto.type,
                cookie: JSON.stringify(newCookies)
            });
        }

        await page.close();
    }
}