export class PostTweetTrigger {

    constructor(social) {
        this.social = social;
    }

    async execute(dto, page) {

        if (!page) {
            throw new Error("PostTweetTrigger requires an event page");
        }

        return await this.social.post(dto, page);
    }
}