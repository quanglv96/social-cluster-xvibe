import { ExcelService } from '../services/ExcelService.js';
import { ApiService } from '../services/ApiService.js';

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
    const msg = formatMsg(requestId, `❌ ${message}`, {
        error: err?.message || err
    });
    sendToRenderer('error', msg);
}

function logOk(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, `✅ ${message}`, fields);
    sendToRenderer('ok', msg);
}

// =========================
// Class
// =========================

const TAG = 'TW_CRAWL';

export class TwCrawlTrigger {

    static useEventPage = true;

    constructor(social) {
        this.social = social;
    }

    async execute(dto, page) {

        if (!page) {
            throw new Error("TwCrawlTrigger requires an event page");
        }

        const { id, source, last_image, type } = dto;

        const requestId = `${TAG}_${id || Date.now()}`;
        const startTime = Date.now();

        log(requestId, 'START TWITTER CRAWL', {
            source,
            type
        });

        try {

            // =====================
            // 1. OPEN MEDIA PAGE
            // =====================
            log(requestId, 'Opening media page', { url: `${source}/media` });

            await page.goto(source + '/media', {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });

            await page.waitForTimeout(3000);

            // =====================
            // 2. CRAWL
            // =====================
            log(requestId, 'Crawling images');

            const { success, images, newLastUrl } =
                await this.social.twCrawler(dto, page);

            logOk(requestId, 'Crawl done', {
                total: images.length
            });

            if (!images.length) {

                logWarn(requestId, 'No new images');

                log(requestId, 'Finished crawl', {
                    duration: `${Date.now() - startTime}ms`
                });

                return {
                    images: [],
                    message: 'No new images'
                };
            }

            // =====================
            // 3. BUILD EXCEL
            // =====================
            log(requestId, 'Building Excel file');

            const buffer =
                await ExcelService.buildExcel(images, source);

            logOk(requestId, 'Excel created');

            // =====================
            // 4. UPLOAD FILE
            // =====================
            log(requestId, 'Uploading Excel to backend');

            await ApiService.uploadExcel(buffer);

            logOk(requestId, 'Upload success');

            // =====================
            // 5. UPDATE CHECKPOINT
            // =====================
            log(requestId, 'Updating checkpoint');

            if (newLastUrl && newLastUrl !== last_image) {
                await ApiService.updatePageCheckpoint(id, newLastUrl);

                logOk(requestId, 'Checkpoint updated');

            } else {
                logWarn(requestId, 'Checkpoint unchanged');
            }

            logOk(requestId, 'TWITTER CRAWL DONE', {
                duration: `${Date.now() - startTime}ms`,
                total: images.length
            });

            return {
                success,
                images,
                newLastUrl
            };

        } catch (error) {

            logError(requestId, 'TWITTER CRAWL FAILED', error);

            logWarn(requestId, 'Execution finished with error', {
                duration: `${Date.now() - startTime}ms`
            });

            throw error;
        }
    }
}