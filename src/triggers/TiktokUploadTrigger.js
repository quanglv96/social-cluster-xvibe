import { ContextFactory } from '../core/browser/ContextFactory.js';
import {nowIso} from "../utils/time.js";

// =========================
// Log Utils
// =========================

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}
function sendToRenderer(type, msg) { process.send?.({ type: 'LOG', data: { type, msg } }); }
function log(requestId, message, fields = {})   { sendToRenderer('info',  formatMsg(requestId, message,         fields)); }
function logError(requestId, message, err)       { sendToRenderer('error', formatMsg(requestId, `❌ ${message}`, { error: err?.message || err })); }
function logOk(requestId, message, fields = {})  { sendToRenderer('ok',    formatMsg(requestId, `✅ ${message}`, fields)); }

// =========================

const TAG = 'TIKTOK_UPLOAD_TRIGGER';

export class TiktokUploadTrigger {

    // Router dùng flag này để quyết định có gọi createEventPage không
    static useEventPage = true;

    constructor(social) {
        this.social = social;
    }

    async execute(dto, page) {
        log(TAG, `Executing TikTok upload`, {
            user: dto.user_name,
            video: dto.video_url?.slice(0, 60),
        });

        const result = await this.social.uploadVideo(dto, page);

        logOk(TAG, `TikTok upload done`);

        // Trả về format chuẩn giống các trigger khác
        return {success: true};
    }
}