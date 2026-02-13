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

    async post(dto) {
        return await this.postService.post(dto);
    }
}
