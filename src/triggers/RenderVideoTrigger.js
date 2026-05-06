export class RenderVideoTrigger {
    static useEventPage = true;
    constructor(social) {
        this.social = social;
    }

    async execute(dto, page) {

        if (!page) {
            throw new Error("RenderVideoAction requires an event page");
        }

        return await this.social.renderVideo(dto, page);
    }
}