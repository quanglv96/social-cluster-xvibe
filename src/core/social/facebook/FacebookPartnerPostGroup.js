import fs from 'fs';
import axios from 'axios';
import path from 'path';
import os from 'os';

import {DelayService} from '../../../services/delay.service.js';
import {FacebookPostProfile} from "./FacebookPostProfile.js";
import {logCheckpoint} from "../../../services/logCheckpoint.js";
import {nowIso} from "../../../utils/time.js";

// =========================
// Log Utils
// =========================

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({type: 'LOG', data: {type, msg}});
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
    const msg = formatMsg(requestId, `❌ ${message}`, {error: err?.message || err});
    sendToRenderer('error', msg);
}

function logOk(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, `✅ ${message}`, fields);
    sendToRenderer('ok', msg);
}

// =========================
// Class
// =========================

export class FacebookPartnerPostGroup {

    constructor(context) {
        this.context = context;
        this.delay = new DelayService();
        this.profile = new FacebookPostProfile();
    }

    /**
     * 🔥 page được truyền từ SessionManager
     */
    async post({
                   page_admin_url: pageAdminUrl,
                   content,
                   list_image: listImage,   // ← list URL
                   url_groups: groupUrls
               }, page) {

        if (!page) {
            throw new Error("FacebookPostGroup requires an event page");
        }

        const TAG = 'FB_PARTNER_POST_GROUP';
        let tempFiles = []; // ← lưu tất cả path ảnh đã download

        try {
            log(TAG, `Start post process`, {
                totalGroups: groupUrls.length,
                totalImages: listImage?.length ?? 0,
            });

            // ===== DOWNLOAD TẤT CẢ ẢNH TRƯỚC =====
            if (listImage?.length) {
                for (const url of listImage) {
                    const filePath = await this.downloadImage(url);
                    tempFiles.push(filePath);
                    log(TAG, `Image downloaded`, {url, filePath});
                }
            }

            if (!pageAdminUrl) {
                throw new Error("FacebookPartnerPostGroup requires page_admin_url");
            }
            await this.switchToPage(page, pageAdminUrl, TAG);

            const groups = groupUrls.slice(0, 10);

            for (let i = 0; i < groups.length; i++) {
                const groupUrl = groups[i];

                try {
                    log(TAG, `Posting to group`, {
                        groupIndex: i + 1,
                        total: groups.length,
                        groupUrl,
                    });

                    await page.goto(groupUrl, {waitUntil: 'domcontentloaded'});
                    await this.delay.navigation('after goto group', page);

                    const postBox = await page.waitForSelector(
                        'span:has-text("Bạn viết gì đi..."), span:has-text("Write something"), span:has-text("What\'s on your mind")',
                        {timeout: 15000}
                    );
                    if (!postBox) throw new Error('Cannot find post box');

                    await postBox.click();
                    await this.delay.action('after click post box', page);

                    const textbox = await page.waitForSelector(
                        'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
                        {timeout: 10000}
                    );
                    if (!textbox) throw new Error('Cannot find textbox');

                    await textbox.click();
                    await this.delay.action('after focus textbox', page);

                    try {
                        await this.context.grantPermissions(['clipboard-read', 'clipboard-write']);
                        await page.evaluate(async (text) => {
                            await navigator.clipboard.writeText(text);
                        }, content);

                        await page.keyboard.press('Control+A');
                        await page.keyboard.press('Backspace');
                        await page.keyboard.press('Control+V');
                        await page.keyboard.press('Space'); // ✅ thêm space sau khi paste xong

                        log(TAG, 'Content pasted via clipboard');

                    } catch (e) {
                        logWarn(TAG, 'Clipboard failed, fallback to JS set');

                        await page.evaluate((text) => {
                            const el = document.querySelector(
                                'div[role="dialog"] div[role="textbox"][contenteditable="true"]'
                            );
                            if (el) {
                                el.focus();
                                el.innerHTML = '';

                                const lines = text.split('\n');
                                lines.forEach((line, index) => {
                                    const span = document.createElement('span');
                                    span.textContent = line;
                                    el.appendChild(span);
                                    if (index < lines.length - 1) {
                                        el.appendChild(document.createElement('br'));
                                    }
                                });
                                el.dispatchEvent(new InputEvent('input', {bubbles: true}));
                                el.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true}));
                                el.dispatchEvent(new KeyboardEvent('keyup', {bubbles: true}));
                            }
                        }, content);

                        // ✅ thêm space sau khi JS inject xong
                        await page.keyboard.press('Space');
                    }

                    log(TAG, `Content filled`);
                    await this.delay.action('after typing content', page);

                    // ===== UPLOAD TOÀN BỘ ẢNH CHO MỖI GROUP =====
                    if (tempFiles.length > 0) {
                        await this.uploadImageFiles(page, tempFiles, TAG);
                    }

                    // ✅ CHECKPOINT 1: Sau khi fill content + upload ảnh, trước khi đăng
                    await logCheckpoint(page, {
                        step: 'before_post',
                        message: `Ready to post partner group ${i + 1}/${groups.length} | ${groupUrl}`,
                    });
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
                            log(TAG, `Post button clicked`, {selector});
                            break;
                        }
                    }

                    if (!clicked) throw new Error('Cannot find enabled Post button');

                    // ✅ FIX: Chờ dialog đóng hẳn trước khi sang group tiếp
                    await page.waitForSelector('div[role="dialog"]', {
                        state: 'detached',
                        timeout: 15000
                    }).catch(() => logWarn(TAG, 'Dialog did not close in time'));

                    // ✅ CHECKPOINT 2: Sau khi đăng xong
                    await logCheckpoint(page, {
                        step: 'after_post',
                        message: `Post partner done - group ${i + 1}/${groups.length} | ${groupUrl}`,
                    });
                    logOk(TAG, `Post success`, {groupUrl});

                } catch (err) {
                    logError(TAG, `Post failed for group`, err);
                    // ✅ CHECKPOINT 3: Chụp lại màn hình khi fail để debug
                    await logCheckpoint(page, {
                        step: 'post_failed',
                        message: `Post partner failed - group ${i + 1}/${groups.length} | ${groupUrl} | error: ${err?.message}`,
                    });
                    // ✅ FIX: Escape để đóng dialog trước khi goto group tiếp
                    await page.keyboard.press('Escape').catch(() => {});
                    await this.delay.action('after escape', page);

                    logWarn(TAG, `Skipping group`, {groupUrl});
                }

                if (i < groups.length - 1) {
                    await this.delay.betweenGroup('cooldown between groups');
                }
            }

            logOk(TAG, `Post process completed`);

            await this.switchToProfile(page, TAG);

            return {success: true};

        } finally {
            // ===== XÓA TẤT CẢ FILE TẠM =====
            for (const filePath of tempFiles) {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        log(TAG, `Temp file deleted`, {filePath});
                    }
                } catch (e) {
                    logWarn(TAG, `Cannot delete temp file`, {filePath});
                }
            }
        }
    }

    async switchToProfile(page, TAG = 'FB_PARTNER_POST_GROUP') {
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
        log(TAG, `Switching back to PROFILE`);
        try {
            const profileBtn = await page.waitForSelector(
                '[aria-label="Trang cá nhân của bạn"][role="button"]',
                {timeout: 10000}
            );
            await profileBtn.click();
            log(TAG, `Clicked profile avatar`);
            await this.delay.action('after click avatar', page);

            const switchProfileBtn = await page.waitForSelector(
                '[aria-label^="Chuyển sang"]',
                {timeout: 10000}
            );

            const label = await switchProfileBtn.getAttribute('aria-label');
            log(TAG, `Found switch profile button`, {label});

            await Promise.all([
                page.waitForNavigation({waitUntil: 'domcontentloaded'}).catch(() => {
                }),
                switchProfileBtn.click()
            ]);

            await this.delay.navigation('after switch to profile', page);
            logOk(TAG, `Switched back to PROFILE`, {currentUrl: page.url()});

        } catch (err) {
            logError(TAG, `Switch to PROFILE failed`, err);
        }
    }

    async switchToPage(page, pageAdminUrl, TAG = 'FB_PARTNER_POST_GROUP') {
        log(TAG, `Switching to PAGE`, {pageAdminUrl});

        await page.goto(pageAdminUrl, {waitUntil: 'domcontentloaded'});
        await this.delay.navigation('after goto page admin', page);

        const switchBtn = await page.$(
            'span:has-text("Chuyển ngay"), span:has-text("Switch Now")'
        );

        if (!switchBtn) {
            logWarn(TAG, `Switch button not found, continue current profile`);
            return;
        }

        await Promise.all([
            page.waitForNavigation({waitUntil: 'domcontentloaded'}).catch(() => {
            }),
            switchBtn.click()
        ]);

        await this.delay.navigation('after switch profile', page);
        logOk(TAG, `Profile switched`, {currentUrl: page.url()});
    }

    async downloadImage(url) {
        const response = await axios.get(url, {responseType: 'arraybuffer'});
        const filePath = path.join(os.tmpdir(), `temp_image_${Date.now()}.jpg`);
        await fs.promises.writeFile(filePath, response.data);
        return filePath;
    }

    async uploadImageFiles(page, filePaths, TAG = 'FB_POST_GROUP') {
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

        // ← setInputFiles nhận array, upload tất cả 1 lần
        await inputFile.setInputFiles(filePaths);
        await this.delay.upload('after image upload');
        logOk(TAG, `Images uploaded`, {count: filePaths.length});
    }
}