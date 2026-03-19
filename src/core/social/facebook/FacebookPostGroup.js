import fs from 'fs';
import axios from 'axios';
import path from 'path';
import os from 'os';

import { DelayService } from '../../../services/delay.service.js';
import {FacebookPostProfile} from "./FacebookPostProfile.js";

export class FacebookPostGroup {

    static lastMode = 'PAGE';

    constructor(context) {
        this.context = context;
        this.TAG = '[FacebookPostGroup]';
        this.delay = new DelayService();
        this.profile = new FacebookPostProfile();
    }

    log(message, data = {}) {
        console.log(
            `${this.TAG} ${new Date().toISOString()} - ${message}`,
            data
        );
    }

    getNextPostMode() {
        const next =
            FacebookPostGroup.lastMode === 'PAGE'
                ? 'PROFILE'
                : 'PAGE';

        FacebookPostGroup.lastMode = next;
        return next;
    }

    /**
     * 🔥 page được truyền từ SessionManager
     */
    async post({
                   page_admin_url: pageAdminUrl,
                   content,
                   url_image: imageUrl,
                   url_groups: groupUrls
               }, page) {

        if (!page) {
            throw new Error("FacebookPostGroup requires an event page");
        }

        let imageFilePath = null;

        try {

            this.log('Start post process', {
                totalGroups: groupUrls.length,
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
                await this.profile.postToProfile(page, content, imageFilePath);
            } catch (err) {
                this.log('Profile post failed', {error: err.message});
            }

            /**
             * ===== SWITCH PROFILE =====
             */
            const postMode = this.getNextPostMode();

            this.log('Auto select posting mode', {postMode});

            if (postMode === 'PAGE' && pageAdminUrl) {
                await this.switchToPage(page, pageAdminUrl);
            }

            const groups = groupUrls.slice(0, 10);

            for (let i = 0; i < groups.length; i++) {

                const groupUrl = groups[i];

                try {

                    this.log('Posting to group', {
                        groupIndex: i + 1,
                        total: groups.length,
                        groupUrl
                    });

                    await page.goto(groupUrl, {
                        waitUntil: 'domcontentloaded'
                    });

                    await this.delay.navigation('after goto group', page);

                    const postBox = await page.waitForSelector(
                        'span:has-text("Bạn viết gì đi..."), span:has-text("Write something"), span:has-text("What\'s on your mind")',
                        {timeout: 15000}
                    );

                    if (!postBox) {
                        throw new Error('Cannot find post box');
                    }

                    await postBox.click();
                    this.log('Post box clicked');

                    await this.delay.action('after click post box', page);

                    const textbox = await page.waitForSelector(
                        'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
                        {timeout: 10000}
                    );

                    if (!textbox) {
                        throw new Error('Cannot find textbox');
                    }

                    await textbox.click();
                    await this.delay.action('after focus textbox', page);

                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');

                    await textbox.type(content, {
                        delay: this.delay.random(40, 120)
                    });

                    this.log('Content filled');

                    await this.delay.action('after typing content', page);

                    if (imageFilePath) {
                        await this.uploadImageFile(page, imageFilePath);
                    }

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
                            this.log('Post button clicked', {selector});
                            break;
                        }
                    }

                    if (!clicked) {
                        throw new Error('Cannot find enabled Post button');
                    }

                    await this.delay.navigation('after click post button', page);

                    this.log('Post success', {groupUrl});

                } catch (err) {

                    this.log('Post failed for group', {
                        groupUrl,
                        error: err.message
                    });
                }

                if (i < groups.length - 1) {
                    await this.delay.betweenGroup('cooldown between groups');
                }
            }

            this.log('Post process completed');
            return   {success: true}
        } finally {

            if (imageFilePath && fs.existsSync(imageFilePath)) {
                fs.unlinkSync(imageFilePath);
                this.log('Temporary image deleted', {imageFilePath});
            }

        }
    }

    async switchToPage(page, pageAdminUrl) {

        this.log('Switching profile', { pageAdminUrl });

        await page.goto(pageAdminUrl, {
            waitUntil: 'domcontentloaded'
        });

        await this.delay.navigation('after goto page admin', page);

        const switchBtn = await page.$(
            'span:has-text("Chuyển ngay"), span:has-text("Switch Now")'
        );

        if (!switchBtn) {
            this.log('Switch button not found, continue current profile');
            return;
        }

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
            switchBtn.click()
        ]);

        await this.delay.navigation('after switch profile', page);

        this.log('Profile switched', {
            currentUrl: page.url()
        });
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