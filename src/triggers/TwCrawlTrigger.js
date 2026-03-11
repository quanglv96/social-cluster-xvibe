import {ExcelService} from '../services/ExcelService.js';
import {ApiService} from '../services/ApiService.js';

export class TwCrawlTrigger {

    static useEventPage = true;

    constructor(social) {
        this.social = social;
    }

    async execute(dto, page) {

        if (!page) {
            throw new Error("TwCrawlTrigger requires an event page");
        }

        const {id, source, last_image, type} = dto;

        const jobId = id || `TW_JOB_${Date.now()}`;
        const startTime = Date.now();

        console.log(`[${jobId}] =============================`);
        console.log(`[${jobId}] 🐦 START TWITTER CRAWL`);
        console.log(`[${jobId}] Source: ${source}`);
        console.log(`[${jobId}] Time: ${new Date().toISOString()}`);

        try {

            // =====================
            // 1. OPEN MEDIA PAGE
            // =====================
            console.log(`[${jobId}] 🌐 Opening media page...`);

            await page.goto(source + '/media', {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });

            await page.waitForTimeout(3000);

            // =====================
            // 2. CRAWL
            // =====================
            console.log(`[${jobId}] 🔍 Crawling images...`);

            const {images, newLastUrl} =
                await this.social.twCrawler(dto, page);

            console.log(`[${jobId}] ✅ Crawl done. Found ${images.length} images`);

            if (!images.length) {

                console.log(`[${jobId}] ⚠ No new images`);
                console.log(`[${jobId}] ⏱ Total time: ${Date.now() - startTime}ms`);

                return {
                    images: [],
                    message: 'No new images'
                };
            }

            // =====================
            // 2. BUILD EXCEL
            // =====================
            console.log(`[${jobId}] 📄 Building Excel file...`);

            const buffer =
                await ExcelService.buildExcel(images, source);

            console.log(`[${jobId}] ✅ Excel created success`);

            // =====================
            // 3. UPLOAD FILE
            // =====================
            console.log(`[${jobId}] ☁ Uploading Excel to backend...`);

            await ApiService.uploadExcel(buffer);

            console.log(`[${jobId}] ✅ Upload success`);

            // =====================
            // 4. UPDATE CHECKPOINT
            // =====================
            console.log(`[${jobId}] 🔄 Updating checkpoint...`);
            if (newLastUrl) {
                await ApiService.updatePageCheckpoint(id, newLastUrl);
            }

            console.log(`[${jobId}] ✅ Checkpoint updated`);

            console.log(
                `[${jobId}] 🎉 DONE - Total time: ${Date.now() - startTime}ms`
            );

            console.log(`[${jobId}] =============================`);

            return {
                images,
                newLastUrl
            };

        } catch (error) {

            console.error(`[${jobId}] ❌ ERROR:`, error.message);

            console.error(
                `[${jobId}] ⏱ Failed after ${Date.now() - startTime}ms`
            );

            throw error;
        }
    }
}