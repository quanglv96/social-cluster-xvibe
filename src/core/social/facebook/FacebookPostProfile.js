import fs from 'fs';
import axios from 'axios';
import path from 'path';
import os from 'os';

import {DelayService} from '../../../services/delay.service.js';

export class FacebookPostProfile {

    constructor(context) {
        this.context = context;
        this.TAG = '[FacebookPostGroup]';
        this.delay = new DelayService();
    }

    log(message, data = {}) {
        console.log(
            `${this.TAG} ${new Date().toISOString()} - ${message}`,
            data
        );
    }

    async post({
                   content,
                   url_image: imageUrl,
               }, page) {

        if (!page) {
            throw new Error("FacebookPostProfile requires an event page");
        }

        let imageFilePath = null;

        try {

            this.log('Start post process', {
                hasImage: !!imageUrl
            });

            /**
             * ===== DOWNLOAD IMAGE ONCE =====
             */
            if (imageUrl) {
                this.log('Start downloading image', {url: imageUrl});
                imageFilePath = await this.downloadImage(imageUrl);
                this.log('Image downloaded successfully', {
                    filePath: imageFilePath
                });
            }

            /**
             * ===== POST TO PROFILE FIRST =====
             */
            await page.goto('https://www.facebook.com/', {
                waitUntil: 'domcontentloaded'
            });

            await this.delay.navigation('after goto home', page);

            try {
                await this.postToProfile(page, content, imageFilePath);
            } catch (err) {
                this.log('Profile post failed', {error: err.message});
            }
            this.log('Post process completed');
            return {success: true}
        } finally {

            if (imageFilePath && fs.existsSync(imageFilePath)) {
                fs.unlinkSync(imageFilePath);
                this.log('Temporary image deleted', {imageFilePath});
            }

        }
    }

    async postToProfile(page, content, imageFilePath) {

        this.log('Start posting to PROFILE timeline');

        /**
         * ===== CLICK POST BOX =====
         */
        const postBox = await page.waitForSelector(
            'div[role="button"]:has(span:has-text("nghĩ gì")), \
             div[role="button"]:has(span:has-text("What\'s on your mind"))',
            {timeout: 20000}
        );

        if (!postBox) {
            throw new Error('Cannot find profile post box');
        }

        await postBox.click();
        await this.delay.action('after click profile post box', page);

        /**
         * ===== FIND TEXTBOX =====
         */
        const textbox = await page.waitForSelector(
            'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
            {timeout: 10000}
        );

        if (!textbox) {
            throw new Error('Cannot find profile textbox');
        }

        await textbox.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');

        await textbox.type(content, {
            delay: this.delay.random(40, 120)
        });

        this.log('Profile content filled');

        await this.delay.action('after typing profile content', page);

        /**
         * ===== UPLOAD IMAGE =====
         */
        if (imageFilePath) {
            await this.uploadImageFile(page, imageFilePath);
        }
        const postBtnNext = [
            'div[role="dialog"] div[aria-label="Tiếp"]',
            'div[role="dialog"] div[aria-label="Next"]',
            'div[role="dialog"] div[role="button"]:has-text("Tiếp")',
            'div[role="dialog"] div[role="button"]:has-text("Next")',
        ];

        let clickedNext = false;

        for (const selector of postBtnNext) {
            const btn = await page.$(selector);
            if (!btn) continue;

            const isDisabled = await btn.evaluate(el =>
                el.getAttribute('aria-disabled') === 'true'
            );

            if (!isDisabled) {
                await btn.click();
                clickedNext = true;
                this.log('Profile post button clickedNext', {selector});
                break;
            }
        }

        if (!clickedNext) {
            throw new Error('Cannot find enabled profile Next button');
        }
        await page.waitForTimeout(2000);
        /**
         * ===== CLICK POST BUTTON =====
         */
        const postBtnSelectors = [
            'div[role="dialog"] div[aria-label="Đăng"]',
            'div[role="dialog"] div[aria-label="Post"]',
            'div[role="dialog"] div[role="button"]:has-text("Đăng")',
            'div[role="dialog"] div[role="button"]:has-text("Post")',
        ];

        let clicked = false;

        for (const selector of postBtnSelectors) {
            const btn = await page.$(selector);
            if (!btn) continue;

            const isDisabled = await btn.evaluate(el =>
                el.getAttribute('aria-disabled') === 'true'
            );

            if (!isDisabled) {
                await btn.click();
                clicked = true;
                this.log('Profile post button clicked', {selector});
                break;
            }
        }

        if (!clicked) {
            throw new Error('Cannot find enabled profile Post button');
        }

        await this.delay.navigation('after click profile post', page);

        this.log('Profile post success');
    }

    async downloadImage(url) {

        const response = await axios.get(url, {
            responseType: 'arraybuffer'
        });

        const filePath = path.join(
            os.tmpdir(),
            `temp_image_${Date.now()}.jpg`
        );

        await fs.promises.writeFile(filePath, response.data);

        return filePath;
    }

    async uploadImageFile(page, filePath) {

        const inputFileSelectors = [
            'div[role="dialog"] input[type="file"][accept*="image"]',
            'div[role="dialog"] input[type="file"]',
            'input[type="file"][accept*="image"]',
            'input[type="file"]'
        ];

        let inputFile = null;

        for (const selector of inputFileSelectors) {
            inputFile = await page.$(selector);
            if (inputFile) break;
        }

        if (!inputFile) {
            throw new Error("Cannot find file input");
        }

        await inputFile.setInputFiles(filePath);

        await this.delay.upload('after image upload');

        this.log('Image uploaded successfully');
    }
}