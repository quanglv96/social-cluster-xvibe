import fs from 'fs';
import axios from 'axios';
import path from 'path';
import twemoji from 'twitter-text';
export class TwitterPost {

    constructor(context) {
        this.context = context;
    }

    async downloadImage(url, index) {

        const filePath = path.resolve(`./tw_image_${index}.jpg`);

        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(filePath));
            writer.on('error', reject);
        });
    }

    async post({content, url_groups: imageUrls = []}) {


        const MAX_LENGTH = 280;

        if (!content || content.trim().length === 0) {
            throw new Error('Content cannot be empty');
        }

        // ✅ Dùng twitter-text library (chính xác 100%)
        const parsedTweet = twemoji.parseTweet(content);

        console.log(`📝 Twitter weighted length: ${parsedTweet.weightedLength}/${MAX_LENGTH}`);
        console.log(`📝 Raw length: ${content.length}`);
        console.log(`✅ Valid: ${parsedTweet.valid}`);

        let finalContent = content;

        if (!parsedTweet.valid) {
            console.log(`✂️ Content too long, truncating...`);

            // Cắt từng ký tự cho đến khi valid
            let truncated = content;
            while (truncated.length > 0) {
                truncated = truncated.slice(0, -1);
                const testParse = twemoji.parseTweet(truncated);
                if (testParse.valid) {
                    finalContent = truncated;
                    console.log(`✅ Truncated to: ${testParse.weightedLength}/${MAX_LENGTH}`);
                    break;
                }
            }
        }

        const page = await this.context.newPage();

        await page.goto('https://x.com/home', {waitUntil: 'domcontentloaded'});
        await page.waitForTimeout(5000);

        await page.click('a[data-testid="SideNav_NewTweet_Button"]');
        await page.waitForTimeout(3000);

        await page.fill('div[role="textbox"]', finalContent);
        await page.waitForTimeout(2000);

        const uploadedFiles = [];

        for (let i = 0; i < imageUrls.length; i++) {

            const filePath = await this.downloadImage(imageUrls[i], i);

            const input = await page.$('input[type="file"]');
            await input.setInputFiles(filePath);

            uploadedFiles.push(filePath);

            await page.waitForTimeout(5000);
        }
        // Sau khi fill content và upload ảnh

        // Thử nhiều cách
        // try {
        //     // Cách 1: Dùng role
        //     await page.getByRole('button', { name: /Post|Đăng/i }).click({ timeout: 5000 });
        //     console.log('✅ Posted using role button');
        // } catch (err1) {
        //     try {
        //         // Cách 2: Dùng testid
        //         await page.click('div[data-testid="tweetButtonInline"]', { timeout: 5000 });
        //         console.log('✅ Posted using testid');
        //     } catch (err2) {
        //         // Cách 3: Dùng text selector
        //         await page.locator('span:has-text("Đăng"), span:has-text("Post")').first().click();
        //         console.log('✅ Posted using text selector');
        //     }
        // }

        console.log('⌨️ Pressing Ctrl+Enter to post...');
        await page.keyboard.press('Control+Enter');
        await page.waitForTimeout(5000);
        await page.waitForTimeout(5000);

        for (const file of uploadedFiles) {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        }

        await page.close();
    }
}
