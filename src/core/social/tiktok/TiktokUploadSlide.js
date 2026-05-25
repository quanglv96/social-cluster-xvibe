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

const TAG = 'TK_UPLOAD_SLIDE';

export class TiktokUploadSlide {

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
     * @param {{ map_images: Map<number, string>, caption: string }} dto
     * @param {import('playwright').Page} page — đã login, đang ở tiktok.com mobile
     */
    async upload({map_images: images, caption}, page) {
        const sortedPaths = [];

        try {
            // STEP 1: Download theo thứ tự index
            const sorted = [...images.entries()].sort(([a], [b]) => a - b);
            for (const [index, url] of sorted) {
                const path = await this.downloadImage(url, index);
                sortedPaths.push(path);
            }

            // STEP 2: Tap nút tạo post
            await this.tapCreateButton(page);

            // STEP 3: Inject ảnh vào file input (sorted array → đúng thứ tự)
            await this.injectImages(page, sortedPaths);

            // STEP 4: Chờ preview slideshow load xong
            await this.waitForSlidePreview(page, sortedPaths.length);

            // STEP 5: Fill caption
            await this.fillCaption(page, caption);

            // STEP 6: Post
            await this.tapPostButton(page);

        } finally {
            sortedPaths.forEach(p => this.safeDeleteFile(p));
        }
    }

    // ------------------------------------------------
    // STEP 2: Tìm và tap nút "+" tạo post mới
    // ------------------------------------------------
    async tapCreateButton(page) {
        const selectors = [
            '[data-e2e="nav-upload"]',
            '[aria-label*="Create" i]',
            '[aria-label*="Upload" i]',
            'a[href*="/upload"]',
        ];
        for (const sel of selectors) {
            try {
                await page.tap(sel, {timeout: 6000});
                await page.waitForLoadState('domcontentloaded');
                await this.sleep(2000);
                return;
            } catch (_) {
            }
        }
        // Fallback: navigate thẳng
        await page.goto('https://www.tiktok.com/upload', {
            waitUntil: 'domcontentloaded'
        });
        await this.sleep(2000);
    }

    // ------------------------------------------------
    // STEP 3: Inject ảnh — thứ tự array = thứ tự slideshow
    // ------------------------------------------------
    async injectImages(page, sortedPaths) {
        // Unhide file input nếu bị CSS ẩn
        await page.evaluate(() => {
            document.querySelectorAll('input[type="file"]').forEach(el => {
                el.style.cssText = 'display:block!important;opacity:1!important;visibility:visible!important';
                el.removeAttribute('hidden');
            });
        });

        // Ưu tiên input accept image
        const input = page.locator('input[type="file"][accept*="image"]').first()
            ?? page.locator('input[type="file"]').first();

        await input.waitFor({state: 'attached', timeout: 10000});
        await input.setInputFiles(sortedPaths);  // ← sorted array, TikTok giữ nguyên thứ tự

        log(TAG, `Injected ${sortedPaths.length} images`);
        await this.sleep(2000);
    }

    // ------------------------------------------------
    // STEP 4: Chờ tất cả ảnh render trong preview
    // ------------------------------------------------
    async waitForSlidePreview(page, expectedCount) {
        const TIMEOUT = 90_000;
        const start = Date.now();

        while (Date.now() - start < TIMEOUT) {
            const result = await page.evaluate((expected) => {
                // Mobile TikTok preview — các selector thường gặp
                const slides = document.querySelectorAll(
                    '[class*="swiper-slide"] img, [class*="slide-item"] img, [class*="photo-card"] img'
                );
                const errorEl = document.querySelector('[class*="upload-error"], [class*="error-tip"]');
                return {
                    count: slides.length,
                    hasError: !!errorEl,
                    errorText: errorEl?.textContent?.trim(),
                };
            }, expectedCount);

            if (result.hasError) throw new Error(`Upload error: ${result.errorText}`);
            if (result.count >= expectedCount) {
                logOk(TAG, `All ${expectedCount} slides ready`);
                return;
            }

            await this.sleep(2000);
        }
        throw new Error(`Timeout waiting for ${expectedCount} slides`);
    }

    // ------------------------------------------------
    // Download image về tmp với tên giữ đúng thứ tự
    // ------------------------------------------------
    async downloadImage(url, index) {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 60_000,
        });

        // Đặt tên file với zero-padded index để OS sort đúng thứ tự khi cần
        const filePath = path.join(
            os.tmpdir(),
            `tiktok_photo_${String(index).padStart(3, '0')}_${Date.now()}.jpg`
        );
        await fs.promises.writeFile(filePath, response.data);
        logOk(TAG, `Downloaded image`, {index, filePath});
        return filePath;
    }
}