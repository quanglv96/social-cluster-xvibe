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

    /**
     * page được inject từ SessionManager
     */
    async post({ content, url_groups: imageUrls = [] }, page) {

        if (!page) {
            throw new Error("TwitterPost requires an event page");
        }

        const MAX_LENGTH = 280;

        if (!content || content.trim().length === 0) {
            throw new Error('Content cannot be empty');
        }

        // ✅ Truncate thông minh
        const finalContent = this.truncateTwitterContent(content, MAX_LENGTH);

        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
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

        console.log('⌨️ Pressing Ctrl+Enter to post...');
        await page.keyboard.press('Control+Enter');
        await page.waitForTimeout(5000);
        await page.waitForTimeout(5000);

        // Cleanup local temp files
        for (const file of uploadedFiles) {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        }

        return {success: true};
    }

    truncateTwitterContent(content, maxLength = 280) {

        const parsedTweet = twemoji.parseTweet(content);

        if (parsedTweet.valid) {
            return content;
        }

        console.log(
            `✂️ Content too long (${parsedTweet.weightedLength}/${maxLength}), truncating...`
        );

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

            let truncated = content;

            while (truncated.length > 0) {
                truncated = truncated.slice(0, -1);
                if (twemoji.parseTweet(truncated).valid) {
                    return truncated;
                }
            }

            return truncated;
        }

        // Cắt từng hashtag từ cuối lên đầu
        for (let i = hashtags.length - 1; i >= 0; i--) {

            const cutPosition = hashtags[i].start;
            const truncated = content.substring(0, cutPosition).trimEnd();
            const testParse = twemoji.parseTweet(truncated);

            console.log(
                `🔍 Testing without "${hashtags[i].tag}": ${testParse.weightedLength}/${maxLength}`
            );

            if (testParse.valid) {
                console.log(
                    `✅ Removed ${hashtags.length - i} hashtag(s) from the end`
                );
                return truncated;
            }
        }

        // Nếu vẫn quá dài
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