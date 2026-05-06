import { FacebookSocial } from '../social/facebook/FacebookSocial.js';
import { TwitterSocial } from '../social/twitter/TwitterSocial.js';
import {XvibeSocial} from "../social/xvibe/XvibeSocial.js";
import {TiktokSocial} from "../social/tiktok/TiktokSocial.js";
import {CapCutSocial} from "../social/capcut/CapCutSocial.js";

export class SocialFactory {

    static create(type, context) {

        switch (type) {

            case 'POST_GROUP_FB':
            case 'POST_STORY':
            case 'POST_PROFILE':
            case 'CRAWLS_FB':
            case 'PARTNER_POST_GROUP':
            case 'FB_UPLOAD_REEL':
                return new FacebookSocial(context);

            case 'POST_TWITTER':
            case 'CRAWLS_TWITTER':
                return new TwitterSocial(context);
            case 'TIKTOK_UPLOAD':
                return new TiktokSocial(context);
            case 'RENDER_VIDEO':
                return new CapCutSocial(context)
            case 'XVIBE_FLOW':
                return new XvibeSocial(context);
            default:
                throw new Error("Unsupported social type");
        }
    }
}
