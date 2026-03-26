import axios from 'axios';
import {config} from "../config/config.js";

export async function logCheckpoint(page, {
    step = 'unknown',
    message = 'success',
} = {}) {

    try {

        let base64 = null;

        const buffer = await page.screenshot({
            fullPage: false,      // ❗ QUAN TRỌNG
            type: 'jpeg',         // ❗ giảm size
            quality: 60           // ❗ giảm size mạnh
        });

        base64 = buffer.toString('base64');

        const payload = {
            step,
            message,
            url: page.url(),
            title: await page.title().catch(() => ''),
            timestamp: Date.now(),
            metadata: base64 // 👈 trực tiếp base64
        };

        await axios.post(config.apiLogCheckPoint, payload, {
            timeout: 10000
        });

        console.log(`[CHECKPOINT] ${step} sent`);

    } catch (err) {
        console.error('[CHECKPOINT ERROR]', err.message);
    }
}