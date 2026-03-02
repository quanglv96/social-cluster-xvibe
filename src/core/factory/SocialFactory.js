import { FacebookSocial } from '../social/facebook/FacebookSocial.js';
import { TwitterSocial } from '../social/twitter/TwitterSocial.js';
import {XvibeSocial} from "../social/xvibe/XvibeSocial.js";

export class SocialFactory {

    static create(type, context) {

        switch (type) {

            case 'POST_GROUP_FB':
            case 'CRAWLS_FB':
                return new FacebookSocial(context);

            case 'POST_TWITTER':
                return new TwitterSocial(context);
            case 'XVIBE_FLOW':
                return new XvibeSocial(context);
            default:
                throw new Error("Unsupported social type");
        }
    }
}
