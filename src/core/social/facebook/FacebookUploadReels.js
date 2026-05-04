import fs from 'fs';
import axios from 'axios';
import path from 'path';
import os from 'os';

import { DelayService } from '../../../services/delay.service.js';
import {runtimeConfig} from "../../../config/config.js";
import {nowIso} from "../../../utils/time.js";

// =========================
// Log Utils
// =========================

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}
function sendToRenderer(type, msg) { process.send?.({ type: 'LOG', data: { type, msg } }); }
function log(requestId, message, fields = {})    { sendToRenderer('info',  formatMsg(requestId, message,          fields)); }
function logWarn(requestId, message, fields = {}) { sendToRenderer('warn',  formatMsg(requestId, `⚠️ ${message}`,  fields)); }
function logError(requestId, message, err)        { sendToRenderer('error', formatMsg(requestId, `❌ ${message}`,  { error: err?.message || err })); }
function logOk(requestId, message, fields = {})   { sendToRenderer('ok',    formatMsg(requestId, `✅ ${message}`,  fields)); }

// =========================

const TAG = 'FB_UPLOAD_REELS';

const UPLOAD_TIMEOUT_MS = 120_000; // 2 phút chờ upload xong
const UPLOAD_POLL_MS    = 3_000;   // poll mỗi 3s

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
     * @param {string} dto.content - Mô tả reels
     * @param {import('playwright').Page} page
     */
    async upload({ source: mediaId, content: caption }, page) {
        if (!page)    throw new Error('FacebookUploadReels requires a Playwright page');
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
            return { success: true };

        } finally {
            // FIX 1: Chỉ xóa file sau khi toàn bộ flow hoàn thành hoặc thật sự lỗi
            // (finally vẫn chạy đúng, nhưng tempFile lúc này đã được dùng xong)
            this.safeDeleteFile(tempFile);
        }
    }

    // ------------------------------------------------
    // STEP 2: Click nút đăng video trên newsfeed
    // ------------------------------------------------
    async clickVideoPostButton(page) {
        log(TAG, `Looking for Reels (Thước phim) button...`);

        // 1. Scope vào khu vực main feed
        const main = page.locator('[role="main"]').first();

        // 2. Tìm composer (box tạo bài viết)
        const composer = main.locator('div:has-text("Bạn đang nghĩ gì")').first();

        // 3. Trong composer → tìm đúng nút Thước phim
        const btn = composer
            .locator('div[role="button"][aria-label="Thước phim"]')
            .filter({ has: page.locator('img[src*="DgIQti9Y0Xv"]') })
            .first();

        const count = await btn.count();
        log(TAG, `Reels button found`, { count });

        if (count === 0) {
            throw new Error('Không tìm thấy nút "Thước phim" trong composer');
        }

        await btn.waitFor({ state: 'visible', timeout: 10000 });

        // 4. Scroll + click chuẩn
        await btn.scrollIntoViewIfNeeded();
        await this.delay.action('before click reels button', page);

        await btn.click({ delay: this.delay.random(80, 200) });

        logOk(TAG, `Clicked Reels button`, { url: page.url() });

        // FIX 3: Không dùng waitForSelector chung chung (có thể match dialog cũ).
        // Thay bằng waitForFunction — chờ dialog mới chứa text "Thêm video" visible.
        await page.waitForFunction(() => {
            const dialogs = document.querySelectorAll('div[role="dialog"]');
            return [...dialogs].some(
                d => d.offsetParent !== null && d.innerText?.includes('Thêm video')
            );
        }, { timeout: 20000 });

        await this.delay.navigation('after open reels modal', page);

        logOk(TAG, `Reels modal opened`);
    }

    // ------------------------------------------------
    // STEP 3: Chọn file qua file chooser
    // ------------------------------------------------
    async dropVideoFile(page, filePath) {
        log(TAG, `Uploading via file chooser`, { filePath });

        // FIX 4: Dùng locator().last() thay vì .last() trên toàn page
        // để chắc chắn lấy dialog Reels mới nhất (tránh match dialog cũ).
        const modal = page.locator('div[role="dialog"]').last();

        const uploadBtn = modal.locator('span:has-text("Thêm video")').first();
        await uploadBtn.waitFor({ state: 'visible', timeout: 15000 });

        await this.delay.action('hover upload zone', page);
        await uploadBtn.hover();
        await this.delay.action('before click upload zone', page);

        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            uploadBtn.click({ delay: this.delay.random(50, 150) })
        ]);

        await this.delay.action('after click upload zone', page);
        await fileChooser.setFiles(filePath);
        await this.delay.upload('after video upload');

        logOk(TAG, `File selected via chooser`);
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

            const nextBtn = page.locator('div[aria-label="Tiếp"][role="button"]').first();
            const exists  = await nextBtn.count();

            if (exists > 0) {
                const isDisabled = await nextBtn.evaluate(el =>
                    el.getAttribute('aria-disabled') === 'true'
                );

                if (!isDisabled) {
                    await this.delay.action('before click next (1)', page);
                    await nextBtn.click({ delay: this.delay.random(80, 150) });
                    await this.delay.navigation('after click next (1)', page);

                    logOk(TAG, `Upload done, clicking Tiếp (1)`, {
                        elapsed: `${Math.round(elapsed / 1000)}s`
                    });
                    return;
                }
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
        await this.delay.action('after focus caption', page);

        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');

        for (const char of caption) {
            await page.keyboard.type(char, { delay: this.delay.random(30, 90) });
        }

        await this.delay.action('after typing caption', page);
        logOk(TAG, `Caption filled`);
    }

    // ------------------------------------------------
    // STEP 6: Click "Tiếp" lần 2 (sau caption)
    // ------------------------------------------------
    async clickNext(page) {
        log(TAG, `Clicking Tiếp (2)...`);

        const nextBtn = page.locator('div[role="button"]:has(span:has-text("Tiếp"))').last();
        await nextBtn.waitFor({ state: 'visible', timeout: 10000 });

        await this.delay.action('before click next (2)', page);
        await nextBtn.click({ delay: this.delay.random(80, 150) });
        await this.delay.navigation('after click next (2)', page);

        logOk(TAG, `Tiếp (2) clicked`);
    }

    // ------------------------------------------------
    // STEP 7: Click "Đăng"
    // ------------------------------------------------
    async clickPost(page) {
        log(TAG, `Clicking Đăng...`);

        const postBtn = page.locator('div[role="button"]:has(span:has-text("Đăng"))').last();
        await postBtn.waitFor({ state: 'visible', timeout: 10000 });

        await this.delay.action('before click post', page);
        await postBtn.click({ delay: this.delay.random(100, 200) });
        await this.delay.navigation('after click post', page);

        logOk(TAG, `Đăng clicked — reels posted`);
    }

    // ------------------------------------------------
    // Download video về /tmp
    // ------------------------------------------------
    async downloadVideo(mediaId) {
        const url = runtimeConfig.api.apiGetVideo + '/' + mediaId;
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