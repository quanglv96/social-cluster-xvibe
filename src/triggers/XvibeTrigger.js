export class XvibeTrigger {

    constructor(social) {
        this.social = social;
    }

    async execute(dto) {
        return await this.social.openVibeFlow(dto);
    }
}