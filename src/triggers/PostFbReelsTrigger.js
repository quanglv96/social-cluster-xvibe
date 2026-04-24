export class PostFbReelsTrigger {
    static useEventPage = true;
    constructor(social) {
        this.social = social;
    }

    async execute(dto, page) {

        if (!page) {
            throw new Error("uploadReelAction requires an event page");
        }

        return await this.social.uploadReelAction(dto, page);
    }
}