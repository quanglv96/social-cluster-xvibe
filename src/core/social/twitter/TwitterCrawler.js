// =========================
// Log Utils
// =========================


import {nowIso} from "../../../utils/time.js";

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

export class TwitterCrawler {

    constructor(context) {
        this.context = context;
    }

    normalizeImage(url) {
        try {
            const u = new URL(url);
            if (u.hostname.includes("pbs.twimg.com")) {
                u.searchParams.set("name", "orig");
            }
            return u.toString();
        } catch {
            return url;
        }
    }

    async crawl({id, last_image, source}, page) {

        if (!page) {
            throw new Error("TwitterCrawler requires a page");
        }

        const crawlId = id || `TW_${Date.now()}`;
        const startTime = Date.now();
        const separator = '='.repeat(60);

        log(crawlId, separator);
        log(crawlId, `🐦 START TWITTER GRID CRAWL`, {last_image});

        const images = [];
        let stop = false;
        let newLastUrl = null;

        try {
            await page.waitForTimeout(3000);

            // Scroll warmup
            for (let i = 1; i <= 3; i++) {
                log(crawlId, `🔄 Scroll warmup`, {step: `${i}/3`});
                await page.evaluate(() => {
                    window.scrollBy(0, window.innerHeight * 1.5);
                });
                await page.waitForTimeout(1500);
            }
            // ✅ Scroll về top, chờ DOM remount item 0
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(2000);
            const allItems = await page.$$('[id^="verticalGridItem-"]');
            log(crawlId, `🔍 Total DOM items found`, {count: allItems.length});

            const max = Math.min(allItems.length, 100);
            const normalizedLast = last_image ? this.normalizeImage(last_image) : null;

            for (let i = 0; i <= max; i++) {
                if (stop) break;

                const selector = `#verticalGridItem-${i}-profile-grid-0`;
                const imageData = await page.evaluate((selector) => {
                    const node = document.querySelector(selector);
                    if (!node) return null;
                    const img = node.querySelector('img');
                    if (!img?.src) return null;
                    return {url: img.src, width: img.naturalWidth, height: img.naturalHeight};
                }, selector);

                if (!imageData) {
                    logWarn(crawlId, `No image found`, {selector});
                    continue;
                }

                // Bỏ qua video
                if (imageData.url.includes('amplify_video_thumb')) {
                    log(crawlId, `⏭️ Skip video media`);
                    continue;
                }

                const normalizedUrl = this.normalizeImage(imageData.url);
                log(crawlId, `📸 Found image`, {url: normalizedUrl});

                // ✅ Set newLastUrl từ ảnh thật đầu tiên tìm được
                if (!newLastUrl) {
                    newLastUrl = normalizedUrl;
                    log(crawlId, `🆕 New last image set`, {url: newLastUrl});
                }

                if (normalizedLast && normalizedUrl === normalizedLast) {
                    log(crawlId, `🛑 Last image matched — STOP CRAWL`);
                    stop = true;
                    break;
                }

                images.push({url: normalizedUrl, width: imageData.width, height: imageData.height});
            }
            logOk(crawlId, `Crawl finished`, {
                total: images.length,
                totalMs: Date.now() - startTime,
            });
            log(crawlId, separator);

            return {success: true, images, newLastUrl};

        } catch (err) {
            logError(crawlId, `Crawl error`, err);
            throw err;

        } finally {
            log(crawlId, `⏱️ Finished`, {totalMs: Date.now() - startTime});
            log(crawlId, separator);
        }
    }
}