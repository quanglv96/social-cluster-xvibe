import express from 'express';
import {chromium} from 'playwright';

import {crawlPage} from './crawler/crawler.js';
import {uploadExcel, updatePageCheckpoint} from './crawler/apiCrawler.js';
import {buildExcel} from './crawler/excel.js';
import {config} from './config.js';

const app = express();
app.use(express.json());

let browser;
let context;

/**
 * ===== INIT BROWSER 1 LẦN =====
 */
async function initBrowser(rawCookie) {

    if (browser) return;

    console.log('🌐 Launch browser...');
    console.log(rawCookie);

    browser = await chromium.launch({
        headless: config.headless
    });

    context = await browser.newContext();
    let cookies;
    // 🔥 Nếu BE gửi string JSON
    if (typeof rawCookie === 'string') {
        cookies = JSON.parse(rawCookie);
    } else {
        cookies = rawCookie;
    }
    await context.addCookies(cookies);
    console.log('🍪 Cookie loaded');
}
/**
 * ===== TRIGGER CRAWL API =====
 */
app.post('/trigger-crawl', async (req, res) => {

    try {

        const {id, last_image: lastImage, cookie: cookie} = req.body;

        console.log('🔥 request id:', id);
        console.log('🔥 request lastImage:', lastImage);

        if (!id || !lastImage || !cookie) {
            return res.status(400).json({message: 'Missing id or lastImage or cookie'});
        }

        await initBrowser(cookie);

        console.log('\n===================================');
        console.log('🔥 TRIGGER CRAWL:', id);

        const {images, newLastUrl} =
            await crawlPage(
                {
                    id,
                    lastImage   // ES shorthand
                },
                context
            );

        if (!images.length) {
            console.log('⚠ Không có ảnh mới');

            return res.json({
                success: true,
                message: 'No new images'
            });
        }

        console.log(`📸 Collected ${images.length} images`);

        // ===== BUILD EXCEL =====
        const excelFile = await buildExcel(id, images);

        console.log('📄 Excel created:', excelFile);

        // ===== UPLOAD EXCEL =====
        await uploadExcel(excelFile);

        console.log('⬆ Excel uploaded');

        // ===== UPDATE CHECKPOINT =====
        await updatePageCheckpoint(id, newLastUrl);

        console.log('🆕 Checkpoint updated');

        res.json({
            success: true,
            images: images.length
        });

    } catch (err) {

        console.error('❌ TRIGGER ERROR');
        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * ===== START SERVER =====
 */
const PORT = process.env.CRAWLER_PORT || 3001;

app.listen(PORT, () => {
    console.log(`🚀 FB crawler trigger server running at ${PORT}`);
});
