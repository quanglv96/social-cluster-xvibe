// src/platforms/adb/TiktokAdbUpload.js
import os from 'os';
import path from 'path';
import axios from 'axios';
import fs from 'fs';
import { runtimeConfig } from '../../config/config.js';

const TAG = 'TK_ADB_UPLOAD';

function send(type, msg) {
    process.send?.({ type: 'LOG', data: { type, msg } });
}
function log(msg)  { send('info',  `[${TAG}] ${msg}`); }
function warn(msg) { send('warn',  `[${TAG}] ⚠️ ${msg}`); }
function ok(msg)   { send('ok',    `[${TAG}] ✅ ${msg}`); }
function err(msg)  { send('error', `[${TAG}] ❌ ${msg}`); }

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

export class TiktokAdbUpload {
    constructor(adb) {
        this.adb = adb;
        this.rid = adb.requestId;  // shortcut
    }

    // ------------------------------------------------
    // Entry point
    // images: Map<number, string>  key=index, value=mediaId
    // ------------------------------------------------
    async upload({ images, caption }) {
        const sorted = [...images.entries()].sort(([a], [b]) => a - b);
        const localPaths  = [];
        const remotePaths = [];

        try {
            // STEP 1: Download ảnh → push vào emulator theo thứ tự
            log(`Downloading ${sorted.length} images...`);
            for (const [index, mediaId] of sorted) {
                const local = await this.downloadImage(mediaId, index);
                localPaths.push(local);

                const remote = `/sdcard/DCIM/Camera/tiktok_slide_${String(index).padStart(3,'0')}.jpg`;
                this.adb.push(local, remote);
                this.adb.scanMedia(remote);
                remotePaths.push(remote);
                log(`Image ${index} ready: ${remote}`);
            }

            await sleep(2500); // Chờ media scanner index xong

            // STEP 2: Khởi động TikTok
            log('Launching TikTok...');
            this.adb.killTikTok();
            await sleep(1500);
            this.adb.launchTikTok();
            await sleep(5000);

            // STEP 3: Tap nút "+"
            await this.tapCreate();

            // STEP 4: Chọn "Upload" (không phải camera)
            await this.tapUpload();

            // STEP 5: Chọn ảnh theo thứ tự
            await this.selectImages(sorted.length);

            // STEP 6: Tap Next
            await this.tapNext();
            await sleep(3000);

            // STEP 7: Điền caption
            if (caption) await this.fillCaption(caption);

            // STEP 8: Đăng
            await this.tapPost();

            ok(`Upload complete — ${sorted.length} slides`);
            return { success: true, count: sorted.length };

        } finally {
            // Dọn file local + remote
            for (const p of localPaths)  this.safeDelete(p);
            for (const p of remotePaths) {
                try { this.adb.adb('shell', 'rm', p); } catch (_) {}
            }
        }
    }

    // ------------------------------------------------
    // Download ảnh từ API
    // ------------------------------------------------
    async downloadImage(mediaId, index) {
        // mediaId có thể là URL trực tiếp hoặc ID
        const url = mediaId.startsWith('http')
            ? mediaId  // ← URL trực tiếp, dùng luôn
            : `${runtimeConfig.api.apiGetVideo}/${mediaId}`; // ← ID thì mới build URL

        console.log(`[TK_UPLOAD] downloadImage[${index}] url = ${url}`);

        try {
            const res = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 60_000,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'image/*,*/*',
                }
            });
            const filePath = path.join(
                os.tmpdir(),
                `tk_slide_${String(index).padStart(3,'0')}_${Date.now()}.jpg`
            );
            await fs.promises.writeFile(filePath, res.data);
            console.log(`[TK_UPLOAD] downloaded[${index}] → ${filePath}`);
            return filePath;
        } catch (e) {
            console.error(`[TK_UPLOAD] downloadImage FAILED url=${url} status=${e.response?.status}`);
            throw e;
        }
    }

    safeDelete(p) {
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
    }

    // ------------------------------------------------
    // UI Steps
    // ------------------------------------------------

    async tapCreate() {
        log('Tapping create button...');
        await sleep(500);
        const xml = this.adb.dumpUi();

        this.adb.tapElement(xml,
            { contentDesc: 'Create video' },
            { x: 540, y: 1220 }  // fallback bottom center
        );
        await sleep(2500);
    }

    async tapUpload() {
        log('Tapping Upload option...');
        const xml = this.adb.dumpUi();

        // Thử text trước, rồi contentDesc, rồi fallback tọa độ
        const el = this.adb.findElement(xml, { text: 'Upload' })
            || this.adb.findElement(xml, { contentDesc: 'Upload' })
            || this.adb.findElement(xml, { text: 'Tải lên' }); // TikTok tiếng Việt

        if (el) {
            this.adb.tap(el.x, el.y);
        } else {
            warn('Upload button not found — using fallback coords');
            this.adb.tap(540, 1100);
        }
        await sleep(2000);
    }

    async selectImages(count) {
        log(`Selecting ${count} images in order...`);

        for (let i = 0; i < count; i++) {
            const xml = this.adb.dumpUi();

            const el = this.adb.findElement(xml, { resourceId: 'com.zhiliaoapp.musically:id/fau' })
                || this.adb.findElement(xml, { contentDesc: `Photo ${i + 1}` });

            if (el) {
                this.adb.tap(el.x, el.y);
            } else {
                // Log XML để debug resource-id mới
                if (i === 0) {
                    warn('Cannot find image element — dumping XML for debug');
                    log('XML snippet: ' + xml.substring(0, 500));
                }
                const col = i % 3;
                const row = Math.floor(i / 3);
                const x = 60 + col * 360;
                const y = 700 + row * 360;
                warn(`Fallback tap image ${i} at ${x},${y}`);
                this.adb.tap(x, y);
            }

            await sleep(600);
        }
    }

    async tapNext() {
        log('Tapping Next...');
        const xml = this.adb.dumpUi();
        this.adb.tapElement(xml,
            { text: 'Next' },
            { x: 980, y: 180 }  // top-right thường
        );
        await sleep(3000);
    }

    async fillCaption(caption) {
        log(`Filling caption (${caption.length} chars)...`);
        const xml = this.adb.dumpUi();

        // Tap vào caption field
        this.adb.tapElement(xml,
            { resourceId: 'com.zhiliaoapp.musically:id/caption_et' },
            { x: 540, y: 600 }
        );
        await sleep(800);

        // Xóa text cũ
        this.adb.keyEvent(123); // KEYCODE_MOVE_END
        this.adb.adb('shell', 'input', 'keyevent', '--longpress', '67'); // BACKSPACE long
        await sleep(300);

        // Gõ caption qua ADBKeyboard (hỗ trợ Unicode/tiếng Việt)
        this.adb.typeText(caption);
        await sleep(800);
        ok('Caption filled');
    }

    async tapPost() {
        log('Tapping Post button...');
        const xml = this.adb.dumpUi();

        const el = this.adb.findElement(xml, { text: 'Post' })
            || this.adb.findElement(xml, { text: 'Đăng' });

        if (el) {
            this.adb.tap(el.x, el.y);
        } else {
            warn('Post button not found — using fallback coords');
            this.adb.tap(540, 1200);
        }

        await this.waitForPostComplete();
        ok('Post complete');
    }

    async waitForPostComplete(timeoutMs = 120_000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            await sleep(3000);
            const xml = this.adb.dumpUi();
            // Upload xong → TikTok về home hoặc profile
            const isHome = xml.includes('com.zhiliaoapp.musically:id/home')
                || xml.includes('content-desc="Home"');
            if (isHome) return;

            // Vẫn thấy progress bar → tiếp tục chờ
            const isUploading = xml.includes('Uploading') || xml.includes('Đang tải lên');
            if (!isUploading && Date.now() - start > 15_000) {
                warn('Cannot confirm upload status — assuming done');
                return;
            }
        }
        throw new Error('waitForPostComplete timeout');
    }
}