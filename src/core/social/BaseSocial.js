export class BaseSocial {
    constructor(context) {
        this.context = context;
    }

    async authenticate(dto) {
        throw new Error("Not implemented");
    }
}
