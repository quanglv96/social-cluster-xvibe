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

        // ✅ Truncate thông minh
        const finalContent = this.truncateTwitterContent(content, MAX_LENGTH);

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

    truncateTwitterContent(content, maxLength = 280) {
        const parsedTweet = twemoji.parseTweet(content);

        // Nếu hợp lệ, return luôn
        if (parsedTweet.valid) {
            return content;
        }

        console.log(`✂️ Content too long (${parsedTweet.weightedLength}/${maxLength}), truncating...`);

        // ✅ Tìm tất cả hashtags
        const hashtagRegex = /#[^\s#]+/g;
        const hashtags = [];
        let match;

        while ((match = hashtagRegex.exec(content)) !== null) {
            hashtags.push({
                tag: match[0],
                start: match.index,
                end: match.index + match[0].length
            });
        }

        if (hashtags.length === 0) {
            // Không có hashtag, cắt bình thường
            let truncated = content;
            while (truncated.length > 0) {
                truncated = truncated.slice(0, -1);
                if (twemoji.parseTweet(truncated).valid) {
                    return truncated;
                }
            }
            return truncated;
        }

        // ✅ Cắt từng hashtag từ cuối lên đầu
        for (let i = hashtags.length - 1; i >= 0; i--) {
            const cutPosition = hashtags[i].start;
            const truncated = content.substring(0, cutPosition).trimEnd();

            const testParse = twemoji.parseTweet(truncated);

            console.log(`🔍 Testing without "${hashtags[i].tag}": ${testParse.weightedLength}/${maxLength}`);

            if (testParse.valid) {
                console.log(`✅ Removed ${hashtags.length - i} hashtag(s) from the end`);
                return truncated;
            }
        }

        // Nếu vẫn quá dài sau khi xóa hết hashtags, cắt bình thường
        let truncated = content;
        while (truncated.length > 0) {
            truncated = truncated.slice(0, -1);
            if (twemoji.parseTweet(truncated).valid) {
                return truncated;
            }
        }

        return truncated;
    }
}
