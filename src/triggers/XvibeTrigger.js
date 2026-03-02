export class XvibeTrigger {
    static useEventPage = true;
    constructor(social) {
        this.social = social;
    }

    async execute(dto, page) {
        return await this.social.openVibeFlow(dto, page);
    }
}