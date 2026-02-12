// twitter/TwitterPost.js
import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";

export class TwitterPost {

    constructor(context) {
        this.context = context;
    }

    async post({ content, imageUrls = [] }) {

        const page = await this.context.newPage();

        try {

            await page.goto('https://x.com/compose/post', {
                waitUntil: 'domcontentloaded'
            });

            await page.waitForSelector(
                'div[data-testid="tweetTextarea_0"]',
                { timeout: 20000 }
            );

            await page.click('div[data-testid="tweetTextarea_0"]');

            await page.keyboard.type(content, { delay: 20 });

            if (imageUrls && imageUrls.length > 0) {

                const fileInput = await page.waitForSelector(
                    'input[type="file"]',
                    { timeout: 20000 }
                );

                const downloadedFiles = [];

                for (const url of imageUrls) {

                    const response = await axios.get(url, {
                        responseType: "arraybuffer"
                    });

                    const filePath = path.join(
                        os.tmpdir(),
                        `tw_${Date.now()}_${Math.random()}.jpg`
                    );

                    await fs.promises.writeFile(filePath, response.data);

                    downloadedFiles.push(filePath);
                }

                await fileInput.setInputFiles(downloadedFiles);

                await page.waitForTimeout(5000);
            }

            await page.waitForSelector(
                'div[data-testid="tweetButtonInline"]',
                { timeout: 20000 }
            );

            await page.click('div[data-testid="tweetButtonInline"]');

            await page.waitForTimeout(6000);

            console.log("✅ Tweet posted successfully");

        } catch (err) {
            console.log("❌ Tweet failed:", err.message);
            throw err;
        } finally {
            await page.close();
        }
    }
}
