import fs from 'fs';
import axios from 'axios';
import path from 'path';
import os from 'os';

import {runtimeConfig} from '../../../config/config.js';
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
// Constants
// =========================

const TAG = 'TK_UPLOAD';

// Timeout chờ video upload thành công (ms)
// Video nhẹ (~vài MB) thường xong trong 30-60s — đặt 120s để an toàn
const UPLOAD_SUCCESS_TIMEOUT_MS = 120_000;

// Khoảng thời gian chờ giữa các lần kiểm tra tiến trình (ms)
const UPLOAD_POLL_INTERVAL_MS = 3_000;

// Số lần retry khi upload thất bại
const MAX_UPLOAD_RETRY = 3;

// =========================
// Class
// =========================

export class TiktokUploadVideo {

    constructor() {
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ------------------------------------------------
    // Entry point — gọi sau khi đã login & vào Studio
    // Nhận page đang ở màn upload (sau khi clickUploadButton)
    // ------------------------------------------------

    /**
     * @param {Object} dto
     * @param {string} dto.source   - URL video cần upload
     * @param {string} dto.content     - Nội dung mô tả (caption)
     * @param {import('playwright').Page} page - Page đang mở màn upload
     */
    async upload({source: mediaId, content: caption}, page) {
        if (!page) throw new Error('TiktokUploadVideo requires a Playwright page');
        if (!mediaId) throw new Error('mediaId is required');

        let tempFile = null;

        try {
            log(TAG, `🚀 START upload`, {mediaId, caption: caption?.slice(0, 40)});

            // STEP 1: Tải video về máy
            log(TAG, `STEP 1: Downloading video...`);
            tempFile = await this.downloadVideo(mediaId);
            log(TAG, `Video downloaded`, {filePath: tempFile});

            // STEP 2+3: Kéo video vào màn hình upload — có retry tối đa 3 lần
            log(TAG, `STEP 2+3: Drop video & wait for upload success...`);
            await this.dropVideoWithRetry(page, tempFile);

            // STEP 4: Điền caption
            log(TAG, `STEP 4: Filling caption...`);
            await this.fillCaption(page, caption);

            // STEP 5: Cuộn xuống 2 lần
            log(TAG, `STEP 5: Scrolling down 2 times...`);
            await this.scrollDown(page, 2);

            // STEP 6: Ấn nút Đăng
            log(TAG, `STEP 6: Clicking Post button...`);
            await this.clickPostButton(page);

            logOk(TAG, `🎉 Video upload complete`);
            return {success: true, mediaId};

        } finally {
            // Luôn xóa file rác dù thành công hay thất bại
            this.safeDeleteFile(tempFile);
        }
    }

    // ------------------------------------------------
    // Xóa file an toàn — không throw dù file không tồn tại
    // ------------------------------------------------
    safeDeleteFile(filePath) {
        if (!filePath) return;
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logOk(TAG, `🗑️  Temp file deleted`, {filePath});
            }
        } catch (err) {
            logWarn(TAG, `Failed to delete temp file (non-critical)`, {filePath, error: err.message});
        }
    }

    // ------------------------------------------------
    // STEP 1: Tải video từ URL về /tmp
    // ------------------------------------------------
    async downloadVideo(mediaId) {
        log(TAG, `Downloading video`, {mediaId});
        const hostUrl = runtimeConfig.api.apiGetVideo + mediaId
        const response = await axios.get(hostUrl, {
            responseType: 'arraybuffer',
            timeout: 120_000, // 2 phút cho video nặng
        });

        const filePath = path.join(
            os.tmpdir(),
            `tiktok_video_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`
        );

        try {
            await fs.promises.writeFile(filePath, response.data);
        } catch (writeErr) {
            // Ghi file lỗi giữa chừng → xóa ngay tại đây, không để lại file dở
            this.safeDeleteFile(filePath);
            throw writeErr;
        }

        const sizeKB = Math.round(response.data.byteLength / 1024);
        logOk(TAG, `Video downloaded`, {filePath, sizeKB: `${sizeKB}KB`});
        return filePath;
    }

    // ------------------------------------------------
    // STEP 2+3: Drop video + chờ upload — retry tối đa 3 lần
    // ------------------------------------------------
    async dropVideoWithRetry(page, filePath) {
        for (let attempt = 1; attempt <= MAX_UPLOAD_RETRY; attempt++) {
            try {
                log(TAG, `Drop+upload attempt`, {attempt: `${attempt}/${MAX_UPLOAD_RETRY}`});

                // Nếu không phải lần đầu → reload trang upload và chờ
                if (attempt > 1) {
                    logWarn(TAG, `Retrying — reloading upload page...`);
                    await page.reload({waitUntil: 'domcontentloaded', timeout: 30000});
                    await this.sleep(4000);

                    // Đảm bảo drop zone đã sẵn sàng sau reload
                    await this.waitForDropZone(page);
                }

                // Kéo video vào giữa màn hình
                await this.dropVideoFile(page, filePath);

                // Chờ upload hoàn tất
                await this.waitForUploadSuccess(page);

                logOk(TAG, `Upload success on attempt ${attempt}`);
                return;

            } catch (err) {
                logError(TAG, `Drop+upload attempt ${attempt} failed`, err);

                if (attempt >= MAX_UPLOAD_RETRY) {
                    throw new Error(`Video upload failed after ${MAX_UPLOAD_RETRY} attempts: ${err.message}`);
                }

                const waitMs = 5000 * attempt; // 5s, 10s, 15s
                log(TAG, `Waiting ${waitMs / 1000}s before retry...`);
                await this.sleep(waitMs);
            }
        }
    }

    // ------------------------------------------------
    // Chờ drop zone sẵn sàng (sau reload)
    // ------------------------------------------------
    async waitForDropZone(page) {
        log(TAG, `Waiting for drop zone to be ready...`);

        // TikTok Studio upload zone — thường có class chứa "upload" hoặc "drag"
        const dropZoneSelectors = [
            '[class*="upload-zone"]',
            '[class*="drag-upload"]',
            '[class*="upload-content"]',
            '[class*="upload-card"]',
            '[data-e2e="upload_zone"]',
        ];

        for (const sel of dropZoneSelectors) {
            try {
                await page.waitForSelector(sel, {timeout: 8000});
                log(TAG, `Drop zone found`, {selector: sel});
                return;
            } catch (_) {
                // thử cái tiếp
            }
        }

        // Fallback: chỉ chờ DOM ổn định
        logWarn(TAG, `Drop zone selector not found — falling back to networkidle`);
        await page.waitForLoadState('networkidle', {timeout: 15000}).catch(() => {
        });
        await this.sleep(2000);
    }

    // ------------------------------------------------
    // Kéo (drag & drop) file video vào giữa màn hình
    // ------------------------------------------------
    async dropVideoFile(page, filePath) {
        log(TAG, `Dropping video file`, {filePath});

        const fileName = path.basename(filePath);
        const fileBase64 = fs.readFileSync(filePath, {encoding: 'base64'});

        // Xác định MIME type
        const mimeType = fileName.endsWith('.mp4') ? 'video/mp4'
            : fileName.endsWith('.mov') ? 'video/quicktime'
                : 'video/mp4';

        // Tạo DataTransfer trong browser context
        const dataTransfer = await page.evaluateHandle(
            async ({fileBase64, fileName, mimeType}) => {
                const byteCharacters = atob(fileBase64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], {type: mimeType});
                const file = new File([blob], fileName, {type: mimeType});
                const dt = new DataTransfer();
                dt.items.add(file);
                return dt;
            },
            {fileBase64, fileName, mimeType}
        );

        // Lấy tọa độ giữa màn hình để drop
        const viewport = page.viewportSize();
        const centerX = viewport ? viewport.width / 2 : 760;
        const centerY = viewport ? viewport.height / 2 : 400;

        log(TAG, `Dispatching drag events`, {centerX, centerY});

        await page.dispatchEvent('body', 'dragenter', {dataTransfer});
        await this.sleep(300);
        await page.dispatchEvent('body', 'dragover', {dataTransfer});
        await this.sleep(300);
        await page.mouse.move(centerX, centerY);
        await this.sleep(200);
        await page.dispatchEvent('body', 'drop', {dataTransfer});

        logOk(TAG, `Video dropped — waiting for processing...`);

        // Chờ TikTok bắt đầu xử lý (progress bar / info-body xuất hiện)
        await this.sleep(3000);
    }

    // ------------------------------------------------
    // Chờ upload thành công — poll DOM cho đến khi thấy class "success"
    // Timeout: 120s — poll mỗi 3s
    // ------------------------------------------------
    async waitForUploadSuccess(page) {
        log(TAG, `Waiting for upload to complete...`, {
            timeout: `${UPLOAD_SUCCESS_TIMEOUT_MS / 1000}s`,
            pollInterval: `${UPLOAD_POLL_INTERVAL_MS / 1000}s`,
        });

        const startTime = Date.now();

        while (true) {
            const elapsed = Date.now() - startTime;

            if (elapsed > UPLOAD_SUCCESS_TIMEOUT_MS) {
                throw new Error(`Upload timed out after ${UPLOAD_SUCCESS_TIMEOUT_MS / 1000}s`);
            }

            // Kiểm tra trạng thái success trong DOM
            // DOM mẫu: <div class="jsx-... info-status success">
            const isSuccess = await page.evaluate(() => {
                // Cách 1: class info-status success
                const statusEl = document.querySelector('.info-status.success');
                if (statusEl) return {ok: true, method: 'info-status.success'};

                // Cách 2: icon CheckCircleFill xuất hiện trong info-body
                const checkIcon = document.querySelector('.info-body [data-icon="CheckCircleFill"]');
                if (checkIcon) return {ok: true, method: 'CheckCircleFill icon'};

                // Cách 3: text "Đã tải lên" trong info-status
                const allStatus = document.querySelectorAll('[class*="info-status"]');
                for (const el of allStatus) {
                    if (el.textContent.includes('Đã tải lên')) {
                        return {ok: true, method: 'text:Đã tải lên'};
                    }
                }

                // Kiểm tra lỗi upload
                const errorEl = document.querySelector('.info-status.error, [class*="upload-error"], [class*="error-status"]');
                if (errorEl) return {ok: false, error: true, text: errorEl.textContent?.trim()};

                return {ok: false, error: false};
            });

            if (isSuccess.ok) {
                logOk(TAG, `Upload confirmed`, {method: isSuccess.method, elapsed: `${Math.round(elapsed / 1000)}s`});
                return;
            }

            if (isSuccess.error) {
                throw new Error(`Upload failed in TikTok UI: ${isSuccess.text}`);
            }

            // Vẫn đang upload — log tiến trình mỗi 15s
            if (elapsed % 15000 < UPLOAD_POLL_INTERVAL_MS) {
                log(TAG, `Still uploading...`, {elapsed: `${Math.round(elapsed / 1000)}s`});
            }

            await this.sleep(UPLOAD_POLL_INTERVAL_MS);
        }
    }

    // ------------------------------------------------
    // STEP 4: Điền caption vào DraftEditor
    // ------------------------------------------------
    async fillCaption(page, caption) {
        if (!caption) {
            log(TAG, `No caption provided — skipping`);
            return;
        }

        log(TAG, `Filling caption...`, {length: caption.length});

        // Tìm contenteditable của DraftEditor trong caption container
        const captionEditor = page.locator(
            '[data-e2e="caption_container"] .public-DraftEditor-content'
        );

        await captionEditor.waitFor({state: 'visible', timeout: 15000});

        // Click vào editor để focus
        await captionEditor.click();
        await this.sleep(400);

        // Xoá nội dung cũ (tên file mặc định)
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await this.sleep(300);

        // Gõ caption từng ký tự (human-like)
        for (const char of caption) {
            await page.keyboard.type(char, {delay: 30 + Math.random() * 50});
        }

        await this.sleep(800);

        // Verify
        const currentText = await captionEditor.innerText();
        log(TAG, `Caption filled`, {preview: currentText.slice(0, 60)});

        logOk(TAG, `Caption set successfully`);
    }

    // ------------------------------------------------
    // STEP 5: Cuộn xuống N lần
    // ------------------------------------------------
    async scrollDown(page, times = 2) {
        log(TAG, `Scrolling down`, {times});

        for (let i = 0; i < times; i++) {
            await page.mouse.wheel(0, 500);
            await this.sleep(800);
            log(TAG, `Scrolled`, {step: `${i + 1}/${times}`});
        }

        await this.sleep(500);
        logOk(TAG, `Scroll complete`);
    }

    // ------------------------------------------------
    // STEP 6: Click nút Đăng
    // ------------------------------------------------
    async clickPostButton(page) {
        log(TAG, `Looking for Post button...`);

        const maxRetry = 3;

        for (let attempt = 1; attempt <= maxRetry; attempt++) {
            try {
                // Selector ưu tiên: data-e2e="post_video_button"
                const postBtn = page.locator('[data-e2e="post_video_button"]');
                await postBtn.waitFor({state: 'visible', timeout: 15000});

                // Chờ button không còn disabled / loading
                await page.waitForFunction(() => {
                    const btn = document.querySelector('[data-e2e="post_video_button"]');
                    if (!btn) return false;
                    return btn.getAttribute('data-disabled') !== 'true'
                        && btn.getAttribute('data-loading') !== 'true'
                        && btn.getAttribute('aria-disabled') !== 'true';
                }, {timeout: 30000});

                logOk(TAG, `Post button is ready — clicking`);

                const box = await postBtn.boundingBox();
                if (!box) throw new Error('Cannot get bounding box for Post button');

                const targetX = box.x + box.width * (0.4 + Math.random() * 0.2);
                const targetY = box.y + box.height * (0.4 + Math.random() * 0.2);

                await page.mouse.move(targetX, targetY, {steps: 15});
                await this.sleep(150 + Math.random() * 150);
                await page.mouse.click(targetX, targetY);

                logOk(TAG, `Post button clicked`, {x: Math.round(targetX), y: Math.round(targetY)});

                // Chờ xác nhận đã đăng thành công — TikTok thường redirect hoặc hiện toast
                const postResult = await Promise.race([
                    page.waitForURL('**/tiktokstudio**', {timeout: 30000}).then(() => 'STUDIO'),
                    page.waitForURL('**/@**', {timeout: 30000}).then(() => 'PROFILE'),
                    page.waitForSelector('[class*="success-toast"], [class*="post-success"]', {timeout: 30000}).then(() => 'TOAST'),
                    this.sleep(30000).then(() => 'TIMEOUT'),
                ]).catch(() => 'TIMEOUT');

                log(TAG, `Post result`, {postResult});

                if (postResult === 'TIMEOUT') {
                    logWarn(TAG, `No redirect detected after post — may still be processing`);
                }

                return;

            } catch (err) {
                logError(TAG, `Click Post button attempt ${attempt} failed`, err);

                if (attempt >= maxRetry) {
                    throw new Error(`Post button click failed after ${maxRetry} attempts: ${err.message}`);
                }

                await this.sleep(3000);
            }
        }
    }
}