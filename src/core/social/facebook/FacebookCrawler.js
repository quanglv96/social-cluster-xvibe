import { config } from "../../../config/config.js";

export class FacebookCrawler {

    constructor(context) {
        this.context = context;
    }

    /**
     * page được truyền từ SessionManager (event tab)
     */
    async crawl({ id, last_image, source }, page) {

        if (!page) {
            throw new Error("FacebookCrawler requires an event page");
        }

        const crawlId = id || `CRAWL_${Date.now()}`;
        const startTime = Date.now();

        console.log(`[${crawlId}] =============================`);
        console.log(`[${crawlId}] 📸 START FACEBOOK CRAWL`);
        console.log(`[${crawlId}] Last image: ${last_image}`);
        console.log(`[${crawlId}] 🌐 Using injected event page`);

        try {

            console.log(`[${crawlId}] ➡ Navigating to viewer...`);
            await page.goto(last_image, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(5000);
            console.log(`[${crawlId}] ✅ Viewer loaded`);
            //
            // 🔥 Click nút toàn màn hình nếu tồn tại
            //
            try {
                const fullscreenButton = await page.$(
                    'div[aria-label="Chuyển sang toàn màn hình"][role="button"], div[aria-label="Switch to fullscreen"][role="button"]'
                );

                if (fullscreenButton) {
                    console.log(`[${crawlId}] 🖥 Switching to fullscreen mode...`);
                    await fullscreenButton.click();
                    await page.waitForTimeout(2000);
                    console.log(`[${crawlId}] ✅ Fullscreen activated`);
                } else {
                    console.log(`[${crawlId}] ℹ Fullscreen button not found`);
                }

            } catch (err) {
                console.log(`[${crawlId}] ⚠ Fullscreen click failed: ${err.message}`);
            }
            const images = [];
            let newLastUrl = last_image;

            const MAX_IMAGES = config.maxImages;
            while (images.length < MAX_IMAGES) {

                console.log(
                    `[${crawlId}] 🔍 Extracting image ${images.length + 1}/${MAX_IMAGES}`
                );

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

            console.log(
                `[${crawlId}] ⏱ Finished after ${Date.now() - startTime}ms`
            );
            console.log(`[${crawlId}] =============================\n`);
        }
    }
}