import fs from 'fs';
import axios from 'axios';
import path from 'path';

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

    async post({ content, imageUrls = [] }) {

        const page = await this.context.newPage();

        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);

        await page.click('a[data-testid="SideNav_NewTweet_Button"]');
        await page.waitForTimeout(3000);

        await page.fill('div[role="textbox"]', content);
        await page.waitForTimeout(2000);

        const uploadedFiles = [];

        for (let i = 0; i < imageUrls.length; i++) {

            const filePath = await this.downloadImage(imageUrls[i], i);

            const input = await page.$('input[type="file"]');
            await input.setInputFiles(filePath);

            uploadedFiles.push(filePath);

            await page.waitForTimeout(5000);
        }

        await page.click('div[data-testid="tweetButtonInline"]');
        await page.waitForTimeout(5000);

        for (const file of uploadedFiles) {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        }

        await page.close();
    }
}
