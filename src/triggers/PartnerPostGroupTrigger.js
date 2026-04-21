export class PartnerPostGroupTrigger {
    static useEventPage = true;
    constructor(social) {
        this.social = social;
    }

    async execute(dto, page) {

        if (!page) {
            throw new Error("partnerPostGroupAction requires an event page");
        }

        return await this.social.partnerPostGroupAction(dto, page);
    }
}