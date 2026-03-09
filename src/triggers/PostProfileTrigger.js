export class PostProfileTrigger {
    static useEventPage = true;
    constructor(social) {
        this.social = social;
    }

    async execute(dto, page) {

        if (!page) {
            throw new Error("PostProfileTrigger requires an event page");
        }

        return await this.social.postProfileAction(dto, page);
    }
}