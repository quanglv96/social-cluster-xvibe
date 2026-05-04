import { ExcelService } from '../services/ExcelService.js';
import { ApiService } from '../services/ApiService.js';
import {nowIso} from "../utils/time.js";

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
// Trigger
// =========================

export class FbCrawlTrigger {
    static useEventPage = true;

    constructor(social) {
        this.social = social;
    }

    async execute(dto, page) {
        if (!page) {
            throw new Error("FbCrawlTrigger requires an event page");
        }

        const { id, source, last_image, type } = dto;
        const jobId = id || `JOB_${Date.now()}`;
        const startTime = Date.now();

        const separator = '='.repeat(60);
        log(jobId, separator);
        log(jobId, `🚀 START CRAWL`, { source, time: nowIso() });

        try {
            // =====================
            // 1. CRAWL
            // =====================
            log(jobId, `🔍 Crawling images...`);

            const { success, images, newLastUrl } =
                await this.social.fbCrawler(dto, page);

            logOk(jobId, `Crawl done`, { images: images.length });

            if (!images.length) {
                logWarn(jobId, `No new images`, { totalMs: Date.now() - startTime });
                return {
                    images: [],
                    message: 'No new images'
                };
            }

            // =====================
            // 2. BUILD EXCEL
            // =====================
            log(jobId, `📄 Building Excel file...`);

            const buffer = await ExcelService.buildExcel(images, source);

            logOk(jobId, `Excel created`);

            // =====================
            // 3. UPLOAD FILE
            // =====================
            log(jobId, `☁️ Uploading Excel to backend...`);

            await ApiService.uploadExcel(buffer);

            logOk(jobId, `Upload success`);

            // =====================
            // 4. UPDATE CHECKPOINT
            // =====================
            log(jobId, `🔄 Updating checkpoint...`);

            if (newLastUrl && newLastUrl !== last_image) {
                await ApiService.updatePageCheckpoint(id, newLastUrl);
                logOk(jobId, `Checkpoint updated`, { newLastUrl });
            } else {
                log(jobId, `⏭ Checkpoint unchanged`);
            }

            logOk(jobId, `🎉 DONE`, { totalMs: Date.now() - startTime });
            log(jobId, separator);

            return { success, images, newLastUrl };

        } catch (error) {
            logError(jobId, `CRAWL FAILED`, error);
            log(jobId, `⏱ Failed after ${Date.now() - startTime}ms`);
            throw error;
        }
    }
}