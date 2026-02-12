// postGroup.js
import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";

export class PostGroup {

    constructor(context) {
        this.context = context;
    }

    async post({
                   pageAdminUrl,
                   content,
                   imageUrl,
                   groupUrls
               }) {

        const page = await this.context.newPage();
        let imageFilePath = null; // Lưu đường dẫn file ảnh để xóa sau

        try {

            console.log("📋 START POST GROUP PROCESS");
            console.log("📋 Page Admin URL:", pageAdminUrl);
            console.log("📋 Content:", content);
            console.log("📋 Image URL:", imageUrl);
            console.log("📋 Total Groups:", groupUrls.length);

            // Download ảnh 1 LẦN nếu có
            if (imageUrl) {
                console.log("⬇️  Downloading image once for all groups...");
                imageFilePath = await this.downloadImage(imageUrl);
                console.log("✅ Image downloaded and saved at:", imageFilePath);
            }

            // Switch profile
            await this.switchToPage(page, pageAdminUrl);

            const groups = groupUrls.slice(0, 10);

            console.log(`📋 Processing ${groups.length} groups`);

            for (let i = 0; i < groups.length; i++) {

                const groupUrl = groups[i];

                if (page.isClosed()) {
                    console.log("⚠️ Page closed, stopping");
                    break;
                }

                console.log("\n" + "=".repeat(60));
                console.log(`📌 GROUP [${i + 1}/${groups.length}]: ${groupUrl}`);
                console.log("=".repeat(60));

                try {

                    console.log("🌐 Step 1: Navigating to group...");
                    await page.goto(groupUrl, {
                        waitUntil: 'domcontentloaded'
                    });

                    console.log("⏳ Step 2: Waiting 5s for page load...");
                    await page.waitForTimeout(5000);

                    console.log("📍 Step 3: Current URL:", page.url());

                    /**
                     * ===== CLICK POST BOX =====
                     */
                    console.log("🔍 Step 4: Looking for post box...");

                    const postBoxSpan = await page.waitForSelector(
                        'span.x1lliihq.x6ikm8r.x10wlt62.x1n2onr6:has-text("Bạn viết gì đi...")',
                        {timeout: 15000}
                    ).catch(() => null);

                    if (!postBoxSpan) {
                        console.log("❌ Post box span not found, trying alternative selectors...");

                        // Thử các selector khác
                        const alternatives = [
                            'span:has-text("Bạn viết gì đi...")',
                            'span:has-text("Write something")',
                            'span:has-text("What\'s on your mind")',
                        ];

                        let found = false;
                        for (const alt of alternatives) {
                            console.log(`🔍 Trying selector: ${alt}`);
                            const elem = await page.$(alt);
                            if (elem) {
                                await elem.click();
                                found = true;
                                console.log("✅ Clicked post box with alternative selector");
                                break;
                            }
                        }

                        if (!found) {
                            throw new Error("Cannot find post box");
                        }
                    } else {
                        console.log("✅ Found post box span");
                        await postBoxSpan.click();
                        console.log("✅ Clicked post box");
                    }

                    console.log("⏳ Step 5: Waiting 3s for dialog to open...");
                    await page.waitForTimeout(3000);

                    /**
                     * ===== TYPE CONTENT =====
                     */
                    console.log("🔍 Step 6: Looking for content textbox in dialog...");

                    const contentTextbox = await page.waitForSelector(
                        'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
                        {timeout: 10000}
                    );

                    if (!contentTextbox) {
                        throw new Error("Cannot find content textbox");
                    }

                    console.log("✅ Found content textbox");

                    await contentTextbox.click();
                    console.log("✅ Clicked content textbox");

                    await page.waitForTimeout(1000);

                    console.log("🧹 Step 7: Clearing existing text...");
                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');

                    console.log("⌨️  Step 8: Typing content...");
                    await contentTextbox.type(content, {delay: 30});
                    console.log("✅ Content typed successfully");

                    await page.waitForTimeout(2000);

                    /**
                     * ===== UPLOAD IMAGE =====
                     */
                    if (imageFilePath) {
                        console.log("🖼️  Step 9: Uploading image from local file...");
                        await this.uploadImageFile(page, imageFilePath);
                    } else {
                        console.log("⏭️  Step 9: No image to upload");
                    }

                    /**
                     * ===== CLICK POST =====
                     */
                    console.log("🔍 Step 10: Looking for Post button...");

                    const postButtonSelectors = [
                        'div[role="dialog"] div[aria-label="Đăng"]',
                        'div[role="dialog"] div[aria-label="Post"]',
                        'div[role="dialog"] div[role="button"]:has-text("Đăng")',
                        'div[role="dialog"] div[role="button"]:has-text("Post")',
                    ];

                    let postClicked = false;
                    for (const selector of postButtonSelectors) {
                        console.log(`🔍 Trying Post button selector: ${selector}`);
                        try {
                            const btn = await page.waitForSelector(selector, {timeout: 3000});
                            if (btn) {
                                console.log("✅ Found Post button");

                                const isDisabled = await btn.evaluate(el =>
                                    el.getAttribute('aria-disabled') === 'true'
                                );

                                console.log("🔍 Button disabled status:", isDisabled);

                                if (!isDisabled) {
                                    await btn.click();
                                    postClicked = true;
                                    console.log("✅ Clicked Post button");
                                    break;
                                } else {
                                    console.log("⚠️ Button is disabled, trying next selector");
                                }
                            }
                        } catch (e) {
                            console.log(`⚠️ Selector failed: ${e.message}`);
                            continue;
                        }
                    }

                    if (!postClicked) {
                        throw new Error("Cannot find or click Post button");
                    }

                    console.log("⏳ Step 11: Waiting 8s for post to complete...");
                    await page.waitForTimeout(8000);

                    console.log("✅✅✅ POST SUCCESS ✅✅✅");

                } catch (err) {
                    console.log("❌❌❌ POST FAILED ❌❌❌");
                    console.log("❌ Error:", err.message);
                    console.log("❌ Stack:", err.stack);

                    // Screenshot để debug
                    // const screenshotPath = `error_group_${i + 1}_${Date.now()}.png`;
                    // await page.screenshot({
                    //     path: screenshotPath,
                    //     fullPage: true
                    // }).catch(() => {});
                    // console.log("📸 Screenshot saved:", screenshotPath);
                }
            }

            console.log("\n" + "=".repeat(60));
            console.log("🎉 ALL GROUPS PROCESSED");
            console.log("=".repeat(60));

        } finally {

            // XÓA FILE ẢNH SAU KHI POST HẾT TẤT CẢ GROUPS
            if (imageFilePath) {
                console.log("🧹 Cleaning up image file...");
                try {
                    await fs.promises.unlink(imageFilePath);
                    console.log("✅ Image file deleted:", imageFilePath);
                } catch (err) {
                    console.log("⚠️ Failed to delete image file:", err.message);
                }
            }

            if (!page.isClosed()) {
                console.log("🔒 Closing page...");
                await page.close();
                console.log("✅ Page closed");
            }
        }
    }

    async switchToPage(page, pageAdminUrl) {

        console.log("\n" + "=".repeat(60));
        console.log("🔄 SWITCH TO PAGE PROFILE");
        console.log("=".repeat(60));

        console.log("🌐 Step 1: Navigating to page admin URL...");
        console.log("📍 URL:", pageAdminUrl);

        await page.goto(pageAdminUrl, {
            waitUntil: 'domcontentloaded'
        });

        console.log("⏳ Step 2: Waiting 5s for page load...");
        await page.waitForTimeout(5000);

        console.log("📍 Current URL after load:", page.url());

        try {
            console.log("🔍 Step 3: Looking for 'Chuyển ngay' button...");

            // Tìm trực tiếp span "Chuyển ngay"
            const switchNowSelectors = [
                'span.x1lliihq.x6ikm8r.x10wlt62.x1n2onr6.xlyipyv.xuxw1ft:has-text("Chuyển ngay")',
                'span:has-text("Chuyển ngay")',
                'span:has-text("Switch Now")',
            ];

            let switchBtn = null;

            for (const selector of switchNowSelectors) {
                console.log(`🔍 Trying selector: ${selector}`);
                switchBtn = await page.$(selector);
                if (switchBtn) {
                    console.log(`✅ Found 'Chuyển ngay' button with selector: ${selector}`);
                    break;
                }
            }

            if (!switchBtn) {
                console.log("⚠️ 'Chuyển ngay' button NOT found");
                console.log("⚠️ Continuing with current profile...");

                // const screenshotPath = `no_switch_now_button_${Date.now()}.png`;
                // await page.screenshot({
                //     path: screenshotPath,
                //     fullPage: true
                // }).catch(() => {});
                // console.log("📸 Screenshot saved:", screenshotPath);

                return;
            }

            console.log("🖱️  Step 4: Clicking 'Chuyển ngay' button...");

            // Screenshot trước khi click
            // const beforeClickScreenshot = `before_switch_${Date.now()}.png`;
            // await page.screenshot({
            //     path: beforeClickScreenshot,
            //     fullPage: true
            // }).catch(() => {});
            // console.log("📸 Before click screenshot:", beforeClickScreenshot);

            // Click và chờ navigation
            await Promise.all([
                page.waitForNavigation({
                    waitUntil: 'domcontentloaded',
                    timeout: 10000
                }).catch(() => {
                    console.log("⚠️ No navigation detected after click");
                }),
                switchBtn.click()
            ]);

            console.log("✅ Clicked 'Chuyển ngay' button");

            console.log("⏳ Step 5: Waiting 5s for profile switch to complete...");
            await page.waitForTimeout(5000);

            console.log("📍 URL after switch:", page.url());

            // Verify switch success
            const currentUrl = page.url();
            if (currentUrl !== pageAdminUrl) {
                console.log("✅ URL changed - switch successful");
            } else {
                console.log("⚠️ URL unchanged - switch may have failed");
            }

            // Screenshot sau khi switch
            // const afterScreenshot = `after_switch_${Date.now()}.png`;
            // await page.screenshot({
            //     path: afterScreenshot,
            //     fullPage: true
            // }).catch(() => {});
            // console.log("📸 After switch screenshot:", afterScreenshot);

            console.log("✅✅✅ SWITCH PROFILE COMPLETED ✅✅✅");

        } catch (err) {
            console.log("❌❌❌ SWITCH PROFILE ERROR ❌❌❌");
            console.log("❌ Error:", err.message);
            console.log("❌ Stack:", err.stack);

            // const screenshotPath = `error_switch_${Date.now()}.png`;
            // await page.screenshot({
            //     path: screenshotPath,
            //     fullPage: true
            // }).catch(() => {});
            // console.log("📸 Screenshot saved:", screenshotPath);
        }

        console.log("=".repeat(60) + "\n");
    }

    /**
     * Download ảnh 1 LẦN và trả về đường dẫn file
     */
    async downloadImage(imageUrl) {
        console.log("📍 Image URL:", imageUrl);

        const imageResponse = await axios.get(imageUrl, {
            responseType: "arraybuffer",
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        console.log("✅ Image downloaded, size:", imageResponse.data.length, "bytes");

        const tempDir = os.tmpdir();
        const filePath = path.join(
            tempDir,
            `upload_${Date.now()}.jpg`
        );

        await fs.promises.writeFile(filePath, imageResponse.data);
        console.log("✅ File saved at:", filePath);

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