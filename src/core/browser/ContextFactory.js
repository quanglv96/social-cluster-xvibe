import {SessionManager} from '../session/SessionManager.js';
import {SocialFactory} from "../factory/SocialFactory.js";
import {FacebookSocial} from "../social/facebook/FacebookSocial.js";
import {TwitterSocial} from "../social/twitter/TwitterSocial.js";
import {TiktokSocial} from "../social/tiktok/TiktokSocial.js";
import {FacebookContextPool} from "../auth/FacebookContextPool.js";
import {TwitterContextPool} from "../auth/TwitterContextPool.js";
import {CapCutSocial} from "../social/capcut/CapCutSocial.js";

export class ContextFactory {

    static async create(dto) {
        const FB_TYPES = ['CRAWLS_FB', 'POST_STORY', 'POST_PROFILE', 'POST_GROUP_FB', 'POST_TOOL_PAGE', 'FB_UPLOAD_REEL'];
        const TW_TYPES = ['CRAWLS_TWITTER', 'POST_TWITTER'];
        const TK_TYPES = ['TIKTOK_UPLOAD'];
        const CC_TYPES = ['RENDER_VIDEO'];

        const {type} = dto;
        console.log("ContextFactory type {}", type)
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

        // TikTok — dùng root session, auth tự handle trong TiktokSocial
        if (TK_TYPES.includes(type)) {
            const {context} = await SessionManager.getSession();
            return {
                context,
                social: new TiktokSocial(context)
            };
        }
        if (CC_TYPES.includes(type)) {
            const {context} = await SessionManager.getSession();
            return {
                context,
                social: new CapCutSocial(context)
            };
        }

        // Fallback: session cũ (các platform khác)
        const {context} = await SessionManager.getSession();
        const social = SocialFactory.create(dto.type, context);
        await social.authenticate(dto);
        return {context, social};
    }
}