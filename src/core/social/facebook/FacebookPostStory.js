import fs from 'fs';
import axios from 'axios';
import path from 'path';
import os from 'os';

import { DelayService } from '../../../services/delay.service.js';
import {config} from "../../../config/config.js";

export class FacebookPostStory {

    constructor(context) {
        this.context = context;
        this.TAG = '[FacebookPostStory]';
        this.delay = new DelayService();
    }

    log(message, data = {}) {
        console.log(
            `${this.TAG} ${new Date().toISOString()} - ${message}`,
            data
        );
    }

    async post({
                   page_admin_url,
                   list_image,
                   user_name,
                   password
               }, page) {

        if (!page) {
            throw new Error("FacebookPostStory requires event page");
        }

        let tempFiles = [];

        try {

            this.log('Start story posting', {
                totalImages: list_image.length
            });

            await page.goto('https://www.facebook.com/', {
                waitUntil: 'domcontentloaded'
            });

            await this.delay.navigation('after goto facebook', page);

            // ===== DOWNLOAD IMAGE ONCE =====
            for (const url of list_image) {
                const file = await this.downloadImage(url);
                tempFiles.push(file);
            }

            /**
             * ==========================
             * 1️⃣ POST TO PROFILE
             * ==========================
             */
            this.log('Posting story to PROFILE');
            await this.postStoryFlow(page, tempFiles, 'profile');

            /**
             * ==========================
             * 2️⃣ SWITCH TO PAGE
             * ==========================
             */
            if (page_admin_url) {

                this.log('Switching to PAGE');

                await this.switchToPage(page, page_admin_url );

                this.log('Posting story to PAGE');

                await this.postStoryFlow(page, tempFiles, 'page');
            }

            this.log('Story process completed');

        } finally {

            for (const file of tempFiles) {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            }

            this.log('Temporary files cleaned');
        }
    }

    /**
     * ===== COMMON STORY FLOW =====
     */
    async postStoryFlow(page, filePaths, mode) {

        for (let i = 0; i < filePaths.length; i++) {

            this.log('Posting story image', { index: i + 1 });

            if (mode === 'page') {
                await this.openCreateStoryPage(page);
            } else {
                await this.openCreateStoryProfile(page);
            }

            await this.uploadStoryByDrop(page, filePaths[i]);
            if (mode === 'page') {
                await this.addLinkButton(page, `${config.rootUrl}`);
            }
            await this.shareStory(page);

            await this.delay.betweenGroup('cooldown between stories');
        }
    }
    async addLinkButton(page, url) {

        // 1️⃣ Click "Thêm nút"
        const addBtn = page.locator(
            'span:has-text("Thêm nút")'
        ).first();

        await addBtn.waitFor({ timeout: 15000 });
        await addBtn.click({ force: true });

        await page.waitForTimeout(2000);


        // 2️⃣ Chọn radio "web link"
        const webLinkRadio = page.locator(
            'input[type="radio"][value="web link"]'
        );

        await webLinkRadio.waitFor({ timeout: 10000 });
        await webLinkRadio.check({ force: true });

        await page.waitForTimeout(1000);


        // 3️⃣ Nhập link
        const inputLink = page.locator(
            'span:has-text("Nhập liên kết")'
        ).locator('xpath=ancestor::div[1]//input');

        await inputLink.fill(url, { force: true });

        await page.waitForTimeout(2000);
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
        await page.goto('https://www.facebook.com/', {
            waitUntil: 'domcontentloaded'
        });

        await this.delay.navigation('after goto facebook', page);
    }

    async openCreateStoryProfile(page) {
        const createStoryLink = page.locator(
            'a[href="/stories/create/"], a[aria-label="Tạo tin"], a[aria-label="Create story"]'
        ).first();

        await createStoryLink.waitFor({ state: 'visible', timeout: 15000 });
        await createStoryLink.click();

        await this.delay.action('after click create story', page);
        await this.delay.action('after click image story option', page);
    }

    async openCreateStoryPage(page) {

        const createBtn = page.locator(
            'a[aria-label="Tạo tin"], a[aria-label="Create story"]'
        ).first();

        await createBtn.waitFor({ timeout: 20000 });

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            createBtn.click()
        ]);

        await page.waitForLoadState('networkidle');

        await page.waitForTimeout(4000);
    }
    async uploadStoryByDrop(page, filePath) {

        const fileName = path.basename(filePath);
        const fileBase64 = fs.readFileSync(filePath, { encoding: 'base64' });

        const dataTransfer = await page.evaluateHandle(
            async ({ fileBase64, fileName }) => {

                const byteCharacters = atob(fileBase64);
                const byteNumbers = new Array(byteCharacters.length);

                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }

                const byteArray = new Uint8Array(byteNumbers);

                const blob = new Blob([byteArray], { type: 'image/jpeg' });
                const file = new File([blob], fileName, { type: 'image/jpeg' });

                const dt = new DataTransfer();
                dt.items.add(file);

                return dt;

            },
            { fileBase64, fileName }
        );

        // drop vào body
        await page.dispatchEvent('body', 'dragenter', { dataTransfer });
        await page.dispatchEvent('body', 'dragover', { dataTransfer });
        await page.dispatchEvent('body', 'drop', { dataTransfer });

        await page.waitForTimeout(5000);
    }
    async shareStory(page) {

        const shareBtn = page.locator(
            'span:has-text("Chia sẻ lên tin")'
        ).locator('xpath=ancestor::div[1]');

        await shareBtn.waitFor({ timeout: 20000 });

        await shareBtn.click({ force: true });

        await page.waitForTimeout(5000);
    }

    async downloadImage(url) {

        const response = await axios.get(url, {
            responseType: 'arraybuffer'
        });

        const filePath = path.join(
            os.tmpdir(),
            `story_${Date.now()}_${Math.random()}.jpg`
        );

        await fs.promises.writeFile(filePath, response.data);

        return filePath;
    }
}