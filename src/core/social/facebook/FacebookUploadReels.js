import fs from 'fs';
import axios from 'axios';
import path from 'path';
import os from 'os';

import { DelayService } from '../../../services/delay.service.js';
import {runtimeConfig} from "../../../config/config.js";

// =========================
// Log Utils
// =========================

function nowIso() { return new Date().toISOString(); }
function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}
function sendToRenderer(type, msg) { process.send?.({ type: 'LOG', data: { type, msg } }); }
function log(requestId, message, fields = {})   { sendToRenderer('info',  formatMsg(requestId, message,          fields)); }
function logWarn(requestId, message, fields = {}){ sendToRenderer('warn',  formatMsg(requestId, `⚠️ ${message}`,  fields)); }
function logError(requestId, message, err)       { sendToRenderer('error', formatMsg(requestId, `❌ ${message}`,  { error: err?.message || err })); }
function logOk(requestId, message, fields = {})  { sendToRenderer('ok',    formatMsg(requestId, `✅ ${message}`,  fields)); }

// =========================

const TAG = 'FB_UPLOAD_REELS';

const UPLOAD_TIMEOUT_MS   = 120_000; // 2 phút chờ upload xong
const UPLOAD_POLL_MS      = 3_000;   // poll mỗi 3s

export class FacebookUploadReels {

    constructor(context) {
        this.context = context;
        this.delay   = new DelayService();
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ------------------------------------------------
    // Entry point
    // ------------------------------------------------
    /**
     * @param {object} dto
     * @param {string} dto.source  - URL video cần upload
     * @param {string} dto.content    - Mô tả reels
     * @param {import('playwright').Page} page
     */
    async upload({source: mediaId, content: caption}, page) {
        if (!page)      throw new Error('FacebookUploadReels requires a Playwright page');
        if (!mediaId) throw new Error('video_url is required');

        let tempFile = null;

        try {
            log(TAG, `🚀 START reels upload`, { video_url: mediaId.slice(0, 60), caption: caption?.slice(0, 40) });

            // STEP 1: Download video
            log(TAG, `STEP 1: Downloading video...`);
            tempFile = await this.downloadVideo(mediaId);
            logOk(TAG, `Video downloaded`, { filePath: tempFile });

            // STEP 2: Click nút "Đăng video" trên newsfeed
            log(TAG, `STEP 2: Click video post button`);
            await this.clickVideoPostButton(page);

            // STEP 3: Drop video vào giữa màn hình
            log(TAG, `STEP 3: Drop video file`);
            await this.dropVideoFile(page, tempFile);

            // STEP 4: Chờ upload xong rồi click "Tiếp" lần 1
            log(TAG, `STEP 4: Wait upload + click Tiếp (1)`);
            await this.waitForUploadAndClickNext(page);

            // STEP 5: Nhập caption
            log(TAG, `STEP 5: Fill caption`);
            await this.fillCaption(page, caption);

            // STEP 6: Click "Tiếp" lần 2
            log(TAG, `STEP 6: Click Tiếp (2)`);
            await this.clickNext(page);

            // STEP 7: Click "Đăng"
            log(TAG, `STEP 7: Click Đăng`);
            await this.clickPost(page);

            logOk(TAG, `🎉 Reels upload complete`);
            return { success: true};

        } finally {
            this.safeDeleteFile(tempFile);
        }
    }

    // ------------------------------------------------
    // STEP 2: Click nút đăng video trên newsfeed
    // ------------------------------------------------
    async clickVideoPostButton(page) {
        log(TAG, `Looking for video post button...`);
        await page.goto('https://www.facebook.com/reels/create', {
            waitUntil: 'domcontentloaded'
        });
        // chờ UI reels thật sự load
        await page.waitForSelector('text=Thêm video', { timeout: 20000 });

        logOk(TAG, `Reels uploader ready`);
        logOk(TAG, `Video post button clicked`, { url: currentUrl });
    }

    // ------------------------------------------------
    // STEP 3: Drop video vào giữa màn hình
    // ------------------------------------------------
    async dropVideoFile(page, filePath) {
        log(TAG, `Uploading via input file`, { filePath });

        const input = page.locator('input[type="file"]').first();

        await input.setInputFiles(filePath);

        logOk(TAG, `File selected`);
        await this.sleep(3000);
    }

    // ------------------------------------------------
    // STEP 4: Poll chờ upload xong → click "Tiếp" lần 1
    // ------------------------------------------------
    async waitForUploadAndClickNext(page) {
        log(TAG, `Waiting for video upload to complete...`, {
            timeout: `${UPLOAD_TIMEOUT_MS / 1000}s`,
        });

        const startTime = Date.now();

        while (true) {
            const elapsed = Date.now() - startTime;

            if (elapsed > UPLOAD_TIMEOUT_MS) {
                throw new Error(`Upload timed out after ${UPLOAD_TIMEOUT_MS / 1000}s`);
            }

            // Kiểm tra nút "Tiếp" đã enabled chưa
            const nextBtn = page.locator('div[aria-label="Tiếp"][role="button"]').first();
            const exists  = await nextBtn.count();

            if (exists > 0) {
                const isDisabled = await nextBtn.evaluate(el =>
                    el.getAttribute('aria-disabled') === 'true'
                );

                if (!isDisabled) {
                    logOk(TAG, `Upload done, clicking Tiếp (1)`, { elapsed: `${Math.round(elapsed / 1000)}s` });
                    await nextBtn.click();
                    await this.sleep(1500);
                    return;
                }
            }

            if (elapsed % 15000 < UPLOAD_POLL_MS) {
                log(TAG, `Still uploading...`, { elapsed: `${Math.round(elapsed / 1000)}s` });
            }

            await this.sleep(UPLOAD_POLL_MS);
        }
    }

    // ------------------------------------------------
    // STEP 5: Nhập caption vào lexical editor
    // ------------------------------------------------
    async fillCaption(page, caption) {
        if (!caption) {
            log(TAG, `No caption — skipping`);
            return;
        }

        log(TAG, `Filling caption...`, { length: caption.length });

        const editor = page.locator('div[contenteditable="true"][data-lexical-editor="true"]').first();
        await editor.waitFor({ state: 'visible', timeout: 15000 });

        await editor.click();
        await this.sleep(400);

        // Xóa nội dung cũ
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await this.sleep(300);

        // Gõ từng ký tự
        for (const char of caption) {
            await page.keyboard.type(char, { delay: 30 + Math.random() * 50 });
        }

        await this.sleep(800);
        logOk(TAG, `Caption filled`);
    }

    // ------------------------------------------------
    // STEP 6: Click "Tiếp" lần 2 (sau caption)
    // ------------------------------------------------
    async clickNext(page) {
        log(TAG, `Clicking Tiếp (2)...`);

        // Tìm button chứa span text "Tiếp" (không phải aria-label vì lần 2 khác DOM)
        const nextBtn = page.locator('div[role="button"]:has(span:has-text("Tiếp"))').last();
        await nextBtn.waitFor({ state: 'visible', timeout: 10000 });

        const isDisabled = await nextBtn.evaluate(el =>
            el.getAttribute('aria-disabled') === 'true'
        );
        if (isDisabled) throw new Error('Tiếp button (2) is disabled');

        await nextBtn.click();
        await this.sleep(1500);

        logOk(TAG, `Tiếp (2) clicked`);
    }

    // ------------------------------------------------
    // STEP 7: Click "Đăng"
    // ------------------------------------------------
    async clickPost(page) {
        log(TAG, `Clicking Đăng...`);

        const postBtn = page.locator('div[role="button"]:has(span:has-text("Đăng"))').last();
        await postBtn.waitFor({ state: 'visible', timeout: 10000 });

        const isDisabled = await postBtn.evaluate(el =>
            el.getAttribute('aria-disabled') === 'true'
        );
        if (isDisabled) throw new Error('Đăng button is disabled');

        await postBtn.click();
        await this.sleep(3000);

        logOk(TAG, `Đăng clicked — reels posted`);
    }

    // ------------------------------------------------
    // Download video về /tmp
    // ------------------------------------------------
    async downloadVideo(mediaId) {
        const url = runtimeConfig.api.apiGetVideo+"/" + mediaId
        log(TAG, `URL GET VIDEO: ${url}`);
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 120_000,
        });

        const filePath = path.join(
            os.tmpdir(),
            `fb_reels_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`
        );

        try {
            await fs.promises.writeFile(filePath, response.data);
        } catch (err) {
            this.safeDeleteFile(filePath);
            throw err;
        }

        const sizeKB = Math.round(response.data.byteLength / 1024);
        logOk(TAG, `Video downloaded`, { sizeKB: `${sizeKB}KB` });
        return filePath;
    }

    // ------------------------------------------------
    // Xóa file an toàn
    // ------------------------------------------------
    safeDeleteFile(filePath) {
        if (!filePath) return;
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logOk(TAG, `Temp file deleted`, { filePath });
            }
        } catch (err) {
            logWarn(TAG, `Failed to delete temp file`, { error: err.message });
        }
    }
}