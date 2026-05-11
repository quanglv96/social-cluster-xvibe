import {BaseSocial} from '../BaseSocial.js';
import {FacebookCrawler} from './FacebookCrawler.js';
import {FacebookPostGroup} from './FacebookPostGroup.js';
import {FacebookPostStory} from "./FacebookPostStory.js";
import {FacebookPostProfile} from "./FacebookPostProfile.js";
import {FacebookPartnerPostGroup} from "./FacebookPartnerPostGroup.js";
import {FacebookUploadReels} from "./FacebookUploadReels.js";
import {FacebookAcceptPage} from "./FacebookAcceptPage.js";

export class FacebookSocial extends BaseSocial {

    constructor(context) {
        super(context);
        // this.auth = new FacebookAuth();
        this.fb_crawler = new FacebookCrawler(context);
        this.postGroup = new FacebookPostGroup(context);
        this.partnerPostGroup = new FacebookPartnerPostGroup(context);
        this.postProfile = new FacebookPostProfile(context);
        this.postStory = new FacebookPostStory(context);
        this.postReel = new FacebookUploadReels(context);
        this.acceptPage = new FacebookAcceptPage(context);
    }

    async fbCrawler(dto, page) {
        return await this.fb_crawler.crawl(dto, page);
    }

    async postGroupAction(dto, page) {
        return await this.postGroup.post(dto, page);
    }

    async partnerPostGroupAction(dto, page) {
        return await this.partnerPostGroup.post(dto, page);
    }

    async postProfileAction(dto, page) {
        return await this.postProfile.post(dto, page);
    }

    async postStoryAction(dto, page) {
        return await this.postStory.post(dto, page);
    }

    async uploadReelAction(dto, page) {
        return await this.postReel.upload(dto, page);
    }

    async acceptPageAction(dto, page) {
        return await this.acceptPage.accept(dto, page);
    }
}
