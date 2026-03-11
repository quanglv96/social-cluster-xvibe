import { BaseSocial } from '../BaseSocial.js';
import { FacebookAuth } from '../../auth/FacebookAuth.js';
import { FacebookCrawler } from './FacebookCrawler.js';
import { FacebookPostGroup } from './FacebookPostGroup.js';
import {FacebookPostStory} from "./FacebookPostStory.js";
import {FacebookPostProfile} from "./FacebookPostProfile.js";
import {TwitterCrawler} from "../twitter/TwitterCrawler.js";

export class FacebookSocial extends BaseSocial {

    constructor(context) {
        super(context);
        this.auth = new FacebookAuth();
        this.fb_crawler = new FacebookCrawler(context);
        this.postGroup = new FacebookPostGroup(context);
        this.postProfile = new FacebookPostProfile(context);
        this.postStory = new FacebookPostStory(context);
    }

    async authenticate(dto) {
        await this.auth.authenticate(this.context, dto);
    }

    async fbCrawler(dto, page) {
        return await this.fb_crawler.crawl(dto ,page);
    }

    async postGroupAction(dto, page) {
        return await this.postGroup.post(dto , page);
    }

    async postProfileAction(dto, page) {
        return await this.postProfile.post(dto , page);
    }

    async postStoryAction(dto, page) {
        return await this.postStory.post(dto , page);
    }
}
