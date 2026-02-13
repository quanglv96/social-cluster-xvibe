export class BaseAuth {
    async authenticate(context, dto) {
        throw new Error("Not implemented");
    }
}
