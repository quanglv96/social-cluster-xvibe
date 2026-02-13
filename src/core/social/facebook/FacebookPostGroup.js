import fs from 'fs';
import axios from 'axios';
import path from 'path';
import os from 'os';

export class FacebookPostGroup {

    constructor(context) {
        this.context = context;
        this.TAG = '[FacebookPostGroup]';
    }

    log(message, data = {}) {
        console.log(
            `${this.TAG} ${new Date().toISOString()} - ${message}`,
            data
        );
    }

    async post({
                   page_admin_url: pageAdminUrl,
                   content,
                   url_image: imageUrl,
                   url_groups: groupUrls
               }) {

        const page = await this.context.newPage();
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
             * ===== SWITCH PROFILE =====
             */
            await this.switchToPage(page, pageAdminUrl);

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

                    await page.waitForTimeout(5000);

                    /**
                     * ===== CLICK POST BOX =====
                     */
                    const postBox = await page.waitForSelector(
                        'span:has-text("Bạn viết gì đi..."), span:has-text("Write something"), span:has-text("What\'s on your mind")',
                        {timeout: 15000}
                    );

                    if (!postBox) {
                        throw new Error('Cannot find post box');
                    }

                    await postBox.click();
                    this.log('Post box clicked');

                    await page.waitForTimeout(3000);

                    /**
                     * ===== FIND DIALOG TEXTBOX =====
                     */
                    const textbox = await page.waitForSelector(
                        'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
                        {timeout: 10000}
                    );

                    if (!textbox) {
                        throw new Error('Cannot find textbox');
                    }

                    await textbox.click();
                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');

                    await textbox.type(content, {delay: 30});

                    this.log('Content filled');

                    await page.waitForTimeout(2000);

                    /**
                     * ===== UPLOAD IMAGE =====
                     */
                    if (imageFilePath) {
                        await this.uploadImageFile(page, imageFilePath);
                    }

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
                            this.log('Post button clicked', {selector});
                            break;
                        }
                    }

                    if (!clicked) {
                        throw new Error('Cannot find enabled Post button');
                    }

                    await page.waitForTimeout(8000);

                    this.log('Post success', {groupUrl});

                } catch (err) {

                    this.log('Post failed for group', {
                        groupUrl,
                        error: err.message
                    });
                }
            }

            this.log('Post process completed');

        } finally {

            if (imageFilePath && fs.existsSync(imageFilePath)) {
                fs.unlinkSync(imageFilePath);
                this.log('Temporary image deleted', {imageFilePath});
            }

            if (!page.isClosed()) {
                await page.close();
                this.log('Browser page closed');
            }
        }
    }

    async switchToPage(page, pageAdminUrl) {

        this.log('Switching profile', {pageAdminUrl});

        await page.goto(pageAdminUrl, {
            waitUntil: 'domcontentloaded'
        });

        await page.waitForTimeout(5000);

        const switchBtn = await page.$(
            'span:has-text("Chuyển ngay"), span:has-text("Switch Now")'
        );

        if (!switchBtn) {
            this.log('Switch button not found, continue current profile');
            return;
        }

        await Promise.all([
            page.waitForNavigation({waitUntil: 'domcontentloaded'}).catch(() => {
            }),
            switchBtn.click()
        ]);

        await page.waitForTimeout(5000);

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

    /**
     * Upload file ảnh đã có sẵn
     */
    async uploadImageFile(page, filePath) {

        try {
            console.log("🔍 Looking for file input...");

            const inputFileSelectors = [
                'div[role="dialog"] input[type="file"][accept*="image"]',
                'div[role="dialog"] input[type="file"]',
                'input[type="file"][accept*="image"]',
                'input[type="file"]'
            ];

            let inputFile = null;
            for (const selector of inputFileSelectors) {
                console.log(`🔍 Trying file input selector: ${selector}`);
                inputFile = await page.$(selector);
                if (inputFile) {
                    console.log(`✅ Found file input with selector: ${selector}`);
                    break;
                }
            }

            if (!inputFile) {
                throw new Error("Cannot find file input");
            }

            console.log("📤 Setting file to input...");
            await inputFile.setInputFiles(filePath);
            console.log("✅ File set to input");

            console.log("⏳ Waiting 5s for upload to complete...");
            await page.waitForTimeout(5000);

            console.log("✅✅✅ IMAGE UPLOAD SUCCESS ✅✅✅");

        } catch (err) {
            console.log("❌❌❌ IMAGE UPLOAD FAILED ❌❌❌");
            console.log("❌ Error:", err.message);
            console.log("❌ Stack:", err.stack);
        }
    }

}
