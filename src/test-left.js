// import { chromium } from 'playwright';
// import fs from 'fs';
// import path from 'path';
// import { config } from './config.js';
//
// const MAX_IMAGES = 10;
//
//
// /**
//  * Lấy ảnh hiện tại trong viewer
//  */
// async function getCurrentImage(page) {
//
//     await page.waitForTimeout(700);
//
//     return await page.evaluate(() => {
//
//         const images = Array.from(document.querySelectorAll('img'));
//
//         let mainImg = null;
//
//         for (const img of images) {
//             if (
//                 img.naturalWidth > 900 &&
//                 img.naturalHeight > 900 &&
//                 img.src.includes('scontent')
//             ) {
//                 mainImg = img;
//                 break;
//             }
//         }
//
//         return {
//             imageUrl: mainImg?.src || null,
//             width: mainImg?.naturalWidth || null,
//             height: mainImg?.naturalHeight || null,
//             viewerUrl: window.location.href
//         };
//     });
// }
//
//
// /**
//  * Check nút LEFT có bị disable chưa
//  */
// async function isLeftDisabled(page) {
//
//     return await page.evaluate(() => {
//
//         const leftBtn = document.querySelector(
//             '[aria-label="Previous photo"], [aria-label="Ảnh trước"]'
//         );
//
//         if (!leftBtn) return true;
//
//         return (
//             leftBtn.getAttribute('aria-disabled') === 'true'
//         );
//     });
// }
//
//
// /**
//  * Chờ viewer load ảnh mới sau khi swipe
//  */
// async function waitViewerChange(page, oldImageUrl) {
//
//     try {
//
//         await page.waitForFunction(
//             (prevUrl) => {
//
//                 const images = Array.from(document.querySelectorAll('img'));
//
//                 const main = images.find(img =>
//                     img.naturalWidth > 900 &&
//                     img.src.includes('scontent')
//                 );
//
//                 return main && main.src !== prevUrl;
//             },
//             oldImageUrl,
//             { timeout: 5000 }
//         );
//
//     } catch {
//         await page.waitForTimeout(1500);
//     }
// }
//
//
// /**
//  * Crawl theo luồng viewer thật
//  */
// async function crawlLeftImages(page) {
//
//     const results = [];
//
//     for (let i = 0; i < MAX_IMAGES; i++) {
//
//         console.log(`\n📸 IMAGE ${i + 1}`);
//
//         const data = await getCurrentImage(page);
//
//         if (!data.imageUrl) {
//             console.log('⚠ Không lấy được ảnh → stop');
//             break;
//         }
//
//         console.log(data);
//
//         results.push(data);
//
//         // ===== check LEFT =====
//         const disabled = await isLeftDisabled(page);
//
//         if (disabled) {
//             console.log('⛔ LEFT disabled → stop');
//             break;
//         }
//
//         const oldImage = data.imageUrl;
//
//         await page.keyboard.press('ArrowLeft');
//
//         await waitViewerChange(page, oldImage);
//     }
//
//     return results;
// }
//
//
//
// (async () => {
//
//     console.log('🚀 TEST LEFT FLOW');
//
//     const browser = await chromium.launch({
//         headless: false,
//         slowMo: 80
//     });
//
//     const context = await browser.newContext();
//
//     const cookiePath = path.resolve(config.cookieFile);
//     const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
//
//     await context.addCookies(cookies);
//
//     const page = await context.newPage();
//
//     const testUrl =
//         "https://www.facebook.com/photo.php?fbid=803412939440938&type=3";
//
//     await page.goto(testUrl, { waitUntil: 'domcontentloaded' });
//
//     await page.waitForTimeout(2000);
//
//     const images = await crawlLeftImages(page);
//
//     console.log('\n=========== RESULT ===========');
//     console.log(images);
//
//     await browser.close();
//
// })();
