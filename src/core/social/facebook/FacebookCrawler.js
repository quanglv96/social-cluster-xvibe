import {config} from "../../../config/config.js";

export class FacebookCrawler {

    constructor(context) {
        this.context = context;
    }

    async crawl({ id, last_image }) {

        const crawlId = id || `CRAWL_${Date.now()}`;
        const startTime = Date.now();

        console.log(`[${crawlId}] =============================`);
        console.log(`[${crawlId}] 📸 START FACEBOOK CRAWL`);
        console.log(`[${crawlId}] Last image: ${last_image}`);

        const page = await this.context.newPage();
        console.log(`[${crawlId}] 🌐 New page created`);

        try {

            console.log(`[${crawlId}] ➡ Navigating to viewer...`);
            await page.goto(last_image, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(5000);
            console.log(`[${crawlId}] ✅ Viewer loaded`);

            const images = [];
            let newLastUrl = last_image;

            const MAX_IMAGES = config.maxImages;

            while (images.length < MAX_IMAGES) {

                console.log(
                    `[${crawlId}] 🔍 Extracting image ${images.length + 1}/${MAX_IMAGES}`
                );

                const imageData = await page.evaluate(() => {

                    const img =
                        document.querySelector('div[role="dialog"] img') ||
                        document.querySelector('img');

                    if (!img) return null;

                    return {
                        url: img.src,
                        width: img.naturalWidth,
                        height: img.naturalHeight
                    };
                });

                if (!imageData) {
                    console.log(`[${crawlId}] ⚠ No image found in viewer → STOP`);
                    break;
                }

                if (images.some(i => i.url === imageData.url)) {
                    console.log(`[${crawlId}] ⚠ Duplicate image detected → STOP`);
                    break;
                }

                console.log(
                    `[${crawlId}] ✅ Image found: ${imageData.url}`
                );
                console.log(
                    `[${crawlId}] 📐 Size: ${imageData.width}x${imageData.height}`
                );

                images.push(imageData);
                newLastUrl = page.url();

                console.log(`[${crawlId}] ⬅ Moving to previous image`);
                await page.keyboard.press('ArrowLeft');
                await page.waitForTimeout(3000);
            }

            console.log(
                `[${crawlId}] 🎯 Crawl finished. Total images: ${images.length}`
            );
            console.log(
                `[${crawlId}] ⏱ Duration: ${Date.now() - startTime}ms`
            );

            return { images, newLastUrl };

        } catch (err) {

            console.error(`[${crawlId}] ❌ Crawl error: ${err.message}`);
            console.error(
                `[${crawlId}] ⏱ Failed after ${Date.now() - startTime}ms`
            );
            throw err;

        } finally {

            console.log(`[${crawlId}] 🔒 Closing page`);
            await page.close();
            console.log(`[${crawlId}] =============================\n`);
        }
    }
}
