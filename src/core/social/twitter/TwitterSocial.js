import { BaseSocial } from '../BaseSocial.js';
import { TwitterAuth } from '../../auth/TwitterAuth.js';
import { TwitterPost } from './TwitterPost.js';
import {TwitterCrawler} from "./TwitterCrawler.js";

export class TwitterSocial extends BaseSocial {

    constructor(context) {
        super(context);
        this.auth = new TwitterAuth();
        this.postService = new TwitterPost(context);
        this.tw_crawler = new TwitterCrawler(context);
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


    async twCrawler(dto, page) {
        return await this.tw_crawler.crawl(dto ,page);
    }
}