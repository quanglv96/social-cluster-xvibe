export class PostGroupTrigger {

    constructor(social) {
        this.social = social;
    }

    async execute(dto, page) {

        if (!page) {
            throw new Error("PostGroupTrigger requires an event page");
        }

        return await this.social.postGroupAction(dto, page);
    }
}