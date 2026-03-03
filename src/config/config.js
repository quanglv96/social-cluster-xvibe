import dotenv from 'dotenv';

dotenv.config();

export const config = {

    // =============================
    // Playwright
    // =============================
    headless: process.env.HEADLESS === 'true',

    // =============================
    // API endpoints (Backend)
    // =============================
    apiImportImage: process.env.API_IMPORT_IMAGE,
    apiUpdatePage: process.env.API_UPDATE_PAGE,
    updateCookie: process.env.API_UPDATE_COOKIE,
    apiLogError: process.env.API_LOG_ERROR,

    // =============================
    // Crawl settings
    // =============================
    maxImages: parseInt(process.env.MAX_IMAGES || '10'),

    // =============================
    // Timeouts
    // =============================
    defaultWait: parseInt(process.env.DEFAULT_WAIT || '3000'),

};
