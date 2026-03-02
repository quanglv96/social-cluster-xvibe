import { SessionManager } from '../session/SessionManager.js';
import { SocialFactory } from "../factory/SocialFactory.js";

export class ContextFactory {

    static async create(dto) {

        // Lấy session đang sống (hoặc tự tạo nếu chưa có / hết hạn)
        const { context } = await SessionManager.getSession();

        // Tạo social theo type (giữ nguyên logic cũ)
        const social = SocialFactory.create(dto.type, context);

        // Authenticate vẫn giữ nguyên behavior cũ
        await social.authenticate(dto);

        return { context, social };
    }
}