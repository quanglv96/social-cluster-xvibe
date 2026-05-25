import { BaseSocial } from '../BaseSocial.js';
import { TiktokUploadVideo } from './Tiktokuploadvideo.js';
import {TiktokAuth} from "../../auth/TiktokAuth.js";
import {TiktokUploadSlide} from "./TiktokUploadSlide.js";

export class TiktokSocial extends BaseSocial {

    constructor(context) {
        super(context);
        this.auth         = new TiktokAuth(context);
        this.upload_video = new TiktokUploadVideo(context);
        this.upload_slide = new TiktokUploadSlide(context);
    }

    async uploadVideo(dto, page) {
        // 1. Auth — login & navigate tới màn upload trong Studio
        await this.auth.authenticate(this.context, dto);

        // 2. Upload video — dùng page được tạo từ context pool
        return await this.upload_video.upload(dto, page);
    }

    async uploadSlide(dto, page) {
        // 1. Auth — login & navigate tới màn upload trong Studio
        await this.auth.authenticate(this.context, dto);

        // 2. Upload video — dùng page được tạo từ context pool
        return await this.upload_slide.upload(dto, page);
    }
}