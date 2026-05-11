import { DelayService } from '../../../services/delay.service.js';
import {nowIso} from "../../../utils/time.js";

// =========================
// Log Utils
// =========================

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}
function sendToRenderer(type, msg) { process.send?.({ type: 'LOG', data: { type, msg } }); }
function log(requestId, message, fields = {})    { sendToRenderer('info',  formatMsg(requestId, message,          fields)); }
function logWarn(requestId, message, fields = {}) { sendToRenderer('warn',  formatMsg(requestId, `⚠️ ${message}`,  fields)); }
function logError(requestId, message, err)        { sendToRenderer('error', formatMsg(requestId, `❌ ${message}`,  { error: err?.message || err })); }
function logOk(requestId, message, fields = {})   { sendToRenderer('ok',    formatMsg(requestId, `✅ ${message}`,  fields)); }

// =========================

const TAG = 'FB_ACCEPT_PAGE';

export class FacebookAcceptPage {

    constructor(context) {
        this.context = context;
        this.delay   = new DelayService();
    }

    async accept({ page_admin_url: pageAdminUrl }, page) {

        if (!page) {
            throw new Error('FacebookAcceptPage requires a page instance');
        }

        try {
            // ── B1: Vào link page admin ──────────────────────────────
            log(TAG, `Navigating to page admin URL`, { pageAdminUrl });
            await page.goto(pageAdminUrl, { waitUntil: 'domcontentloaded' });
            await this.delay.navigation('after goto page admin url', page);

            // ── B1: Click "Xem lại lời mời" ─────────────────────────
            log(TAG, `Looking for "Xem lại lời mời" button`);
            const reviewBtn = await page.waitForSelector(
                '[role="button"][aria-label="Xem lại lời mời"]',
                { timeout: 15_000 }
            );
            if (!reviewBtn) throw new Error('Cannot find "Xem lại lời mời" button');

            await reviewBtn.click();
            logOk(TAG, `Clicked "Xem lại lời mời"`);
            await this.delay.action('after click review invite', page);

            // ── B2: Đợi modal, click "Tiếp" ─────────────────────────
            log(TAG, `Waiting for modal and "Tiếp" button`);
            const nextBtn = await page.waitForSelector(
                '[role="button"][aria-label="Tiếp"]',
                { timeout: 15_000 }
            );
            if (!nextBtn) throw new Error('Cannot find "Tiếp" button');

            await nextBtn.click();
            logOk(TAG, `Clicked "Tiếp"`);
            await this.delay.action('after click next', page);

            // ── B3: Click "Chấp nhận" ────────────────────────────────
            log(TAG, `Waiting for "Chấp nhận" button`);
            const acceptBtn = await page.waitForSelector(
                '[role="button"][aria-label^="Chấp nhận lời mời quản lý"]',
                { timeout: 15_000 }
            );
            if (!acceptBtn) throw new Error('Cannot find "Chấp nhận" button');

            await acceptBtn.click();
            logOk(TAG, `Clicked "Chấp nhận" — page admin invite accepted`);
            await this.delay.navigation('after accept invite', page);

            return { success: true };

        } catch (err) {
            logError(TAG, `Accept page admin invite failed`, err);
            return { success: false, error: err?.message };
        }
    }
}