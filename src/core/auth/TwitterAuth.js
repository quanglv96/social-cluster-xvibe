import {BaseAuth} from './BaseAuth.js';
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
        await locator.waitFor({state: 'visible', timeout: 30000});
        await locator.click({delay: 200});
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

                await usernameInput.waitFor({state: 'visible', timeout: 10000});

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
                if (attempt === 2) {
                    this.log(`👆 attempt 2-> enter`);
                    await page.keyboard.press('Enter');
                } else {
                    // ✅ Click ra ngoài với human movement
                    this.log(`👆 Clicking outside to trigger validation...`);


                    // Di chuyển chuột đến vùng trống và click
                    const box = await usernameInput.boundingBox();
                    const outsideX = box.x + box.width + 50;
                    const outsideY = box.y + 50;

                    await page.mouse.move(outsideX, outsideY, {steps: 20});
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
                    const nextButton = page.getByRole('button', {name: 'Next'}).first();
                    await nextButton.waitFor({state: 'visible', timeout: 10000});

                    const nextBox = await nextButton.boundingBox();
                    if (!nextBox) {
                        throw new Error('Cannot get Next button position');
                    }

                    const nextX = nextBox.x + nextBox.width * (0.3 + Math.random() * 0.4);
                    const nextY = nextBox.y + nextBox.height * (0.3 + Math.random() * 0.4);

                    this.log(`🖱️ Moving to Next button (${Math.round(nextX)}, ${Math.round(nextY)})`);

                    // Get current mouse position
                    const currentPos = await page.evaluate(() => {
                        return {x: window.mouseX || 0, y: window.mouseY || 0};
                    });

                    await this.moveMouseHumanLike(page, currentPos.x, currentPos.y, nextX, nextY);
                    await this.sleep(100 + Math.random() * 200);
                    await page.mouse.click(nextX, nextY);

                    // Track mouse position
                    await page.evaluate(({x, y}) => {
                        window.mouseX = x;
                        window.mouseY = y;
                    }, {x: nextX, y: nextY});

                    this.log(`✅ Next button clicked`);

                    this.log(`⏳ Waiting for next state (10s timeout)...`);
                    await this.sleep(2000);
                }

                const result = await Promise.race([
                    page.waitForSelector('input[name="password"]', {timeout: 10000}).then(() => 'PASSWORD'),
                    page.waitForSelector('input[name="text"]', {timeout: 10000}).then(() => 'USERNAME_AGAIN'),
                    page.waitForSelector('input[data-testid="ocfEnterTextTextInput"]', {timeout: 10000}).then(() => 'PHONE_VERIFICATION')
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
        await element.waitFor({state: 'visible', timeout: 10000});

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
            return {x: window.mouseX || 0, y: window.mouseY || 0};
        });

        this.log(`🖱️ Moving from (${Math.round(currentPos.x)}, ${Math.round(currentPos.y)}) to (${Math.round(targetX)}, ${Math.round(targetY)})`);

        await this.moveMouseHumanLike(page, currentPos.x, currentPos.y, targetX, targetY);

        // Đợi một chút trước khi click
        await this.sleep(100 + Math.random() * 200);

        // Click
        await page.mouse.click(targetX, targetY);

        // ✅ FIX: Track vị trí chuột - wrap arguments trong object
        await page.evaluate(({x, y}) => {
            window.mouseX = x;
            window.mouseY = y;
        }, {x: targetX, y: targetY});

        this.log(`✅ Clicked at (${Math.round(targetX)}, ${Math.round(targetY)})`);
    }

    async authenticate(context, dto) {
        const { cookie, user_name, password } = dto;

        const page = await context.newPage();

        this.log('🚀 START AUTH');

        try {

            // 👉 STEP 0: Cookie login
            let loggedIn = false;

            if (cookie) {
                loggedIn = await this.tryCookieLogin(context, page, cookie);
            }

            // 👉 STEP 1: Manual login
            if (!loggedIn) {

                if (!user_name || !password) {
                    throw new Error('Missing credentials');
                }

                // random delay chống pattern
                await this.sleep(2000 + Math.random() * 2000);

                this.log('━━━━━━━━━━━━━━━━━━');
                this.log('📍 STEP 1: OPEN LOGIN PAGE');

                await this.ensureLoginPage(page);

                await this.sleep(2000);

                // 👉 STEP 2: USERNAME
                this.log('━━━━━━━━━━━━━━━━━━');
                this.log('📍 STEP 2: USERNAME');

                await this.inputUsernameWithRetry(page, user_name);

                await this.sleep(2000);

                // 👉 STEP 3: PASSWORD
                this.log('━━━━━━━━━━━━━━━━━━');
                this.log('📍 STEP 3: PASSWORD');

                await this.humanType(page, 'input[name="password"]', password);

                await this.sleep(1000);

                // 👉 STEP 4: CLICK LOGIN
                this.log('━━━━━━━━━━━━━━━━━━');
                this.log('📍 STEP 4: LOGIN CLICK');

                const loginButton = page.getByRole('button', {
                    name: /Log in|Đăng nhập/i
                }).first();

                await loginButton.waitFor({ state: 'visible', timeout: 10000 });

                const box = await loginButton.boundingBox();
                if (!box) throw new Error('No login button box');

                const x = box.x + box.width * 0.5;
                const y = box.y + box.height * 0.5;

                await page.mouse.click(x, y);

                this.log('⏳ Waiting for home...');

                await page.waitForSelector(
                    'a[data-testid="SideNav_NewTweet_Button"]',
                    { timeout: 30000 }
                );

                this.log('✅ LOGIN SUCCESS');

                // 👉 SAVE COOKIE
                const newCookies = await context.cookies();

                await axios.post(`${config.updateCookie}`, {
                    type: dto.type,
                    cookie: JSON.stringify(newCookies)
                });
            }

        } catch (err) {

            this.log(`💥 AUTH FAILED: ${err.message}`);

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
            this.log('🍪 Trying cookie login...');

            const cookies = typeof cookie === 'string'
                ? JSON.parse(cookie)
                : cookie;

            if (!Array.isArray(cookies)) {
                throw new Error('Invalid cookie format');
            }

            await context.addCookies(cookies);

            await this.safeGoto(page, 'https://x.com/home');

            await this.sleep(4000);

            if (await page.$('a[data-testid="SideNav_NewTweet_Button"]')) {
                this.log('✅ Cookie login success');
                return true;
            }

        } catch (err) {
            this.log(`⚠️ Cookie login failed: ${err.message}`);
        }

        return false;
    }
    async ensureLoginPage(page) {
        const maxRetry = 2;

        for (let i = 1; i <= maxRetry; i++) {
            try {
                this.log(`📍 Ensure login page attempt ${i}`);

                await this.safeGoto(page, 'https://x.com/login');

                await page.waitForSelector('input[name="text"]', {
                    timeout: 10000
                });

                this.log('✅ Login page ready');
                return;

            } catch (err) {
                this.log(`❌ Ensure login page fail ${i}: ${err.message}`);

                if (i === maxRetry) throw err;

                // thử reload nếu page có nội dung
                try {
                    if (page.url() !== 'about:blank') {
                        this.log('🔄 Trying reload...');
                        await page.reload({
                            waitUntil: 'domcontentloaded',
                            timeout: 30000
                        });
                    }
                } catch (e) {
                    this.log(`⚠️ Reload also failed`);
                }

                await this.sleep(2000 + Math.random() * 2000);
            }
        }
    }

    async safeGoto(page, url, options = {}) {
        const maxRetry = 3;

        for (let i = 1; i <= maxRetry; i++) {
            try {
                this.log(`🌐 GOTO attempt ${i}: ${url}`);

                await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000,
                    ...options
                });

                const content = await page.content();

                // Detect blank / blocked
                if (page.url() === 'about:blank' || content.length < 1000) {
                    throw new Error('Empty or blank page');
                }

                this.log('✅ GOTO success');
                return;

            } catch (err) {
                this.log(`❌ GOTO fail ${i}: ${err.message}`);

                if (i === maxRetry) throw err;

                await this.sleep(2000 + Math.random() * 3000);
            }
        }
    }
}