import fs from 'fs';
import axios from 'axios';
import path from 'path';
import os from 'os';

import { DelayService } from '../../../services/delay.service.js';
import { FacebookPostProfile } from "./FacebookPostProfile.js";
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

export class FacebookPostGroup {

    constructor(context) {
        this.context = context;
        this.delay = new DelayService();
        this.profile = new FacebookPostProfile();
    }

    /**
     * @param {object} params
     * @param {string} params.page_admin_url   - URL trang admin của Page
     * @param {string} params.content          - Nội dung bài đăng
     * @param {string} params.url_image        - URL ảnh (optional)
     * @param {string[]} params.url_groups     - Danh sách URL các nhóm
     * @param {boolean} [params.page=true]     - true: đăng lên Page trước khi post groups
     * @param {boolean} [params.profile=true]  - true: đăng lên Profile trước khi post groups
     */
    async post({
                   page_admin_url: pageAdminUrl,
                   content,
                   url_image: imageUrl,
                   url_groups: groupUrls,
                   page: shouldPostPage = true,
                   profile: shouldPostProfile = true,
               }, page) {

        if (!page) {
            throw new Error("FacebookPostGroup requires an event page");
        }

        const TAG = 'FB_POST_GROUP';
        let imageFilePath = null;

        try {
            log(TAG, `Start post process`, {
                totalGroups: groupUrls.length,
                hasImage: !!imageUrl,
                shouldPostPage,
                shouldPostProfile,
            });

            // ===== DOWNLOAD IMAGE ONCE =====
            if (imageUrl) {
                log(TAG, `Downloading image...`, { url: imageUrl });
                imageFilePath = await this.downloadImage(imageUrl);
                logOk(TAG, `Image downloaded`, { filePath: imageFilePath });
            }

            // ===== POST TO PROFILE =====
            if (shouldPostProfile) {
                await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
                await this.delay.navigation('after goto home', page);

                try {
                    await this.profile.postToProfile(page, content, imageFilePath);
                } catch (err) {
                    logError(TAG, `Profile post failed`, err);
                }
            } else {
                log(TAG, `Skip posting to Profile (profile=false)`);
            }

            // ===== SWITCH TO PAGE =====
            if (shouldPostPage && pageAdminUrl) {
                await this.switchToPage(page, pageAdminUrl, TAG);
            } else {
                log(TAG, `Skip switching to Page (page=false or no pageAdminUrl)`);
            }

            // ===== POST TO GROUPS =====
            const groups = groupUrls.slice(0, 10);

            for (let i = 0; i < groups.length; i++) {
                const groupUrl = groups[i];

                try {
                    log(TAG, `Posting to group`, {
                        groupIndex: i + 1,
                        total: groups.length,
                        groupUrl,
                    });

                    await page.goto(groupUrl, { waitUntil: 'domcontentloaded' });
                    await this.delay.navigation('after goto group', page);

                    const postBox = await page.waitForSelector(
                        'span:has-text("Bạn viết gì đi..."), span:has-text("Write something"), span:has-text("What\'s on your mind")',
                        { timeout: 15000 }
                    );

                    if (!postBox) throw new Error('Cannot find post box');

                    await postBox.click();
                    log(TAG, `Post box clicked`);
                    await this.delay.action('after click post box', page);

                    const textbox = await page.waitForSelector(
                        'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
                        { timeout: 10000 }
                    );

                    if (!textbox) throw new Error('Cannot find textbox');

                    await textbox.click();
                    await this.delay.action('after focus textbox', page);

                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');
                    await textbox.type(content, { delay: this.delay.random(40, 120) });

                    log(TAG, `Content filled`);
                    await this.delay.action('after typing content', page);

                    if (imageFilePath) {
                        await this.uploadImageFile(page, imageFilePath, TAG);
                    }

                    const postBtnSelectors = [
                        'div[role="dialog"] div[aria-label="Đăng"]',
                        'div[role="dialog"] div[aria-label="Post"]',
                        'div[role="dialog"] div[role="button"]:has-text("Đăng")',
                        'div[role="dialog"] div[role="button"]:has-text("Post")',
                    ];

                    let clicked = false;
                    for (const selector of postBtnSelectors) {
                        const btn = await page.$(selector);
                        if (!btn) continue;

                        const isDisabled = await btn.evaluate(el =>
                            el.getAttribute('aria-disabled') === 'true'
                        );

                        if (!isDisabled) {
                            await btn.click();
                            clicked = true;
                            log(TAG, `Post button clicked`, { selector });
                            break;
                        }
                    }

                    if (!clicked) throw new Error('Cannot find enabled Post button');

                    await this.delay.navigation('after click post button', page);
                    logOk(TAG, `Post success`, { groupUrl });

                } catch (err) {
                    logError(TAG, `Post failed for group`, err);
                    logWarn(TAG, `Skipping group`, { groupUrl });
                }

                if (i < groups.length - 1) {
                    await this.delay.betweenGroup('cooldown between groups');
                }
            }

            logOk(TAG, `Post process completed`);

            // ===== SWITCH BACK TO PROFILE =====
            if (shouldPostPage && pageAdminUrl) {
                await this.switchToProfile(page, TAG);
            }

            return { success: true };

        } finally {
            if (imageFilePath && fs.existsSync(imageFilePath)) {
                fs.unlinkSync(imageFilePath);
                log('FB_POST_GROUP', `Temporary image deleted`, { imageFilePath });
            }
        }
    }

    async switchToProfile(page, TAG = 'FB_POST_GROUP') {
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

    async switchToPage(page, pageAdminUrl, TAG = 'FB_POST_GROUP') {
        log(TAG, `Switching to PAGE`, { pageAdminUrl });

        await page.goto(pageAdminUrl, { waitUntil: 'domcontentloaded' });
        await this.delay.navigation('after goto page admin', page);

        const switchBtn = await page.$(
            'span:has-text("Chuyển ngay"), span:has-text("Switch Now")'
        );

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
    }

    async downloadImage(url) {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const filePath = path.join(os.tmpdir(), `temp_image_${Date.now()}.jpg`);
        await fs.promises.writeFile(filePath, response.data);
        return filePath;
    }

    async uploadImageFile(page, filePath, TAG = 'FB_POST_GROUP') {
        const inputFileSelectors = [
            'div[role="dialog"] input[type="file"][accept*="image"]',
            'div[role="dialog"] input[type="file"]',
            'input[type="file"][accept*="image"]',
            'input[type="file"]'
        ];

        let inputFile = null;
        for (const selector of inputFileSelectors) {
            inputFile = await page.$(selector);
            if (inputFile) break;
        }

        if (!inputFile) throw new Error("Cannot find file input");

        await inputFile.setInputFiles(filePath);
        await this.delay.upload('after image upload');
        logOk(TAG, `Image uploaded successfully`);
    }
}