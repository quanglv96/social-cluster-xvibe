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

    async crawl({ id, last_image, source }, page) {

        if (!page) {
            throw new Error("TwitterCrawler requires a page");
        }

        const crawlId = id || `TW_${Date.now()}`;
        const startTime = Date.now();

        console.log(`[${crawlId}] =============================`);
        console.log(`[${crawlId}] 🐦 START TWITTER GRID CRAWL`);
        console.log(`[${crawlId}] Last image: ${last_image}`);

        const images = [];
        let stop = false;
        let newLastUrl = null;

        try {

            await page.waitForTimeout(3000);

            const normalizedLast =
                last_image ? this.normalizeImage(last_image) : null;

            for (let i = 0; i <= 10; i++) {

                if (stop) break;

                const selector = `#verticalGridItem-${i}-profile-grid-0`;

                console.log(`[${crawlId}] 🔍 Checking ${selector}`);

                const imageData = await page.evaluate((selector) => {

                    const node = document.querySelector(selector);

                    if (!node) return null;

                    const img = node.querySelector('img');

                    if (!img || !img.src) return null;

                    return {
                        url: img.src,
                        width: img.naturalWidth,
                        height: img.naturalHeight
                    };

                }, selector);

                if (!imageData) {

                    console.log(`[${crawlId}] ⚠ No image found`);
                    continue;

                }

                // ===== SKIP VIDEO =====
                if (imageData.url.includes("video")) {
                    console.log(`[${crawlId}] ⏭ Skip video media`);
                    continue;
                }
                const normalizedUrl = this.normalizeImage(imageData.url);

                console.log(`[${crawlId}] 📸 Found image: ${normalizedUrl}`);

                // ===== CHECK LAST IMAGE =====
                if (normalizedLast && normalizedUrl === normalizedLast) {
                    console.log(`[${crawlId}] 🛑 Last image matched → STOP CRAWL`);
                    stop = true;
                    break;

                }
                if(i===0 && normalizedLast && normalizedUrl !== normalizedLast) {
                    console.log(`[${crawlId}] ⚠ Last image mismatch on first item! Expected: ${normalizedLast}`);
                    newLastUrl=normalizedUrl;
                }
                images.push({
                    url: normalizedUrl,
                    width: imageData.width,
                    height: imageData.height
                });

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
            throw err;

        } finally {

            console.log(
                `[${crawlId}] ⏱ Finished after ${Date.now() - startTime}ms`
            );

            console.log(`[${crawlId}] =============================\n`);
        }
    }
}