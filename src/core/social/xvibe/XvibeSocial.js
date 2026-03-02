import { BaseSocial } from '../BaseSocial.js';
import {XvibeNavigator} from "../XvibeNavigator.js";

export class XvibeSocial extends BaseSocial {

    constructor(context) {
        super(context);
    }

    async openVibeFlow(dto, page) {
        // page ở đây chính là rootPage
        const navigator = new XvibeNavigator(page);

        await navigator.openVibeAndInteract();
    }
}