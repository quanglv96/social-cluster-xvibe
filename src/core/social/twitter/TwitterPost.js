import fs from 'fs';
import axios from 'axios';
import path from 'path';
import os from 'os';
import twemoji from 'twitter-text';

// =========================
// Log Utils
// =========================

function nowIso() {
    return new Date().toISOString();
}

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({ type: 'LOG', data: { type, msg } });
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
    const msg = formatMsg(requestId, `❌ ${message}`, { error: err?.message || err });
    sendToRenderer('error', msg);
}

function logOk(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, `✅ ${message}`, fields);
    sendToRenderer('ok', msg);
}

// =========================
// Class
// =========================

const TAG = 'TW_POST';

export class TwitterPost {

    constructor(context) {
        this.context = context;
    }

    async downloadImage(url, index) {
        const filePath = path.join(os.tmpdir(), `tw_image_${index}_${Date.now()}.jpg`);
        const response = await axios({ url, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(filePath));
            writer.on('error', reject);
        });
    }

    async post({ content, url_groups: imageUrls = [] }, page) {

        if (!page) {
            throw new Error("TwitterPost requires an event page");
        }

        const MAX_LENGTH = 280;

        if (!content || content.trim().length === 0) {
            throw new Error('Content cannot be empty');
        }

        log(TAG, `Start posting`, { images: imageUrls.length });

        const finalContent = this.truncateTwitterContent(content, MAX_LENGTH);

        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);

        await page.click('a[data-testid="SideNav_NewTweet_Button"]');
        await page.waitForTimeout(3000);

        await page.fill('div[role="textbox"]', finalContent);
        await page.waitForTimeout(2000);

        log(TAG, `Content filled`, { length: finalContent.length });

        const uploadedFiles = [];

        for (let i = 0; i < imageUrls.length; i++) {
            log(TAG, `Downloading image`, { index: i + 1, total: imageUrls.length, url: imageUrls[i] });
            const filePath = await this.downloadImage(imageUrls[i], i);

            const input = await page.$('input[type="file"]');
            await input.setInputFiles(filePath);
            uploadedFiles.push(filePath);

            logOk(TAG, `Image uploaded`, { index: i + 1 });
            await page.waitForTimeout(5000);
        }

        log(TAG, `⌨️ Pressing Ctrl+Enter to post...`);
        await page.keyboard.press('Control+Enter');
        await page.waitForTimeout(10000);

        for (const file of uploadedFiles) {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }
        log(TAG, `Temp files cleaned`, { count: uploadedFiles.length });

        logOk(TAG, `Post success`);
        return { success: true };
    }

    truncateTwitterContent(content, maxLength = 280) {
        const parsedTweet = twemoji.parseTweet(content);

        if (parsedTweet.valid) return content;

        logWarn(TAG, `Content too long — truncating`, {
            length: parsedTweet.weightedLength,
            max: maxLength,
        });

        const hashtagRegex = /#[^\s#]+/g;
        const hashtags = [];
        let match;

        while ((match = hashtagRegex.exec(content)) !== null) {
            hashtags.push({ tag: match[0], start: match.index, end: match.index + match[0].length });
        }

        if (hashtags.length === 0) {
            let truncated = content;
            while (truncated.length > 0) {
                truncated = truncated.slice(0, -1);
                if (twemoji.parseTweet(truncated).valid) return truncated;
            }
            return truncated;
        }

        for (let i = hashtags.length - 1; i >= 0; i--) {
            const cutPosition = hashtags[i].start;
            const truncated = content.substring(0, cutPosition).trimEnd();
            const testParse = twemoji.parseTweet(truncated);

            log(TAG, `Testing without hashtag`, {
                tag: hashtags[i].tag,
                weightedLength: `${testParse.weightedLength}/${maxLength}`,
            });

            if (testParse.valid) {
                logOk(TAG, `Truncated by removing hashtags`, { removed: hashtags.length - i });
                return truncated;
            }
        }

        let truncated = content;
        while (truncated.length > 0) {
            truncated = truncated.slice(0, -1);
            if (twemoji.parseTweet(truncated).valid) return truncated;
        }

        return truncated;
    }
}