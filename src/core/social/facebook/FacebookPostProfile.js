import fs from 'fs';
import axios from 'axios';
import path from 'path';
import os from 'os';

import { DelayService } from '../../../services/delay.service.js';
import { logCheckpoint } from "../../../services/logCheckpoint.js";

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

const TAG = 'FB_POST_PROFILE';

export class FacebookPostProfile {

    constructor(context) {
        this.context = context;
        this.delay = new DelayService();
    }

    async post({ content, url_image: imageUrl }, page) {

        if (!page) {
            throw new Error("FacebookPostProfile requires an event page");
        }

        let imageFilePath = null;

        try {
            log(TAG, `Start post process`, { hasImage: !!imageUrl });

            // ===== DOWNLOAD IMAGE ONCE =====
            if (imageUrl) {
                log(TAG, `Downloading image...`, { url: imageUrl });
                imageFilePath = await this.downloadImage(imageUrl);
                logOk(TAG, `Image downloaded`, { filePath: imageFilePath });
            }

            // ===== POST TO PROFILE =====
            await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
            await this.delay.navigation('after goto home', page);

            await this.postToProfile(page, content, imageFilePath);

            logOk(TAG, `Post process completed`);
            return { success: true };

        } finally {
            if (imageFilePath && fs.existsSync(imageFilePath)) {
                fs.unlinkSync(imageFilePath);
                log(TAG, `Temporary image deleted`, { imageFilePath });
            }
        }
    }

    async postToProfile(page, content, imageFilePath) {

        log(TAG, `Start posting to PROFILE timeline`);

        // ===== CLICK POST BOX =====
        await this.step(page, 'click_post_box', async () => {
            const postBox = await page.waitForSelector(
                'div[role="button"]:has(span:has-text("nghĩ gì")), \
                 div[role="button"]:has(span:has-text("What\'s on your mind"))',
                { timeout: 30000 }
            );

            if (!postBox) throw new Error('Cannot find profile post box');

            await postBox.click();
            await this.delay.action('after click profile post box', page);
        });

        // ===== FIND TEXTBOX & FILL CONTENT =====
        await this.step(page, 'fill_content', async () => {
            const textbox = await page.waitForSelector(
                'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
                { timeout: 20000 }
            );

            if (!textbox) throw new Error('Cannot find profile textbox');

            await textbox.click();
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Backspace');
            await textbox.type(content, { delay: this.delay.random(40, 120) });
        });

        log(TAG, `Profile content filled`);
        await this.delay.action('after typing profile content', page);

        // ===== UPLOAD IMAGE =====
        if (imageFilePath) {
            await this.uploadImageFile(page, imageFilePath);
        }

        const postSelectors = [
            'div[role="dialog"] div[aria-label="Đăng"]',
            'div[role="dialog"] div[aria-label="Post"]',
            'div[role="dialog"] div[role="button"]:has-text("Đăng")',
            'div[role="dialog"] div[role="button"]:has-text("Post")',
        ];

        const nextSelectors = [
            'div[role="dialog"] div[aria-label="Tiếp"]',
            'div[role="dialog"] div[aria-label="Next"]',
            'div[role="dialog"] div[role="button"]:has-text("Tiếp")',
            'div[role="dialog"] div[role="button"]:has-text("Next")',
        ];

        const clickIfEnabled = async (selectors) => {
            for (const selector of selectors) {
                const btn = await page.$(selector);
                if (!btn) continue;
                const isDisabled = await btn.evaluate(el =>
                    el.getAttribute('aria-disabled') === 'true'
                );
                if (!isDisabled) {
                    await btn.click();
                    return true;
                }
            }
            return false;
        };

        // ===== POST FLOW =====
        await this.step(page, 'post_flow', async () => {

            // 1. TRY POST FIRST
            const posted = await clickIfEnabled(postSelectors);
            if (posted) return;

            // 2. CLICK NEXT
            const clickedNext = await clickIfEnabled(nextSelectors);
            if (!clickedNext) throw new Error('Cannot find enabled Next button');

            // 3. WAIT POST APPEAR
            await page.waitForSelector(
                'div[role="dialog"] div[aria-label="Đăng"]:not([aria-disabled="true"]), \
                 div[role="dialog"] div[aria-label="Post"]:not([aria-disabled="true"])',
                { timeout: 15000 }
            );

            // 4. CLICK POST
            const postedAfterNext = await clickIfEnabled(postSelectors);
            if (!postedAfterNext) throw new Error('Post button appeared but cannot click');
        });

        await page.waitForTimeout(5000);
        await logCheckpoint(page, { step: 'verify post profile' });
        await this.delay.navigation('after click profile post', page);

        logOk(TAG, `Profile post success`);
    }

    async step(page, stepName, action, meta = {}) {
        log(TAG, `STEP START: ${stepName}`);
        try {
            const result = await action();
            await logCheckpoint(page, { step: stepName, message: 'success', meta });
            logOk(TAG, `STEP DONE: ${stepName}`);
            return result;
        } catch (err) {
            await logCheckpoint(page, {
                step: stepName,
                message: 'error',
                meta: { ...meta, error: err.message, stack: err.stack }
            });
            logError(TAG, `STEP ERROR: ${stepName}`, err);
            throw err;
        }
    }

    async downloadImage(url) {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const filePath = path.join(os.tmpdir(), `temp_image_${Date.now()}.jpg`);
        await fs.promises.writeFile(filePath, response.data);
        return filePath;
    }

    async uploadImageFile(page, filePath) {
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