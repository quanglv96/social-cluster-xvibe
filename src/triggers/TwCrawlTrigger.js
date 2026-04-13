import { ExcelService } from '../services/ExcelService.js';
import { ApiService } from '../services/ApiService.js';

// =========================
// Log Utils
// =========================

function nowIso() { return new Date().toISOString(); }

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({ type: 'LOG', data: { type, msg } });
}

function log(requestId, message, fields = {}) {
    sendToRenderer('info', formatMsg(requestId, message, fields));
}

function logWarn(requestId, message, fields = {}) {
    sendToRenderer('warn', formatMsg(requestId, `⚠️ ${message}`, fields));
}

function logError(requestId, message, err) {
    sendToRenderer('error', formatMsg(requestId, `❌ ${message}`, { error: err?.message || err }));
}

function logOk(requestId, message, fields = {}) {
    sendToRenderer('ok', formatMsg(requestId, `✅ ${message}`, fields));
}

// =========================
// Class
// =========================

const TAG = 'TW_CRAWL';

export class TwCrawlTrigger {

    static useEventPage = false; // ← Twitter pool tự quản lý page

    constructor(social) {
        this.social = social;
    }

    async execute(dto) {
        const { id, source, last_image, type } = dto;
        const requestId = `${TAG}_${id || Date.now()}`;
        const startTime = Date.now();

        log(requestId, 'START TWITTER CRAWL', { source, type });

        try {
            // =====================
            // 1. CRAWL
            // goto + page đều nằm trong TwitterSocial.twCrawler
            // =====================
            log(requestId, 'Crawling images', { url: `${source}/media` });

            const { success, images, newLastUrl } =
                await this.social.twCrawler(dto);

            logOk(requestId, 'Crawl done', { total: images.length });

            if (!images.length) {
                logWarn(requestId, 'No new images');
                return { images: [], message: 'No new images' };
            }

            // =====================
            // 2. BUILD EXCEL
            // =====================
            log(requestId, 'Building Excel file');
            const buffer = await ExcelService.buildExcel(images, source);
            logOk(requestId, 'Excel created');

            // =====================
            // 3. UPLOAD FILE
            // =====================
            log(requestId, 'Uploading Excel to backend');
            await ApiService.uploadExcel(buffer);
            logOk(requestId, 'Upload success');

            // =====================
            // 4. UPDATE CHECKPOINT
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

            return { success, images, newLastUrl };

        } catch (error) {
            logError(requestId, 'TWITTER CRAWL FAILED', error);
            throw error;
        }
    }
}