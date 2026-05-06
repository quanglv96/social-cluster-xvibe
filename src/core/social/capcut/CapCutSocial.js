import { BaseSocial } from '../BaseSocial.js';
import {CapCutRenderVideo} from "./CapCutRenderVideo.js";
import {CapCutAuth} from "../../auth/CapCutAuth.js";

export class CapCutSocial extends BaseSocial {

    constructor(context) {
        super(context);
        this.capcutAuth = new CapCutAuth(this.context);
        this.capCutRenderVideo = new CapCutRenderVideo(context);
    }

    async renderVideo(dto, page) {
        await this.capcutAuth.authenticate(this.context,dto);
        return await this.capCutRenderVideo.render(dto, page);
    }
}