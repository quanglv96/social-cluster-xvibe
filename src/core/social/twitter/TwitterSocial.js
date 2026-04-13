import { BaseSocial } from '../BaseSocial.js';
import { TwitterPost } from './TwitterPost.js';
import {TwitterCrawler} from "./TwitterCrawler.js";
import {TwitterContextPool} from "../../auth/TwitterContextPool.js";

export class TwitterSocial extends BaseSocial {

    constructor(context) {
        super(context);
        this.postService = new TwitterPost(context);
        this.tw_crawler  = new TwitterCrawler(context);
    }

    async post(dto) {
        const page = await TwitterContextPool.createEventPage(dto);
        return await this.postService.post(dto, page);
    }

    async twCrawler(dto) {
        const page = await TwitterContextPool.createEventPage(dto);

        // goto nằm ở đây thay vì trong Trigger
        await page.goto(dto.source + '/media', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await page.waitForTimeout(3000);

        return await this.tw_crawler.crawl(dto, page);
    }
}