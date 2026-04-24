import { BaseSocial } from '../BaseSocial.js';
import {TiktokUploadVideo} from "./Tiktokuploadvideo.js";

export class TiktokSocial extends BaseSocial {

    constructor(context) {
        super(context);
        this.upload_video = new TiktokUploadVideo(context);
    }

    async uploadVideo(dto) {
        return await this.upload_video.upload(dto);
    }

}