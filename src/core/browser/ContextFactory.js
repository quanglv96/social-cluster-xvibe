import { SessionManager } from '../session/SessionManager.js';
import { SocialFactory } from "../factory/SocialFactory.js";
import { FacebookSocial } from "../social/facebook/FacebookSocial.js";
import { TwitterSocial } from "../social/twitter/TwitterSocial.js";   // thêm mới
import { FacebookContextPool } from "../auth/FacebookContextPool.js";
import { TwitterContextPool } from "../auth/TwitterContextPool.js";   // thêm mới

export class ContextFactory {

    static async create(dto) {
        const FB_TYPES = ['CRAWLS_FB', 'POST_STORY', 'POST_PROFILE', 'POST_GROUP_FB','POST_TOOL_PAGE'];
        const TW_TYPES = ['CRAWLS_TWITTER', 'POST_TWITTER'];  // thêm mới — sửa lại theo type thực tế

        const { type } = dto;

        // Facebook pool
        if (FB_TYPES.includes(type)) {
            const context = await FacebookContextPool.getContext(dto);
            return {
                context,
                social: new FacebookSocial(context)
            };
        }

        // Twitter pool
        if (TW_TYPES.includes(type)) {
            const context = await TwitterContextPool.getContext(dto);
            return {
                context,
                social: new TwitterSocial(context)
            };
        }

        // Fallback: session cũ (các platform khác)
        const { context } = await SessionManager.getSession();
        const social = SocialFactory.create(dto.type, context);
        await social.authenticate(dto);
        return { context, social };
    }
}