import {nowIso} from "../../../utils/time.js";
import axios from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import {runtimeConfig} from "../../../config/config.js";
import os from "os";

// =========================
// Log Utils
// =========================

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({type: 'LOG', data: {type, msg}});
}

function log(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, message, fields);
    sendToRenderer('info', msg);
}

function logWarn(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, `⚠️ ${message}`, fields);
    sendToRenderer('warn', msg);
}

function logError(requestId, message, err) {
    const msg = formatMsg(requestId, `❌ ${message}`, {error: err?.message || err});
    sendToRenderer('error', msg);
}

function logOk(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, `✅ ${message}`, fields);
    sendToRenderer('ok', msg);
}

const MAX_RETRY = 2;
const MAX_TEMPLATE_RETRY = 2;

// =========================
// Class
// =========================

export class CapCutRenderVideo {

    constructor(context) {
        this.context = context;
    }

    async render({id, keyword, index, request_type: requestType}, page) {
        if (!page) throw new Error('CapCutRenderVideo requires an event page');

        const renderId = id || `RENDER_${Date.now()}`;
        const startTime = Date.now();
        const separator = '='.repeat(60);

        log(renderId, separator);
        log(renderId, `🎬 START CAPCUT RENDER`, {keyword});

        let retryCount = 0;
        while (retryCount <= MAX_RETRY) {
            if (retryCount > 0) {
                log(renderId, `🔄 Retry attempt`, {attempt: retryCount, max: MAX_RETRY});
            }

            let filePath = null; // ✅ khai báo ngoài try để finally truy cập được

            try {
                filePath = await this._doRender(renderId, keyword, page);

                logOk(renderId, `Render finished`, {totalMs: Date.now() - startTime});
                log(renderId, `📡 Sending video to local render API...`);

                const form = new FormData();
                form.append('file', fs.createReadStream(filePath), 'output.mp4');
                form.append('index', Number(index));
                form.append('type', String(requestType));
                await axios.post(`${runtimeConfig.api.apiUploadVideoCapCut}`, form, {
                    headers: form.getHeaders(),
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                });

                logOk(renderId, `Video sent to render API`, {filePath});
                log(renderId, separator);
                return {success: true, filePath};

            } catch (err) {
                logError(renderId, `Render failed on attempt ${retryCount + 1}`, err);
                if (retryCount >= MAX_RETRY) {
                    logError(renderId, `Max retries reached — giving up`);
                    log(renderId, separator);
                    throw err;
                }
                retryCount++;

            } finally {
                // ✅ cleanup luôn chạy dù success hay fail, filePath có thể null nếu _doRender throw
                await this._cleanupDownloads(renderId, filePath);
            }
        }
    }

    async _doRender(renderId, keyword, page) {
        // ── B0. Clear storage trước khi bắt đầu ───────────────────────────
        await this._clearStorage(renderId, page);

        // ── B1. Mở template explorer ───────────────────────────────────────
        log(renderId, `➡️ B1: Navigating to CapCut template explorer...`);
        await page.goto(`${runtimeConfig.api.capCutExplorerUrl}`, {waitUntil: 'domcontentloaded'});
        await page.waitForTimeout(3000);
        await this._dismissModals(renderId, page);
        logOk(renderId, `Template explorer loaded`);

        // ── B2. Nhập keyword ───────────────────────────────────────────────
        log(renderId, `🔍 B2: Typing keyword...`, {keyword});
        const searchInput = await page.waitForSelector(
            'span.lv-input-inner-wrapper input.lv-input',
            {timeout: 10000}
        );
        await searchInput.click({clickCount: 3});
        await searchInput.type(keyword, {delay: 80});

        // ── B3. Bắt API response (setup TRƯỚC khi Enter) ───────────────────
        log(renderId, `📡 B3: Setup response listener...`);
        const responsePromise = page.waitForResponse(
            (res) => res.url().includes('search_templates') && res.status() === 200,
            {timeout: 20000}
        );

        await page.keyboard.press('Enter');
        logOk(renderId, `Search submitted`, {keyword});

        const response = await responsePromise;
        await response.json(); // consume response, không cần parse

        logOk(renderId, `Search completed`, {keyword});
        // ── B3.5. Filter tỉ lệ khung hình 9:16 ───────────────────────────
        log(renderId, `📐 B3.5: Filtering by 9:16 ratio...`);
        try {
            // B1: Click vào dropdown "Tất cả" để mở menu
            const ratioDropdown = await page.waitForSelector(
                '.lv-template__ratio-select__value',
                {timeout: 5000}
            );
            await ratioDropdown.click();
            await page.waitForTimeout(500);

            // B2: Bắt response filter TRƯỚC khi click 9:16
            const filterResponsePromise = page.waitForResponse(
                (res) => res.url().includes('search_templates') && res.status() === 200,
                {timeout: 10000}
            ).catch(() => null);

            // Click vào menu item 9:16 (tìm theo text)
            const clicked = await page.evaluate(() => {
                const items = document.querySelectorAll('.lv-dropdown-menu-item');
                const item = [...items].find(el => el.textContent.trim().endsWith('9:16'));
                if (item) {
                    item.click();
                    return true;
                }
                return false;
            });

            if (!clicked) throw new Error('9:16 menu item not found');

            // Đợi kết quả filter load xong
            await filterResponsePromise;
            await page.waitForTimeout(500);

            logOk(renderId, `Ratio filter 9:16 applied`);
        } catch (err) {
            logWarn(renderId, `Failed to apply ratio filter — continuing without filter`, {error: err.message});
        }

        // ── B4. Random click template + đợi modal + click "Dùng mẫu này" ──────
        await page.waitForSelector('.waterfall__item[data-id]', {timeout: 10000});
        await page.waitForTimeout(1500); // đợi DOM ổn định sau khi render waterfall

        const domIds = await page.$$eval(
            '.waterfall__item[data-id]',
            (els) => els.map(el => el.getAttribute('data-id')).filter(Boolean)
        );

        log(renderId, `📡 B4: DOM template ids found`, {count: domIds.length});
        if (!domIds.length) throw new Error('No template cards found in DOM');

        let editorPage;
        const usedIds = new Set();

        for (let attempt = 1; attempt <= MAX_TEMPLATE_RETRY; attempt++) {
            const available = domIds.filter(id => !usedIds.has(id));
            if (!available.length) throw new Error('All templates tried — all failed');

            const templateId = available[Math.floor(Math.random() * available.length)];
            usedIds.add(templateId);

            log(renderId, `➡️ B4: Clicking template card...`, {templateId, attempt});

            // Scroll vào view trước khi click
            const clicked = await page.evaluate((id) => {
                const card = document.querySelector(`.waterfall__item[data-id="${id}"]`);
                if (!card) return false;
                card.scrollIntoView({behavior: 'instant', block: 'center'});
                // Click vào thẻ img hoặc preview bên trong thay vì root div
                const clickTarget = card.querySelector('.lv-template-card-main') || card;
                clickTarget.click();
                return true;
            }, templateId);

            if (!clicked) {
                logWarn(renderId, `B4: Card not found`, {templateId, attempt});
                continue;
            }

            // Đợi modal/preview panel xuất hiện — thử nhiều selector có thể có
            let modalVisible = false;
            try {
                await page.waitForSelector(
                    '.lv-modal, .template-preview-modal, [class*="preview-modal"], [class*="template-detail"]',
                    {timeout: 6000}
                );
                modalVisible = true;
            } catch (_) {
                // Thử fallback: kiểm tra nút "Dùng mẫu này" trực tiếp
                try {
                    await page.waitForFunction(
                        () => {
                            const btns = document.querySelectorAll('button.lv-btn-primary span');
                            return [...btns].some(el => el.textContent.trim() === 'Dùng mẫu này');
                        },
                        {timeout: 5000}
                    );
                    modalVisible = true;
                } catch (_2) {
                    modalVisible = false;
                }
            }

            if (!modalVisible) {
                logWarn(renderId, `B4: Modal not appeared`, {templateId, attempt});
                await page.keyboard.press('Escape');
                await page.waitForTimeout(1000);
                continue;
            }

            logOk(renderId, `B4: Modal appeared`, {templateId, attempt});

            // Bắt tab mới TRƯỚC khi click nút — Playwright API
            const newPagePromise = page.context().waitForEvent('page', {timeout: 30000});

            const btnClicked = await page.evaluate(() => {
                const btns = document.querySelectorAll('button.lv-btn-primary');
                const btn = [...btns].find(b => b.textContent.trim().includes('Dùng mẫu này'));
                if (!btn) return false;
                btn.click();
                return true;
            });

            if (!btnClicked) {
                logWarn(renderId, `B4: "Dùng mẫu này" button not clickable`, {templateId, attempt});
                await page.keyboard.press('Escape');
                await page.waitForTimeout(1000);
                continue;
            }

            logOk(renderId, `B4: Clicked "Dùng mẫu này"`, {templateId, attempt});

            // Đợi tab mới
            editorPage = await newPagePromise.catch(() => null);

            if (!editorPage) {
                logWarn(renderId, `B4: New tab not opened`, {templateId, attempt});
                await page.keyboard.press('Escape');
                await page.waitForTimeout(1000);
                continue;
            }

            await editorPage.waitForLoadState('domcontentloaded');
            await editorPage.waitForTimeout(8000);
            await this._dismissModals(renderId, editorPage);
            // ── Unlink linked boxes nếu có ────────────────────────────────────
            await this._unlinkBoxes(renderId, editorPage);
            const hasRegionError = await editorPage.$('.template-error-page__container');
            if (hasRegionError) {
                logWarn(renderId, `B4: Region blocked`, {templateId, attempt});
                await editorPage.close();
                editorPage = null;
                continue;
            }

            logOk(renderId, `B4: Editor loaded`, {templateId, attempt});
            break;
        }

        if (!editorPage) throw new Error(`All ${MAX_TEMPLATE_RETRY} template attempts failed`);
        try {
            // ── B5. Đếm slots + lấy ảnh + upload ─────────────────────────────
            log(renderId, `🖼️ B5: Counting media slots...`);
            await editorPage.waitForSelector(
                '.mutable-batch-replace-panel-list .segment-item[data-mutableid]',
                {timeout: 20000}
            );

            const slotCount = await editorPage.$$eval(
                '.mutable-batch-replace-panel-list .segment-item[data-mutableid]',
                (els) => els.length
            );
            logOk(renderId, `Slots found`, {slotCount});

            log(renderId, `📥 B5: Fetching images from local API...`, {slotCount});
            const imageApiRes = await axios.get(`${runtimeConfig.api.apiGetImageVibe}/${slotCount}`).then(r => r.data);
            log(renderId, `📥 B5: API response`, {raw: JSON.stringify(imageApiRes).slice(0, 200)});

            const imageUrls = Array.isArray(imageApiRes) ? imageApiRes : (imageApiRes?.data?.images || imageApiRes?.images || []);
            if (!imageUrls.length) throw new Error('No images returned from local image API');
            logOk(renderId, `Images fetched`, {count: imageUrls.length});

            // ── Snapshot src trước khi upload để verify sau ────────────────────
            const originalSrcs = await editorPage.evaluate(() => {
                const slots = document.querySelectorAll(
                    '.mutable-batch-replace-panel-list .segment-item[data-mutableid]'
                );
                return [...slots].map(slot => {
                    const img = slot.querySelector('img.tier-sprite-img');
                    return img?.src || null;
                });
            });
            log(renderId, `📸 Snapshot original srcs`, {srcs: originalSrcs.map(s => s?.slice(0, 60))});

            log(renderId, `📤 B5: Uploading images to slots...`);
            const slotIndexes = await editorPage.$$eval(
                '.mutable-batch-replace-panel-list .segment-item[data-mutableid]',
                (els) => els.map((_, i) => i)
            );

            for (let i = 0; i < slotIndexes.length; i++) {
                const imageUrl = imageUrls[i % imageUrls.length];
                log(renderId, `📎 Uploading image to slot`, {slot: i + 1, imageUrl});

                let tmpImgPath = null;
                try {
                    // Download ảnh về tmp trong Node.js — tránh fetch trong browser context
                    const imgRes = await axios.get(imageUrl, {responseType: 'arraybuffer'});
                    tmpImgPath = path.join(os.tmpdir(), `capcut_img_${Date.now()}_${i}.jpg`);
                    await fs.promises.writeFile(tmpImgPath, imgRes.data);

                    // Dùng setInputFiles thay vì evaluate + fetch
                    const fileInput = editorPage.locator(
                        `.mutable-batch-replace-panel-list .segment-item[data-mutableid]:nth-child(${i + 1}) input.mutable-file-uploader[type="file"]`
                    );

                    await fileInput.setInputFiles(tmpImgPath);
                    await editorPage.waitForTimeout(1500);
                    logOk(renderId, `Image uploaded to slot`, {slot: i + 1});

                } catch (err) {
                    logWarn(renderId, `Failed to upload image to slot`, {slot: i + 1, error: err.message});
                } finally {
                    // Dọn file tạm
                    if (tmpImgPath) fs.unlink(tmpImgPath, () => {
                    });
                }
            }

            await editorPage.waitForTimeout(3000);

            // ── B5b. Verify & refix các slot bị lỗi ──────────────────────────────
            await this._verifyAndRefixSlots(renderId, editorPage, imageUrls, originalSrcs);
            logOk(renderId, `All images uploaded`);

            // ── B6. Preview để verify ──────────────────────────────────────────
            log(renderId, `▶️ B6: Clicking play to verify video...`);
            try {
                const playBtn = await editorPage.waitForSelector('.btn-play .player-play-btn', {timeout: 10000});
                await playBtn.click();
                await editorPage.waitForTimeout(4000);

                const hasError = await editorPage.$('.error-overlay, .render-error');
                if (hasError) throw new Error('Video preview failed — error overlay detected');

                logOk(renderId, `Video preview OK`);
                await playBtn.click();
                await editorPage.waitForTimeout(1000);
            } catch (err) {
                throw new Error(`Video verify failed: ${err.message}`);
            }

            // ── B7. Export ─────────────────────────────────────────────────────
            log(renderId, `📤 B7: Clicking export button...`);
            const exportBtn = await editorPage.waitForSelector('#export-video-btn', {timeout: 10000});
            await exportBtn.click();
            await editorPage.waitForTimeout(2000);
            logOk(renderId, `Export dialog opened`);

            // ── B8. Tải xuống ──────────────────────────────────────────────────
            log(renderId, `⬇️ B8: Clicking download button...`);
            const downloadBtn = await editorPage.waitForSelector(
                'button.lv-btn.lv-btn-secondary.lv-btn-size-large.button-QK_D5I',
                {timeout: 10000}
            );
            await downloadBtn.click();
            await editorPage.waitForTimeout(2000);
            logOk(renderId, `Download option selected`);
            // ── B8.5. Chọn chất lượng export ──────────────────────────────────
            await this._selectExportOptions(renderId, editorPage);
            // ── B9. Xác nhận xuất ─────────────────────────────────────────────
            log(renderId, `✅ B9: Confirming export...`);
            const confirmBtn = await editorPage.waitForSelector('#export-confirm-button', {timeout: 10000});
            await confirmBtn.click();
            logOk(renderId, `Export confirmed — processing started`);

            // ── B10. Đợi download + gửi file ──────────────────────────────────
            log(renderId, `⏳ B10: Monitoring export & waiting for download...`);
            const filePath = await this._waitForDownload(renderId, editorPage);

            return filePath;
        } catch (err) {
            logError(renderId, `Editor page operation failed — closing tab`, err);
            throw err; // re-throw để retry loop bên ngoài xử lý
        } finally {
            if (editorPage && !editorPage.isClosed()) {
                await editorPage.close().catch(() => {
                });
                log(renderId, `🗑️ Editor page closed`);
            }
        }
    }

    async _cleanupDownloads(renderId, currentFile = null) {
        const downloadDir = path.join(os.tmpdir(), 'capcut_downloads');
        log(renderId, `🧹 Cleaning up download files...`);

        try {
            // Xóa file hiện tại vừa gửi xong
            if (currentFile) {
                try {
                    await fs.promises.unlink(currentFile);
                    logOk(renderId, `Deleted current file`, {file: currentFile});
                } catch (err) {
                    logWarn(renderId, `Failed to delete current file`, {file: currentFile, error: err.message});
                }
            }

            // Dọn các file cũ còn sót (> 1 giờ) phòng trường hợp lần trước crash
            const files = await fs.promises.readdir(downloadDir).catch(() => []);
            const now = Date.now();
            const ONE_HOUR = 60 * 60 * 1000;

            for (const file of files) {
                const filePath = path.join(downloadDir, file);
                try {
                    const stat = await fs.promises.stat(filePath);
                    if (now - stat.mtimeMs > ONE_HOUR) {
                        await fs.promises.unlink(filePath);
                        log(renderId, `🗑️ Deleted stale file`, {file});
                    }
                } catch (_) {
                }
            }

            logOk(renderId, `Download cleanup done`);
        } catch (err) {
            logWarn(renderId, `Cleanup failed (non-critical)`, {error: err.message});
        }
    }

    async _clearStorage(renderId, page) {
        log(renderId, `🗑️ B0: Clearing storage...`);

        try {
            // ── B0-1. Vào trang chủ CapCut ────────────────────────────────
            await page.goto('https://www.capcut.com/', {waitUntil: 'domcontentloaded'});
            await page.waitForTimeout(3000);
            await this._dismissModals(renderId, page);

            // ── B0-2. Click vào workspace ──────────────────────────────────
            log(renderId, `B0-1: Clicking workspace...`);
            const workspace = await page.waitForSelector(
                '.default-workspace-container',
                {timeout: 10000}
            ).catch(() => null);

            if (!workspace) {
                logWarn(renderId, `B0: Workspace not found — skipping clear`);
                return;
            }
            await workspace.click();
            await page.waitForTimeout(2000);
            logOk(renderId, `B0-1: Workspace clicked`);

            // ── B0-3. Hover + check 1 item để trigger batch mode ──────────
            log(renderId, `B0-2: Hovering first item to reveal checkbox...`);
            const firstItem = await page.waitForSelector(
                '[data-selectable-item-id] [role="button"]',
                {timeout: 8000}
            ).catch(() => null);

            if (!firstItem) {
                logWarn(renderId, `B0: No items found in storage — skipping clear`);
                return;
            }

            await firstItem.hover();
            await page.waitForTimeout(500);

            // Click checkbox của item đầu tiên
            const checkboxClicked = await page.evaluate(() => {
                const checkbox = document.querySelector(
                    '[data-selectable-item-id] label[data-is-checkbox="true"]'
                );
                if (checkbox) {
                    checkbox.click();
                    return true;
                }
                return false;
            });

            if (!checkboxClicked) {
                logWarn(renderId, `B0: Checkbox not found after hover — skipping clear`);
                return;
            }
            await page.waitForTimeout(500);
            logOk(renderId, `B0-2: First item checked`);

            // ── B0-4. Click "chọn tất cả" (indeterminate checkbox) ────────
            log(renderId, `B0-3: Selecting all items...`);
            const selectAll = await page.waitForSelector(
                'label.lv-checkbox-indeterminate.BatchOperation_Checkbox-uUOaB4',
                {timeout: 5000}
            ).catch(() => null);

            if (selectAll) {
                await selectAll.click();
                await page.waitForTimeout(500);
                logOk(renderId, `B0-3: All items selected`);
            } else {
                logWarn(renderId, `B0-3: Select-all checkbox not found`);
            }

            // ── B0-5. Click "Chuyển vào Thùng rác" ───────────────────────
            log(renderId, `B0-4: Moving to trash...`);
            const trashBtn = await page.evaluate(() => {
                const btns = document.querySelectorAll('button.ActionButton-twrnER');
                const btn = [...btns].find(b => b.textContent.trim().includes('Chuyển vào Thùng rác'));
                if (btn) {
                    btn.click();
                    return true;
                }
                return false;
            });

            if (!trashBtn) {
                logWarn(renderId, `B0-4: Trash button not found`);
                return;
            }
            await page.waitForTimeout(1000);

            // ── B0-6. Xác nhận modal ──────────────────────────────────────
            log(renderId, `B0-5: Confirming move to trash...`);
            const confirmMoveBtn = await page.waitForFunction(
                () => {
                    const btns = document.querySelectorAll('button.lv-btn-primary');
                    const btn = [...btns].find(b => b.textContent.trim() === 'Xác nhận');
                    if (btn) {
                        btn.click();
                        return true;
                    }
                    return false;
                },
                {timeout: 5000}
            ).catch(() => null);

            await page.waitForTimeout(2000);
            logOk(renderId, `B0-5: Moved to trash`);

            // ── B0-7. Vào Thùng rác ───────────────────────────────────────
            log(renderId, `B0-6: Opening trash...`);
            const openTrash = await page.evaluate(() => {
                const btns = document.querySelectorAll('button.ActionButton-twrnER');
                const btn = [...btns].find(b => b.textContent.trim() === 'Thùng rác');
                if (btn) {
                    btn.click();
                    return true;
                }
                return false;
            });

            if (!openTrash) {
                logWarn(renderId, `B0-6: Trash button not found`);
                return;
            }
            await page.waitForTimeout(2000);
            logOk(renderId, `B0-6: Trash opened`);

            // ── B0-8. Scroll xuống 3 lần để load thêm ────────────────────
            log(renderId, `B0-7: Scrolling to load more trash items...`);
            for (let i = 0; i < 3; i++) {
                await page.evaluate(() => {
                    // Thử các container scroll phổ biến của CapCut
                    const container =
                        document.querySelector('.DataView-lk2u27') ||
                        document.querySelector('.DataViewBody-s8MTM1') ||
                        document.querySelector('[class*="DataView"]') ||
                        document.querySelector('[class*="AssetList"]') ||
                        document.querySelector('main') ||
                        document.documentElement;

                    container.scrollBy({top: 800, behavior: 'instant'});
                });
                await page.waitForTimeout(1000);
            }
            logOk(renderId, `B0-7: Scrolled down to load more items`);

            // ── B0-9. Hover item trong trash để hiện checkbox ─────────────
            log(renderId, `B0-8: Hovering trash item to reveal checkbox...`);
            const trashItem = await page.waitForSelector(
                '[data-selectable-item-id] [role="button"]',
                {timeout: 8000}
            ).catch(() => null);

            if (!trashItem) {
                logOk(renderId, `B0: Trash is empty — nothing to delete`);
                return;
            }

            await trashItem.hover();
            await page.waitForTimeout(500);

            const trashCheckbox = await page.evaluate(() => {
                const checkbox = document.querySelector(
                    '[data-selectable-item-id] label[data-is-checkbox="true"]'
                );
                if (checkbox) {
                    checkbox.click();
                    return true;
                }
                return false;
            });

            if (!trashCheckbox) {
                logWarn(renderId, `B0-8: Trash checkbox not found`);
                return;
            }
            await page.waitForTimeout(500);

            // ── B0-10. Chọn tất cả trong trash ───────────────────────────
            log(renderId, `B0-9: Selecting all trash items...`);
            const selectAllTrash = await page.waitForSelector(
                'label.lv-checkbox-indeterminate.BatchOperation_Checkbox-uUOaB4',
                {timeout: 5000}
            ).catch(() => null);

            if (selectAllTrash) {
                await selectAllTrash.click();
                await page.waitForTimeout(500);
                logOk(renderId, `B0-9: All trash items selected`);
            }

            // ── B0-11. Click nút "Xóa" ────────────────────────────────────
            log(renderId, `B0-10: Clicking delete...`);
            const deleteBtn = await page.evaluate(() => {
                const btns = document.querySelectorAll('button.ActionButton-twrnER');
                const btn = [...btns].find(b => b.textContent.trim() === 'Xóa');
                if (btn) {
                    btn.click();
                    return true;
                }
                return false;
            });

            if (!deleteBtn) {
                logWarn(renderId, `B0-10: Delete button not found`);
                return;
            }
            await page.waitForTimeout(1000);

            // ── B0-12. Xác nhận xóa vĩnh viễn (danger button) ────────────
            log(renderId, `B0-11: Confirming permanent delete...`);
            await page.waitForFunction(
                () => {
                    const btn = document.querySelector('button.lv-btn-status-danger');
                    if (btn && btn.textContent.trim() === 'Xác nhận') {
                        btn.click();
                        return true;
                    }
                    return false;
                },
                {timeout: 5000}
            ).catch(() => logWarn(renderId, `B0-11: Danger confirm button not found`));

            // Đợi xóa xong
            await page.waitForTimeout(3000);
            logOk(renderId, `B0: Storage cleared successfully`);

        } catch (err) {
            logWarn(renderId, `B0: Clear storage failed (non-critical) — continuing`, {error: err.message});
        }
    }

    async _unlinkBoxes(renderId, editorPage) {
        try {
            const clicked = await editorPage.evaluate(() => {
                const buttons = document.querySelectorAll('button, [role="button"]');
                const btn = [...buttons].find(el =>
                    el.querySelector('path[d*="M5.147 3h10.706"]')
                );
                if (btn) {
                    btn.click();
                    return true;
                }
                return false;
            });

            clicked
                ? logOk(renderId, `Linked boxes unlinked`)
                : log(renderId, `No linked boxes found — skipping`);

            if (clicked) await editorPage.waitForTimeout(500);
        } catch (err) {
            logWarn(renderId, `Failed to unlink boxes (non-critical)`, {error: err.message});
        }
    }

    async _selectExportOptions(renderId, editorPage) {
        log(renderId, `⚙️ Selecting export quality options...`);

        const selectOption = async (label, comboboxId, optionText, optionSelector) => {
            try {
                // Click vào combobox để mở dropdown
                const combobox = await editorPage.waitForSelector(
                    comboboxId ? `#${comboboxId} .lv-select` : null,
                    {timeout: 5000}
                ).catch(() => null);

                // Fallback: tìm theo giá trị hiện tại nếu không có id
                const trigger = combobox || await editorPage.waitForSelector(
                    `.lv-select:has(.lv-select-view-value:text-is("${optionSelector.currentValue}"))`,
                    {timeout: 5000}
                ).catch(() => null);

                if (!trigger) {
                    logWarn(renderId, `${label}: combobox not found`);
                    return;
                }

                await trigger.click();
                await editorPage.waitForTimeout(400);

                // Tìm và click option theo text
                const clicked = await editorPage.evaluate((text) => {
                    const options = document.querySelectorAll('li.lv-select-option');
                    const opt = [...options].find(el => el.textContent.trim().includes(text));
                    if (opt) {
                        opt.click();
                        return true;
                    }
                    return false;
                }, optionText);

                if (clicked) {
                    logOk(renderId, `${label}: selected "${optionText}"`);
                } else {
                    logWarn(renderId, `${label}: option "${optionText}" not found`);
                    await editorPage.keyboard.press('Escape');
                }

                await editorPage.waitForTimeout(400);
            } catch (err) {
                logWarn(renderId, `${label}: failed`, {error: err.message});
            }
        };

        // B1. Độ phân giải → 1080p
        try {
            log(renderId, `📐 B7.5-1: Setting resolution to 1080p...`);
            const resCombobox = await editorPage.waitForSelector(
                    '#form-resolution .lv-select, [id*="resolution"] .lv-select',
                    {timeout: 5000}
                ).catch(() => null)
                // Fallback: combobox đang hiện "720p"
                || await editorPage.waitForSelector(
                    '.lv-select:has(input[value="720p"])',
                    {timeout: 3000}
                ).catch(() => null);

            if (resCombobox) {
                await resCombobox.click();
                await editorPage.waitForTimeout(400);

                const clicked = await editorPage.evaluate(() => {
                    const options = document.querySelectorAll('li.lv-select-option');
                    const opt = [...options].find(el => el.textContent.trim().startsWith('1080p'));
                    if (opt) {
                        opt.click();
                        return true;
                    }
                    return false;
                });

                clicked
                    ? logOk(renderId, `Resolution set to 1080p`)
                    : logWarn(renderId, `1080p option not found`);

                if (!clicked) await editorPage.keyboard.press('Escape');
            } else {
                logWarn(renderId, `Resolution combobox not found`);
            }
            await editorPage.waitForTimeout(400);
        } catch (err) {
            logWarn(renderId, `Failed to set resolution`, {error: err.message});
        }

        // B2. Chất lượng → "Chất lượng cao"
        try {
            log(renderId, `🎨 B7.5-2: Setting quality to "Chất lượng cao"...`);
            const qualityCombobox = await editorPage.waitForSelector(
                    '#form-quality .lv-select',
                    {timeout: 5000}
                ).catch(() => null)
                || await editorPage.waitForSelector(
                    '.lv-select:has(.lv-select-view-value:text-is("Chất lượng đề xuất"))',
                    {timeout: 3000}
                ).catch(() => null);

            if (qualityCombobox) {
                await qualityCombobox.click();
                await editorPage.waitForTimeout(400);

                const clicked = await editorPage.evaluate(() => {
                    const options = document.querySelectorAll('li.lv-select-option');
                    const opt = [...options].find(el => el.textContent.trim() === 'Chất lượng cao');
                    if (opt) {
                        opt.click();
                        return true;
                    }
                    return false;
                });

                clicked
                    ? logOk(renderId, `Quality set to "Chất lượng cao"`)
                    : logWarn(renderId, `"Chất lượng cao" option not found`);

                if (!clicked) await editorPage.keyboard.press('Escape');
            } else {
                logWarn(renderId, `Quality combobox not found`);
            }
            await editorPage.waitForTimeout(400);
        } catch (err) {
            logWarn(renderId, `Failed to set quality`, {error: err.message});
        }

        // B3. Tốc độ khung hình → 60fps
        try {
            log(renderId, `🎞️ B7.5-3: Setting frame rate to 60fps...`);
            const fpsCombobox = await editorPage.waitForSelector(
                '.lv-select:has(input[value="30fps"])',
                {timeout: 5000}
            ).catch(() => null);

            if (fpsCombobox) {
                await fpsCombobox.click();
                await editorPage.waitForTimeout(400);

                const clicked = await editorPage.evaluate(() => {
                    const options = document.querySelectorAll('li.lv-select-option');
                    const opt = [...options].find(el => el.textContent.trim() === '60fps');
                    if (opt) {
                        opt.click();
                        return true;
                    }
                    return false;
                });

                clicked
                    ? logOk(renderId, `Frame rate set to 60fps`)
                    : logWarn(renderId, `60fps option not found`);

                if (!clicked) await editorPage.keyboard.press('Escape');
            } else {
                logWarn(renderId, `FPS combobox not found`);
            }
            await editorPage.waitForTimeout(400);
        } catch (err) {
            logWarn(renderId, `Failed to set frame rate`, {error: err.message});
        }

        logOk(renderId, `Export options configured`);
    }

    async _verifyAndRefixSlots(renderId, editorPage, imageUrls, originalSrcs = []) {
        log(renderId, `🔍 Verifying slots after upload...`);

        // Đợi tất cả slot hết loading
        log(renderId, `⏳ Waiting for all slots to finish loading...`);
        try {
            await editorPage.waitForFunction(
                () => {
                    const slots = document.querySelectorAll(
                        '.mutable-batch-replace-panel-list .segment-item[data-mutableid]'
                    );
                    return ![...slots].some(slot => slot.querySelector('.lv-icon-loading'));
                },
                {timeout: 30000, polling: 500}
            );
            logOk(renderId, `All slots finished loading`);
        } catch (_) {
            logWarn(renderId, `Timed out waiting for slots to finish loading — proceeding anyway`);
        }

        const MAX_SLOT_RETRY = 2;

        for (let attempt = 1; attempt <= MAX_SLOT_RETRY; attempt++) {

            const brokenIndexes = await editorPage.evaluate((origSrcs) => {
                const slots = document.querySelectorAll(
                    '.mutable-batch-replace-panel-list .segment-item[data-mutableid]'
                );
                const broken = [];
                slots.forEach((slot, i) => {
                    // 1. Vẫn đang loading
                    if (slot.querySelector('.lv-icon-loading')) {
                        broken.push(i);
                        return;
                    }
                    // 2. Có button lỗi (danger)
                    if (slot.querySelector('button.lv-btn-status-danger')) {
                        broken.push(i);
                        return;
                    }
                    const img = slot.querySelector('img.tier-sprite-img');
                    // 3. Không có img
                    if (!img) {
                        broken.push(i);
                        return;
                    }
                    // 4. src không phải blob
                    if (!img.src.startsWith('blob:')) {
                        broken.push(i);
                        return;
                    }
                    // 5. src không đổi so với ảnh mẫu gốc → chưa upload thành công
                    if (origSrcs[i] && img.src === origSrcs[i]) {
                        broken.push(i);
                        return;
                    }
                });
                return broken;
            }, originalSrcs);

            if (!brokenIndexes.length) {
                logOk(renderId, `All slots verified OK`, {attempt});
                return;
            }

            logWarn(renderId, `Broken slots detected — refixing`, {
                attempt,
                slots: brokenIndexes.join(','),
            });

            for (const slotIdx of brokenIndexes) {
                const imageUrl = imageUrls[slotIdx % imageUrls.length];
                log(renderId, `🔄 Refixing slot`, {slot: slotIdx + 1, imageUrl});

                let tmpImgPath = null;
                try {
                    const imgRes = await axios.get(imageUrl, {responseType: 'arraybuffer'});
                    tmpImgPath = path.join(os.tmpdir(), `capcut_refix_${Date.now()}_${slotIdx}.jpg`);
                    await fs.promises.writeFile(tmpImgPath, imgRes.data);

                    await editorPage.evaluate((idx) => {
                        const slots = document.querySelectorAll(
                            '.mutable-batch-replace-panel-list .segment-item[data-mutableid]'
                        );
                        const slot = slots[idx];
                        if (!slot) return;
                        slot.scrollIntoView({behavior: 'instant', block: 'center'});
                        const target = slot.querySelector('.tier-sprite, img.tier-sprite-img, .segment-item-thumbnail')
                            || slot;
                        target.click();
                    }, slotIdx);

                    await editorPage.waitForTimeout(600);

                    let uploaded = false;
                    try {
                        const fileInput = editorPage.locator(
                            `.mutable-batch-replace-panel-list .segment-item[data-mutableid]:nth-child(${slotIdx + 1}) input.mutable-file-uploader[type="file"]`
                        );
                        await fileInput.waitFor({state: 'attached', timeout: 4000});
                        await fileInput.setInputFiles(tmpImgPath);
                        uploaded = true;
                    } catch (_) {
                        try {
                            const fallback = editorPage.locator('input.mutable-file-uploader[type="file"]').first();
                            await fallback.waitFor({state: 'attached', timeout: 4000});
                            await fallback.setInputFiles(tmpImgPath);
                            uploaded = true;
                        } catch (e2) {
                            logWarn(renderId, `No file input found for slot`, {slot: slotIdx + 1, error: e2.message});
                        }
                    }

                    if (uploaded) {
                        // Đợi loading → xong → src thay đổi so với original
                        try {
                            await editorPage.waitForFunction(
                                ({idx, origSrcs}) => {
                                    const slots = document.querySelectorAll(
                                        '.mutable-batch-replace-panel-list .segment-item[data-mutableid]'
                                    );
                                    const slot = slots[idx];
                                    if (!slot) return false;
                                    if (slot.querySelector('.lv-icon-loading')) return false;
                                    if (slot.querySelector('button.lv-btn-status-danger')) return false;
                                    const img = slot.querySelector('img.tier-sprite-img');
                                    if (!img?.src?.startsWith('blob:')) return false;
                                    // src phải khác với ảnh mẫu gốc
                                    if (origSrcs[idx] && img.src === origSrcs[idx]) return false;
                                    return true;
                                },
                                {idx: slotIdx, origSrcs: originalSrcs},
                                {timeout: 15000, polling: 500}
                            );
                            logOk(renderId, `Slot refixed & confirmed`, {slot: slotIdx + 1});
                        } catch (_) {
                            logWarn(renderId, `Slot upload sent but src unchanged`, {slot: slotIdx + 1});
                        }
                    }

                } catch (err) {
                    logWarn(renderId, `Failed to refix slot`, {slot: slotIdx + 1, error: err.message});
                } finally {
                    if (tmpImgPath) fs.unlink(tmpImgPath, () => {
                    });
                }
            }

            await editorPage.waitForTimeout(1000);
        }

        // Final check
        const stillBroken = await editorPage.evaluate((origSrcs) => {
            const slots = document.querySelectorAll(
                '.mutable-batch-replace-panel-list .segment-item[data-mutableid]'
            );
            const broken = [];
            slots.forEach((slot, i) => {
                if (slot.querySelector('.lv-icon-loading')) {
                    broken.push(i);
                    return;
                }
                if (slot.querySelector('button.lv-btn-status-danger')) {
                    broken.push(i);
                    return;
                }
                const img = slot.querySelector('img.tier-sprite-img');
                if (!img || !img.src.startsWith('blob:')) {
                    broken.push(i);
                    return;
                }
                if (origSrcs[i] && img.src === origSrcs[i]) {
                    broken.push(i);
                    return;
                }
            });
            return broken;
        }, originalSrcs);

        if (stillBroken.length) {
            throw new Error(`Slots still broken after ${MAX_SLOT_RETRY} refix attempts: [${stillBroken.join(', ')}]`);
        }
    }

    async _dismissModals(renderId, page) {
        log(renderId, `🔕 Dismissing modals/notifications...`);

        const tryClick = (selector) => page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) {
                el.click();
                return true;
            }
            return false;
        }, selector);

        const tryClickByText = (selector, text) => page.evaluate(({sel, text}) => {
            const els = document.querySelectorAll(sel);
            const el = [...els].find(e => e.textContent.trim() === text);
            if (el) {
                el.click();
                return true;
            }
            return false;
        }, {sel: selector, text});

        // Chạy tất cả song song, mỗi cái timeout 2s
        await Promise.allSettled([
            // 1. ToS modal → nút OK
            page.waitForFunction(
                () => {
                    const btn = [...document.querySelectorAll('button.lv-btn-primary')]
                        .find(b => b.textContent.trim() === 'OK');
                    if (btn) {
                        btn.click();
                        return true;
                    }
                    return false;
                },
                {timeout: 1000}
            ),

            // 2. Service guide tooltip
            page.waitForFunction(
                () => {
                    const btn = document.querySelector('span.lv-trigger button.guide-confirm-button')
                        || document.querySelector('span.lv-trigger .guide-close-icon-P99C9o');
                    if (btn) {
                        btn.click();
                        return true;
                    }
                    return false;
                },
                {timeout: 1000}
            ),

            // 3. Pippit guide → "Để sau"
            page.waitForFunction(
                () => {
                    const btn = document.querySelector(
                        '.guide-modal.guide_commercepro-modal .guide-modal-footer-skip-btn'
                    );
                    if (btn) {
                        btn.click();
                        return true;
                    }
                    return false;
                },
                {timeout: 1000}
            ),

        ]);

        // Escape một lần duy nhất cuối cùng
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        log(renderId, `🔕 All modals dismissed`);
    }

    async _waitForDownload(renderId, page) {
        const TIMEOUT_MS = 5 * 60 * 1000;

        log(renderId, `⏳ Waiting for download event...`);

        const download = await page.waitForEvent('download', {timeout: TIMEOUT_MS});
        log(renderId, `⏳ Download started`, {filename: download.suggestedFilename()});

        const downloadPath = path.join(os.tmpdir(), 'capcut_downloads', `${Date.now()}_${download.suggestedFilename()}`);
        // Đảm bảo thư mục tồn tại
        await fs.promises.mkdir(path.join(os.tmpdir(), 'capcut_downloads'), {recursive: true});
        await download.saveAs(downloadPath);

        logOk(renderId, `Download completed`, {downloadPath});
        return downloadPath;
    }
}