export class PostGroupTrigger {

    constructor(social) {
        this.social = social;
    }

    async execute(dto) {
        return await this.social.postGroupAction(dto);
    }
}
