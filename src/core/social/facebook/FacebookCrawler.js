import { runtimeConfig} from "../../../config/config.js";
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
// Crawler
// =========================

export class FacebookCrawler {

    constructor(context) {
        this.context = context;
    }

    /**
     * page được truyền từ SessionManager (event tab)
     */
    async crawl({id, last_image, source}, page) {

        if (!page) {
            throw new Error("FacebookCrawler requires an event page");
        }

        const crawlId = id || `CRAWL_${Date.now()}`;
        const startTime = Date.now();
        const separator = '='.repeat(60);

        log(crawlId, separator);
        log(crawlId, `📸 START FACEBOOK CRAWL`, { last_image });

        try {

            log(crawlId, `➡️ Navigating to viewer...`);
            await page.goto(last_image, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(5000);
            logOk(crawlId, `Viewer loaded`);

            // 🔥 Click nút toàn màn hình nếu tồn tại
            try {
                const fullscreenButton = await page.$(
                    'div[aria-label="Chuyển sang toàn màn hình"][role="button"], div[aria-label="Switch to fullscreen"][role="button"]'
                );

                if (fullscreenButton) {
                    log(crawlId, `🖥️ Switching to fullscreen mode...`);
                    await fullscreenButton.click();
                    await page.waitForTimeout(2000);
                    logOk(crawlId, `Fullscreen activated`);
                } else {
                    log(crawlId, `Fullscreen button not found`);
                }
            } catch (err) {
                logWarn(crawlId, `Fullscreen click failed`, { error: err.message });
            }

            const images = [];
            let newLastUrl = last_image;
            const MAX_IMAGES = runtimeConfig.maxImages;

            while (images.length < MAX_IMAGES) {

                log(crawlId, `🔍 Extracting image`, {
                    current: images.length + 1,
                    max: MAX_IMAGES,
                });

                const imageData = await page.evaluate(() => {
                    const img = document.querySelector('img[data-visualcompletion="media-vc-image"]');
                    if (!img) return null;
                    if (!img.src) return null;
                    if (img.src.startsWith('data:image')) return null;
                    return {
                        url: img.src,
                        width: img.naturalWidth,
                        height: img.naturalHeight
                    };
                });

                if (!imageData) {
                    logWarn(crawlId, `No image found in viewer — STOP`);
                    break;
                }

                if (images.some(i => i.url === imageData.url)) {
                    logWarn(crawlId, `Duplicate image detected — STOP`);
                    break;
                }

                logOk(crawlId, `Image found`, {
                    size: `${imageData.width}x${imageData.height}`,
                    url: imageData.url,
                });

                images.push(imageData);
                newLastUrl = page.url();

                log(crawlId, `⬅️ Moving to previous image`);
                await page.keyboard.press('ArrowLeft');
                await page.waitForTimeout(3000);
            }

            logOk(crawlId, `Crawl finished`, {
                total: images.length,
                totalMs: Date.now() - startTime,
            });
            log(crawlId, separator);

            return { success: true, images, newLastUrl };

        } catch (err) {
            logError(crawlId, `Crawl error`, err);
            throw err;

        } finally {
            log(crawlId, `⏱️ Finished`, { totalMs: Date.now() - startTime });
            log(crawlId, separator);
        }
    }
}