import { SessionManager } from '../session/SessionManager.js';
import { SocialFactory } from "../factory/SocialFactory.js";
import { FacebookSocial } from "../social/facebook/FacebookSocial.js";
import { TwitterSocial } from "../social/twitter/TwitterSocial.js";
import { TiktokSocial } from "../social/tiktok/TiktokSocial.js";
import { FacebookContextPool } from "../auth/FacebookContextPool.js";
import { TwitterContextPool } from "../auth/TwitterContextPool.js";
import { CapCutSocial } from "../social/capcut/CapCutSocial.js";
import { BrowserManager } from "../browser/BrowserManager.js";

export class ContextFactory {

    static async create(dto) {
        return this.createInternal(dto, true);
    }

    static async createInternal(dto, allowRetry) {

        const FB_TYPES = ['CRAWLS_FB', 'POST_STORY', 'POST_PROFILE', 'POST_GROUP_FB', 'POST_TOOL_PAGE', 'FB_UPLOAD_REEL', 'ACCEPT_PAGE'];
        const TW_TYPES = ['CRAWLS_TWITTER', 'POST_TWITTER'];
        const TK_TYPES = ['TIKTOK_UPLOAD'];
        const CC_TYPES = ['RENDER_VIDEO'];

        try {

            const { type } = dto;

            if (FB_TYPES.includes(type)) {
                const context = await FacebookContextPool.getContext(dto);
                return {
                    context,
                    social: new FacebookSocial(context)
                };
            }

            if (TW_TYPES.includes(type)) {
                const context = await TwitterContextPool.getContext(dto);
                return {
                    context,
                    social: new TwitterSocial(context)
                };
            }

            if (TK_TYPES.includes(type)) {
                const { context } = await SessionManager.getSession();
                return {
                    context,
                    social: new TiktokSocial(context)
                };
            }

            if (CC_TYPES.includes(type)) {
                const { context } = await SessionManager.getSession();
                return {
                    context,
                    social: new CapCutSocial(context)
                };
            }

            const { context } = await SessionManager.getSession();
            const social = SocialFactory.create(type, context);
            await social.authenticate(dto);

            return { context, social };

        } catch (err) {

            const message = err?.message ?? "";

            const shouldRecover =
                message.includes("Target page, context or browser has been closed") ||
                message.includes("Target closed") ||
                message.includes("Browser has been closed") ||
                message.includes("Context closed") ||
                message.includes("Protocol error");

            if (!shouldRecover || !allowRetry) {
                throw err;
            }

            console.warn(`[ContextFactory] Recover browser: ${message}`);

            // clear context cũ trong pool
            if (FB_TYPES.includes(dto.type)) {
                await FacebookContextPool.closeContext(dto.userName);
            }
            if (TW_TYPES.includes(dto.type)) {
                await TwitterContextPool.closeContext(dto.userName);
            }

            // Retry đúng 1 lần
            return await this.createInternal(dto, false);
        }
    }
}