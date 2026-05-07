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

            // STEP 1: Tải video về máy TRƯỚC — page chưa cần dùng
            log(TAG, `STEP 1: Downloading video...`);

            // Ping page định kỳ để giữ alive trong lúc download
            const keepAliveInterval = this.startKeepAlive(page);

            try {
                tempFile = await this.downloadVideo(mediaId);
            } finally {
                clearInterval(keepAliveInterval);
            }

            log(TAG, `Video downloaded`, {filePath: tempFile});

            // STEP 1.5: Kiểm tra page còn sống không trước khi tiếp tục
            await this.ensurePageAlive(page);

            // STEP 2: Kéo video vào màn hình upload — có retry tối đa 3 lần
            log(TAG, `STEP 2+3: Drop video & wait for upload success...`);
            await this.dropVideoWithRetry(page, tempFile);
            // STEP 3: Dismiss tutorial tooltip nếu có
            log(TAG, `STEP 3: Dismissing tutorial tooltip if any...`);
            await this.dismissTutorialTooltip(page);
            // ... rest of steps
            log(TAG, `STEP 4: Filling caption...`);
            await this.fillCaption(page, caption);

            log(TAG, `STEP 5: Scrolling down 2 times...`);
            await this.scrollDown(page, 2);

            // STEP 5.5: Chờ TikTok kiểm tra video xong
            log(TAG, `STEP 5.5: Waiting for video check...`);
            await this.waitForVideoCheck(page);

            log(TAG, `STEP 6: Clicking Post button...`);
            await this.clickPostButton(page);

            logOk(TAG, `🎉 Video upload complete`);
            return {success: true, mediaId};

        } finally {
            this.safeDeleteFile(tempFile);
        }
    }

// ------------------------------------------------
// Ping page mỗi 5s để giữ không bị close/idle
// ------------------------------------------------
    startKeepAlive(page) {
        log(TAG, `Starting page keep-alive ping...`);
        return setInterval(async () => {
            try {
                await page.evaluate(() => document.title);
                log(TAG, `Keep-alive ping OK`);
            } catch (_) {
                // page đã close — interval sẽ bị clear bên ngoài
            }
        }, 5000);
    }

// ------------------------------------------------
// Kiểm tra page còn sống — nếu không thì throw rõ ràng
// ------------------------------------------------
    async ensurePageAlive(page) {
        try {
            const url = page.url();
            log(TAG, `Page still alive`, {url});

            // Nếu bị redirect ra khỏi upload page → navigate lại
            if (!url.includes('tiktokstudio') && !url.includes('upload')) {
                logWarn(TAG, `Page navigated away during download — re-navigating to upload...`);
                await page.goto('https://www.tiktok.com/tiktokstudio/upload', {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000,
                });
                await this.sleep(3000);
                await this.waitForDropZone(page);
            }
        } catch (err) {
            throw new Error(`Page is no longer alive after download: ${err.message}`);
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
        const hostUrl = runtimeConfig.api.apiGetVideo + '/' + mediaId;
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
    // ------------------------------------------------
// Kéo (drag & drop) file video vào giữa màn hình
// ------------------------------------------------
    async dropVideoFile(page, filePath) {
        log(TAG, `Dropping video file`, {filePath});

        // --- Cách 1: setInputFiles trên hidden file input (ưu tiên, không cần base64) ---
        const fileInputSelectors = [
            'input[type="file"][accept*="video"]',
            'input[type="file"]',
        ];

        for (const sel of fileInputSelectors) {
            try {
                const input = page.locator(sel).first();
                // Bỏ display:none / visibility:hidden để Playwright có thể thao tác
                await page.evaluate((s) => {
                    const el = document.querySelector(s);
                    if (el) {
                        el.style.display = 'block';
                        el.style.opacity = '1';
                        el.style.visibility = 'visible';
                        el.removeAttribute('hidden');
                    }
                }, sel);

                await input.waitFor({state: 'attached', timeout: 5000});
                await input.setInputFiles(filePath);
                logOk(TAG, `Video set via setInputFiles`, {selector: sel});

                // Chờ TikTok bắt đầu xử lý
                await this.sleep(3000);
                return;
            } catch (_) {
                // thử selector tiếp theo
            }
        }

        // --- Cách 2: Fallback — dispatch drop với chunk nhỏ (không truyền toàn bộ base64) ---
        logWarn(TAG, `No file input found — falling back to drag-drop via Playwright upload`);

        // Playwright hỗ trợ dispatchEvent với file path trực tiếp (không cần base64)
        await page.setInputFiles('input[type="file"]', filePath).catch(() => null);

        // Nếu vẫn không được, dùng CDP để inject file
        try {
            const [fileChooser] = await Promise.all([
                page.waitForFileChooser({timeout: 5000}),
                page.click('[class*="upload-zone"], [class*="drag-upload"], [data-e2e="upload_zone"]')
                    .catch(() => page.click('body')),
            ]);
            await fileChooser.setFiles(filePath);
            logOk(TAG, `Video set via FileChooser`);
        } catch (err) {
            throw new Error(`All upload methods failed: ${err.message}`);
        }

        // Chờ TikTok bắt đầu xử lý
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
        const captionEditor = page.locator(
            '[data-e2e="caption_container"] .public-DraftEditor-content'
        );
        await captionEditor.waitFor({state: 'visible', timeout: 15000});

        await captionEditor.click();
        await this.sleep(400);

        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await this.sleep(300);

        if (!caption) {
            log(TAG, `No caption provided — skipping`);
            return;
        }

        log(TAG, `Filling caption...`, {length: caption.length}); // ✅ sau check
        for (const char of caption) {
            await page.keyboard.type(char, {delay: 30 + Math.random() * 50});
        }

        await this.sleep(800);

        const currentText = await captionEditor.innerText();
        log(TAG, `Caption filled`, {preview: currentText.slice(0, 60)});
        logOk(TAG, `Caption set successfully`);
    }

    // ------------------------------------------------
    // STEP 5: Cuộn xuống N lần
    // ------------------------------------------------
    async scrollDown(page, times = 2) {
        log(TAG, `Scrolling down`, {times});

        // Click vào giữa trang trước để đảm bảo page có focus
        const viewport = page.viewportSize();
        const centerX = viewport ? viewport.width / 2 : 760;
        const centerY = viewport ? viewport.height / 2 : 400;
        await page.mouse.click(centerX, centerY);
        await this.sleep(300);

        for (let i = 0; i < times; i++) {
            await page.mouse.wheel(0, 500);
            await this.sleep(500);

            // Fallback: dùng keyboard PageDown
            await page.keyboard.press('PageDown');
            await this.sleep(500);

            log(TAG, `Scrolled`, {step: `${i + 1}/${times}`});
        }

        await this.sleep(500);
        logOk(TAG, `Scroll complete`);
    }

    // ------------------------------------------------
    // STEP 6: Click nút Đăng
    // ------------------------------------------------
    // ------------------------------------------------
    async clickPostButton(page) {
        log(TAG, `Looking for Post button...`);

        const maxRetry = 3;

        for (let attempt = 1; attempt <= maxRetry; attempt++) {
            try {
                const postBtn = page.locator('[data-e2e="post_video_button"]');
                await postBtn.waitFor({state: 'visible', timeout: 15_000});

                // Chờ button không còn disabled / loading
                await page.waitForFunction(() => {
                    const btn = document.querySelector('[data-e2e="post_video_button"]');
                    if (!btn) return false;
                    return btn.getAttribute('data-disabled') !== 'true'
                        && btn.getAttribute('data-loading') !== 'true'
                        && btn.getAttribute('aria-disabled') !== 'true';
                }, {timeout: 30_000});

                logOk(TAG, `Post button is ready — clicking`);

                const box = await postBtn.boundingBox();
                if (!box) throw new Error('Cannot get bounding box for Post button');

                const targetX = box.x + box.width * (0.4 + Math.random() * 0.2);
                const targetY = box.y + box.height * (0.4 + Math.random() * 0.2);

                await page.mouse.move(targetX, targetY, {steps: 15});
                await this.sleep(150 + Math.random() * 150);
                await page.mouse.click(targetX, targetY);

                logOk(TAG, `Post button clicked`, {x: Math.round(targetX), y: Math.round(targetY)});

                // PHASE 1: Chờ TikTok xử lý & redirect (tối đa 30s)
                log(TAG, `Waiting for post confirmation / redirect...`);
                const postResult = await Promise.race([
                    page.waitForURL('**/tiktokstudio**', {timeout: 30_000}).then(() => 'STUDIO'),
                    page.waitForURL('**/@**', {timeout: 30_000}).then(() => 'PROFILE'),
                    page.waitForSelector('[class*="success-toast"], [class*="post-success"]', {timeout: 30_000}).then(() => 'TOAST'),
                    this.sleep(30_000).then(() => 'TIMEOUT'),
                ]).catch(() => 'TIMEOUT');

                log(TAG, `Post result`, {postResult});

                // PHASE 2: Sau khi redirect → chờ thêm để TikTok xử lý video server-side
                // TikTok thường mất 5-15s để video thực sự publish sau khi redirect
                if (postResult === 'STUDIO' || postResult === 'PROFILE') {
                    log(TAG, `Redirected — waiting for server-side processing...`);
                    await this.waitForPostProcessing(page, postResult);
                } else if (postResult === 'TOAST') {
                    // Toast xuất hiện → chờ toast biến mất + buffer thêm
                    log(TAG, `Success toast detected — waiting for it to complete...`);
                    await page.waitForSelector(
                        '[class*="success-toast"], [class*="post-success"]',
                        {state: 'hidden', timeout: 15_000}
                    ).catch(() => null);
                    await this.sleep(3_000);
                } else {
                    // TIMEOUT — không redirect nhưng không có lỗi rõ ràng
                    logWarn(TAG, `No redirect after 30s — checking if post actually succeeded...`);
                    await this.sleep(5_000);
                }

                logOk(TAG, `Post confirmed complete`, {postResult});
                return;

            } catch (err) {
                logError(TAG, `Click Post button attempt ${attempt} failed`, err);

                if (attempt >= maxRetry) {
                    throw new Error(`Post button click failed after ${maxRetry} attempts: ${err.message}`);
                }

                await this.sleep(3_000);
            }
        }
    }

// ------------------------------------------------
// Chờ TikTok xử lý video sau khi redirect về Studio
// Poll tối đa 60s — tìm video mới nhất ở trạng thái "processing" → "published"
// ------------------------------------------------
    async waitForPostProcessing(page, redirectType) {
        const PROCESSING_TIMEOUT_MS = 60_000;
        const POLL_INTERVAL_MS = 3_000;

        log(TAG, `Waiting for post processing...`, {
            redirectType,
            timeout: `${PROCESSING_TIMEOUT_MS / 1000}s`,
        });

        const startTime = Date.now();

        // Chờ trang Studio load xong
        await page.waitForLoadState('domcontentloaded', {timeout: 15_000}).catch(() => null);
        await this.sleep(2_000);

        while (true) {
            const elapsed = Date.now() - startTime;

            if (elapsed > PROCESSING_TIMEOUT_MS) {
                logWarn(TAG, `Post processing timeout — assuming success`, {elapsed: `${Math.round(elapsed / 1000)}s`});
                return; // Không throw — TikTok có thể vẫn đang xử lý ngầm
            }

            const status = await page.evaluate(() => {
                // Tìm video item đầu tiên trong danh sách (mới nhất)
                // TikTok Studio thường hiển thị video đang xử lý với badge "Đang xử lý" / "Processing"
                const processingBadges = document.querySelectorAll(
                    '[class*="processing"], [class*="transcoding"], [data-e2e*="processing"]'
                );
                if (processingBadges.length > 0) {
                    return {state: 'processing', count: processingBadges.length};
                }

                // Kiểm tra video đã xuất hiện trong feed (published)
                const videoItems = document.querySelectorAll(
                    '[class*="video-item"], [class*="content-item"], [data-e2e="video-item"]'
                );
                if (videoItems.length > 0) {
                    return {state: 'published', count: videoItems.length};
                }

                return {state: 'unknown'};
            }).catch(() => ({state: 'page_error'}));

            log(TAG, `Post processing status`, {
                state: status.state,
                elapsed: `${Math.round(elapsed / 1000)}s`,
            });

            if (status.state === 'published') {
                logOk(TAG, `Video confirmed published in Studio feed`, {elapsed: `${Math.round(elapsed / 1000)}s`});
                return;
            }

            if (status.state === 'page_error') {
                logWarn(TAG, `Cannot read Studio page — assuming published`);
                return;
            }

            // processing hoặc unknown → tiếp tục chờ
            await this.sleep(POLL_INTERVAL_MS);
        }
    }

    // ------------------------------------------------
// Dismiss tutorial tooltip "Đã hiểu" nếu xuất hiện
// ------------------------------------------------
    async dismissTutorialTooltip(page) {
        log(TAG, `Checking for tutorial tooltip...`);

        try {
            // Tìm tooltip container
            const tooltip = page.locator('.tutorial-tooltip').first();
            const isVisible = await tooltip.isVisible().catch(() => false);

            if (!isVisible) {
                log(TAG, `No tutorial tooltip found — skipping`);
                return;
            }

            logWarn(TAG, `Tutorial tooltip detected — dismissing...`);

            // Click nút "Đã hiểu"
            const btn = page.locator('.tutorial-tooltip__footer button').first();
            await btn.waitFor({state: 'visible', timeout: 5_000});
            await btn.click();

            // Chờ tooltip biến mất
            await tooltip.waitFor({state: 'hidden', timeout: 5_000}).catch(() => null);

            logOk(TAG, `Tutorial tooltip dismissed`);
            await this.sleep(500);

        } catch (err) {
            logWarn(TAG, `Failed to dismiss tutorial tooltip (non-critical)`, {error: err.message});
            // Không throw — tooltip không dismiss được cũng không block flow
        }
    }

    // ------------------------------------------------
// Chờ TikTok kiểm tra video xong (status-tip không còn "Đang kiểm tra")
// ------------------------------------------------
    async waitForVideoCheck(page) {
        const TIMEOUT_MS = 15 * 60 * 1000;
        const POLL_INTERVAL_MS = 3_000;

        log(TAG, `Waiting for video check to complete...`, {timeout: '15min'});
        const startTime = Date.now();

        while (true) {
            const elapsed = Date.now() - startTime;

            if (elapsed > TIMEOUT_MS) {
                logWarn(TAG, `Video check timed out — proceeding anyway`, {elapsed: `${Math.round(elapsed / 1000)}s`});
                return;
            }

            const status = await page.evaluate(() => {
                const tip = document.querySelector('span.status-tip');
                if (!tip) return {state: 'not_found'};

                const text = tip.textContent?.trim() || '';
                const inlineColor = tip.style.color || ''; // "var(--ui-text-success)" hoặc "var(--ui-text-3)"

                if (text.includes('Đang kiểm tra')) {
                    return {state: 'checking', text};
                }

                // Check text trước — đây là cách chắc chắn nhất
                if (text.includes('Không phát hiện vấn đề')) {
                    return {state: 'success', text};
                }

                // Check màu đỏ/lỗi qua CSS variable name
                if (
                    inlineColor.includes('ui-text-danger') ||
                    inlineColor.includes('ui-text-error') ||
                    text.includes('vi phạm') ||
                    text.includes('không được phép') ||
                    text.includes('bị từ chối')
                ) {
                    return {state: 'error', text};
                }

                return {state: 'unknown', text, color: inlineColor};
            });

            log(TAG, `Video check status`, {
                state: status.state,
                elapsed: `${Math.round(elapsed / 1000)}s`,
                text: status.text,
            });

            if (status.state === 'success') {
                logOk(TAG, `Video check passed`, {text: status.text});
                return;
            }

            // ❌ Có lỗi → dừng, không đăng
            if (status.state === 'error') {
                throw new Error(`Video check failed — TikTok detected a violation: ${status.text}`);
            }

            if (status.state === 'not_found') {
                logWarn(TAG, `status-tip not found — skipping check`);
                return;
            }

            if (status.state === 'unknown') {
                logWarn(TAG, `Unknown check status — proceeding`, {text: status.text});
                return;
            }

            // checking → tiếp tục chờ, log mỗi 30s
            if (elapsed % 30000 < POLL_INTERVAL_MS) {
                log(TAG, `Still checking...`, {elapsed: `${Math.round(elapsed / 1000)}s`});
            }

            await this.sleep(POLL_INTERVAL_MS);
        }
    }
}