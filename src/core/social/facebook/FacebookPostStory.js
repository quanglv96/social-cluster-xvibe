import fs from 'fs';
import axios from 'axios';
import path from 'path';
import os from 'os';

import { DelayService } from '../../../services/delay.service.js';
import { config, runtimeConfig } from "../../../config/config.js";
import {nowIso} from "../../../utils/time.js";

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

const TAG = 'FB_POST_STORY';

export class FacebookPostStory {

    constructor(context) {
        this.context = context;
        this.delay = new DelayService();
    }

    /**
     * @param {object} params
     * @param {string} params.page_admin_url    - URL trang admin của Page
     * @param {string[]} params.list_image      - Danh sách URL ảnh story
     * @param {string} params.user_name
     * @param {string} params.password
     * @param {boolean} [params.profile=true]   - true: đăng story lên Profile
     * @param {boolean} [params.page=true]      - true: đăng story lên Page
     */
    async post({
                   page_admin_url,
                   list_image,
                   user_name,
                   password,
                   profile: shouldPostProfile = true,
                   page: shouldPostPage = true,
               }, page) {

        if (!page) {
            throw new Error("FacebookPostStory requires event page");
        }

        let tempFiles = [];

        try {
            log(TAG, `Start story posting`, {
                totalImages: list_image.length,
                shouldPostProfile,
                shouldPostPage,
            });

            await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
            await this.delay.navigation('after goto facebook', page);

            // ===== DOWNLOAD IMAGES =====
            for (const url of list_image) {
                const file = await this.downloadImage(url);
                tempFiles.push(file);
                log(TAG, `Image downloaded`, { url, filePath: file });
            }

            // ===== 1. POST TO PROFILE =====
            if (shouldPostProfile) {
                log(TAG, `Posting story to PROFILE`);
                await this.postStoryFlow(page, tempFiles, 'profile');
            } else {
                log(TAG, `Skip posting story to Profile (profile=false)`);
            }

            // ===== 2. SWITCH TO PAGE & POST =====
            if (shouldPostPage && page_admin_url) {
                log(TAG, `Switching to PAGE`);
                await this.switchToPage(page, page_admin_url);

                log(TAG, `Posting story to PAGE`);
                await this.postStoryFlow(page, tempFiles, 'page');

                await page.waitForTimeout(5000);
                await this.switchToProfile(page);
            } else {
                log(TAG, `Skip posting story to Page (page=false or no page_admin_url)`);
            }

            logOk(TAG, `Story process completed`);
            return { success: true, list_image: list_image };

        } finally {
            for (const file of tempFiles) {
                if (fs.existsSync(file)) fs.unlinkSync(file);
            }
            log(TAG, `Temporary files cleaned`, { count: tempFiles.length });
        }
    }

    async switchToProfile(page) {
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
        log(TAG, `Switching back to PROFILE`);

        try {
            const profileBtn = await page.waitForSelector(
                '[aria-label="Trang cá nhân của bạn"][role="button"]',
                { timeout: 10000 }
            );
            await profileBtn.click();
            log(TAG, `Clicked profile avatar`);
            await this.delay.action('after click avatar', page);

            const switchProfileBtn = await page.waitForSelector(
                '[aria-label^="Chuyển sang"]',
                { timeout: 10000 }
            );
            const label = await switchProfileBtn.getAttribute('aria-label');
            log(TAG, `Found switch profile button`, { label });

            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
                switchProfileBtn.click()
            ]);

            await this.delay.navigation('after switch to profile', page);
            logOk(TAG, `Switched back to PROFILE`, { currentUrl: page.url() });

        } catch (err) {
            logError(TAG, `Switch to PROFILE failed`, err);
        }
    }

    async postStoryFlow(page, filePaths, mode) {
        for (let i = 0; i < filePaths.length; i++) {
            log(TAG, `Posting story image`, { index: i + 1, total: filePaths.length, mode });

            if (mode === 'page') {
                await this.openCreateStoryPage(page);
            } else {
                await this.openCreateStoryProfile(page);
            }

            await this.uploadStoryByDrop(page, filePaths[i]);

            if (mode === 'page') {
                await this.addLinkButton(page, `${runtimeConfig.rootUrl}`);
            }

            await this.shareStory(page);
            logOk(TAG, `Story image posted`, { index: i + 1, mode });

            await this.delay.betweenGroup('cooldown between stories');
        }
    }

    async addLinkButton(page, url) {
        log(TAG, `Adding link button`, { url });

        const addBtn = page.locator('span:has-text("Thêm nút")').first();
        await addBtn.waitFor({ timeout: 15000 });
        await addBtn.click({ force: true });
        await page.waitForTimeout(2000);

        const webLinkRadio = page.locator('input[type="radio"][value="web link"]');
        await webLinkRadio.waitFor({ timeout: 10000 });
        await webLinkRadio.check({ force: true });
        await page.waitForTimeout(1000);

        const inputLink = page.locator('span:has-text("Nhập liên kết")').locator('xpath=ancestor::div[1]//input');
        await inputLink.fill(url, { force: true });
        await page.waitForTimeout(2000);

        logOk(TAG, `Link button added`, { url });
    }

    async switchToPage(page, pageAdminUrl) {
        log(TAG, `Switching to PAGE`, { pageAdminUrl });

        await page.goto(pageAdminUrl, { waitUntil: 'domcontentloaded' });
        await this.delay.navigation('after goto page admin', page);

        const switchBtn = await page.$('span:has-text("Chuyển ngay"), span:has-text("Switch Now")');

        if (!switchBtn) {
            logWarn(TAG, `Switch button not found, continue current profile`);
            return;
        }

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
            switchBtn.click()
        ]);

        await this.delay.navigation('after switch profile', page);
        logOk(TAG, `Profile switched`, { currentUrl: page.url() });

        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
        await this.delay.navigation('after goto facebook', page);
    }

    async openCreateStoryProfile(page) {
        const createStoryLink = page.locator(
            'a[href="/stories/create/"], a[aria-label="Tạo tin"], a[aria-label="Create story"]'
        ).first();

        await createStoryLink.waitFor({ state: 'visible', timeout: 15000 });
        await createStoryLink.click();

        await this.delay.action('after click create story', page);
        await this.delay.action('after click image story option', page);

        log(TAG, `Story profile editor opened`);
    }

    async openCreateStoryPage(page) {
        const createBtn = page.locator(
            'a[href="/stories/create/"], a[aria-label="Tạo tin"], a[aria-label="Create story"]'
        ).first();

        await createBtn.waitFor({ state: 'visible', timeout: 15000 });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            createBtn.click()
        ]);

        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(4000);

        log(TAG, `Story page editor opened`);
    }

    async uploadStoryByDrop(page, filePath) {
        log(TAG, `Uploading story via drop`, { filePath });

        const fileName = path.basename(filePath);
        const fileBase64 = fs.readFileSync(filePath, { encoding: 'base64' });

        const dataTransfer = await page.evaluateHandle(
            async ({ fileBase64, fileName }) => {
                const byteCharacters = atob(fileBase64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: 'image/jpeg' });
                const file = new File([blob], fileName, { type: 'image/jpeg' });
                const dt = new DataTransfer();
                dt.items.add(file);
                return dt;
            },
            { fileBase64, fileName }
        );

        await page.dispatchEvent('body', 'dragenter', { dataTransfer });
        await page.dispatchEvent('body', 'dragover', { dataTransfer });
        await page.dispatchEvent('body', 'drop', { dataTransfer });
        await page.waitForTimeout(5000);

        logOk(TAG, `Story image dropped`);
    }

    async shareStory(page) {
        log(TAG, `Sharing story...`);

        const shareBtn = page.locator('span:has-text("Chia sẻ lên tin")').locator('xpath=ancestor::div[1]');
        await shareBtn.waitFor({ timeout: 20000 });
        await shareBtn.click({ force: true });
        await page.waitForTimeout(5000);

        logOk(TAG, `Story shared`);
    }

    async downloadImage(url) {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const filePath = path.join(os.tmpdir(), `story_${Date.now()}_${Math.random()}.jpg`);
        await fs.promises.writeFile(filePath, response.data);
        return filePath;
    }
}