export class PostTweetTrigger {

    constructor(social) {
        this.social = social;
    }

    async execute(dto) {
        return await this.social.post(dto);
    }
}
