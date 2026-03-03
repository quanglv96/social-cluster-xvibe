export class PostStoryTrigger {
    static useEventPage = true;
    constructor(social) {
        this.social = social;
    }

    async execute(dto, page) {

        if (!page) {
            throw new Error("PostStoryTrigger requires an event page");
        }

        return await this.social.postStoryAction(dto, page);
    }
}