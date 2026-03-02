import { BaseSocial } from '../BaseSocial.js';
import { TwitterAuth } from '../../auth/TwitterAuth.js';
import { TwitterPost } from './TwitterPost.js';

export class TwitterSocial extends BaseSocial {

    constructor(context) {
        super(context);
        this.auth = new TwitterAuth();
        this.postService = new TwitterPost(context);
    }

    async authenticate(dto) {
        await this.auth.authenticate(this.context, dto);
    }

    /**
     * page được inject từ SessionManager
     */
    async post(dto, page) {

        if (!page) {
            throw new Error("TwitterSocial.post requires an event page");
        }

        return await this.postService.post(dto, page);
    }
}