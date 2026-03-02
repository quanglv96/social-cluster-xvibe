import { BaseSocial } from '../BaseSocial.js';
import {SessionManager} from "../../session/SessionManager.js";
import {XvibeNavigator} from "../XvibeNavigator.js";

export class XvibeSocial extends BaseSocial {

    constructor(context) {
        super(context);
    }

    async openVibeFlow() {

        const { rootPage } = await SessionManager.getSession();

        const navigator = new XvibeNavigator(rootPage);

        await navigator.openVibeAndInteract();
    }
}