import { BaseSocial } from '../BaseSocial.js';
import { FacebookAuth } from '../../auth/FacebookAuth.js';
import { FacebookCrawler } from './FacebookCrawler.js';
import { FacebookPostGroup } from './FacebookPostGroup.js';

export class FacebookSocial extends BaseSocial {

    constructor(context) {
        super(context);
        this.auth = new FacebookAuth();
        this.crawler = new FacebookCrawler(context);
        this.postGroup = new FacebookPostGroup(context);
    }

    async authenticate(dto) {
        await this.auth.authenticate(this.context, dto);
    }

    async crawl(dto, page) {
        return await this.crawler.crawl(dto ,page);
    }

    async postGroupAction(dto, page) {
        return await this.postGroup.post(dto , page);
    }
}
