import dotenv from 'dotenv';

dotenv.config();

export const config = {

    // =============================
    // Playwright
    // =============================
    headless: process.env.HEADLESS === 'false',

    // =============================
    // API endpoints (Backend)
    // =============================
    apiImportImage: process.env.API_IMPORT_IMAGE,
    apiUpdatePage: process.env.API_UPDATE_PAGE,
    updateCookie: process.env.API_UPDATE_COOKIE,
    apiLogError: process.env.API_LOG_ERROR,
    apiLogCheckPoint: process.env.API_LOG_CHECK_POINT,
    rootUrl: process.env.ROOT_URL,

    // =============================
    // Crawl settings
    // =============================
    maxImages: parseInt( '100'),

    // =============================
    // Timeouts
    // =============================
    defaultWait: parseInt(process.env.DEFAULT_WAIT || '3000'),
    facebookProfileDir: './fb_profiles', // folder lưu multi-profile
};
