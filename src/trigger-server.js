import express from 'express';
import {chromium} from 'playwright';

import {crawlPage} from './crawler/crawler.js';
import {PostGroup} from './PostGroup/PostGroup.js';
import {uploadExcel, updatePageCheckpoint} from './crawler/apiCrawler.js';
import {buildExcel} from './crawler/excel.js';
import {config} from './config.js';
import axios from "axios";

const app = express();
app.use(express.json());

let browser;
let context;

/**
 * ===== INIT BROWSER 1 LẦN =====
 */
async function initBrowser({rawCookie, username, password, type}) {

    if (!browser) {
        browser = await chromium.launch({
            headless: config.headless,
            args: ['--disable-blink-features=AutomationControlled']
        });
    }

    if (context) {
        await context.close();
    }

    context = await browser.newContext({
        viewport: {width: 1280, height: 800},
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        locale: 'en-US',
        timezoneId: 'Asia/Ho_Chi_Minh'
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false
        });
    });

    const page = await context.newPage();

    let cookieLoginSuccess = false;

    /**
     * ===== TRY COOKIE LOGIN =====
     */
    if (rawCookie) {
        try {
            const cookies = normalizeCookies(rawCookie);

            if (cookies.length > 0) {
                await context.addCookies(cookies);

                await page.goto('https://www.facebook.com/', {
                    waitUntil: 'domcontentloaded'
                });

                await page.waitForTimeout(3000);

                if (await isLoggedIn(context)) {
                    console.log('✅ Cookie login success');
                    cookieLoginSuccess = true;
                } else {
                    console.log('⚠ Cookie invalid (not logged in)');
                }
            }

        } catch (err) {
            console.log('❌ Cookie inject failed:', err.message);
        }
    }

    /**
     * ===== FALLBACK LOGIN WITH RETRY =====
     */
    if (!cookieLoginSuccess) {

        console.log('🔐 Fallback login');

        if (!username || !password) {
            throw new Error("Credential missing");
        }

        const MAX_RETRY = 3;
        let loginSuccess = false;

        for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {

            console.log(`🔁 Login attempt ${attempt}/${MAX_RETRY}`);

            try {

                await page.goto('https://www.facebook.com/login', {
                    waitUntil: 'domcontentloaded'
                });

                await page.waitForTimeout(3000);

                // Clear input trước khi fill lại
                await page.fill('input[name="email"]', '');
                await page.fill('input[name="pass"]', '');

                await page.fill('input[name="email"]', username);
                await page.fill('input[name="pass"]', password);

                await page.click('button[name="login"]');

                await page.waitForTimeout(8000);

                console.log("After login URL:", page.url());

                if (await isLoggedIn(context)) {
                    loginSuccess = true;
                    console.log('✅ Login success');
                    break;
                } else {
                    console.log(`❌ Login attempt ${attempt} failed`);
                }

            } catch (err) {
                console.log(`❌ Login error at attempt ${attempt}:`, err.message);
            }
        }

        if (!loginSuccess) {
            throw new Error("Login failed after 3 attempts");
        }

        const newCookies = await context.cookies();
        console.log('New cookies count:', newCookies.length);

        await updateCookie(type, newCookies); // bỏ stringify
    }

    await page.close();
}


async function isLoggedIn(context) {
    const cookies = await context.cookies();
    return cookies.some(c => c.name === 'c_user');
}

async function updateCookie(type, newCookies) {
    await axios.post(`${config.updateCookie}`, {
        type: type,
        cookie: JSON.stringify(newCookies)
    });
}


/**
 * ===== NORMALIZE COOKIE AN TOÀN =====
 */
function normalizeCookies(rawCookies) {

    if (!rawCookies) {
        return [];
    }

    if (typeof rawCookies === "string") {
        try {
            rawCookies = JSON.parse(rawCookies);
        } catch (e) {
            console.log("❌ Cookie JSON parse failed");
            return [];
        }
    }

    if (!Array.isArray(rawCookies)) {
        console.log("❌ Cookie is not array");
        return [];
    }

    return rawCookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || "/",
        httpOnly: !!c.httpOnly,
        secure: !!c.secure,
        sameSite: normalizeSameSite(c.sameSite),
        expires: c.expirationDate
            ? Math.floor(c.expirationDate)
            : undefined
    }));
}


/**
 * ===== FIX SAMESITE FORMAT =====
 */
function normalizeSameSite(value) {

    if (!value) return 'None';

    const v = String(value).toLowerCase();

    if (v === 'lax') return 'Lax';
    if (v === 'strict') return 'Strict';
    if (v === 'none' || v === 'no_restriction') return 'None';

    return 'None';
}


/**
 * ===== TRIGGER CRAWL API =====
 */
app.post('/trigger-crawl', async (req, res) => {

    try {

        const {
            id,
            last_image: lastImage,
            cookie: cookie,
            type: type,
            user_name: username,
            password: password
        } = req.body;

        console.log('🔥 request id:', id);
        console.log('🔥 request lastImage:', lastImage);

        if (!id || !lastImage) {
            return res.status(400).json({message: 'Missing id or lastImage'});
        }

        await initBrowser({
            rawCookie: cookie,
            username: username,
            password: password,
            type: type
        });

        console.log('\n===================================');
        console.log('🔥 TRIGGER CRAWL:', id);

        const {images, newLastUrl} =
            await crawlPage(
                {id, lastImage},
                context
            );

        if (!images.length) {
            console.log('⚠ Không có ảnh mới');

            return res.json({
                success: true,
                message: 'No new images'
            });
        }

        console.log(`📸 Collected ${images.length} images`);

        const excelFile = await buildExcel(id, images);

        console.log('📄 Excel created:', excelFile);

        await uploadExcel(excelFile);

        console.log('⬆ Excel uploaded');

        await updatePageCheckpoint(id, newLastUrl);

        console.log('🆕 Checkpoint updated');

        res.json({
            success: true,
            images: images.length
        });

    } catch (err) {

        console.error('❌ TRIGGER ERROR');
        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});


/**
 * ===== START SERVER =====
 */
const PORT = process.env.CRAWLER_PORT || 3001;

app.listen(PORT, () => {
    console.log(`🚀 Server running at ${PORT}`);
});


/**
 * ============================================================
 * ================= POST GROUP TRIGGER =======================
 * ============================================================
 */
app.post('/post_group', async (req, res) => {

    try {

        const {
            cookie,
            type,
            user_name,
            password,
            page_admin_url,
            content,
            url_image,
            url_groups
        } = req.body;

        if (!page_admin_url || !content || !url_groups?.length) {
            return res.status(400).json({message: 'Missing params'});
        }

        await initBrowser({
            rawCookie: cookie,
            username: user_name,
            password: password,
            type: type
        });

        const postGroup = new PostGroup(context);

        await postGroup.post({
            pageAdminUrl: page_admin_url,
            content: content,
            imageUrl: url_image,
            groupUrls: url_groups
        });

        res.json({
            success: true,
            message: "Posted to groups"
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});
