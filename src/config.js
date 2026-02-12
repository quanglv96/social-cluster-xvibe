import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',

  // ===== Backend API =====
  apiListPage: required('API_LIST_PAGE'),
  apiImportImage: required('API_IMPORT_IMAGE'),
  apiUpdatePage: required('API_UPDATE_PAGE'),
  updateCookie: required('API_UPDATE_COOKIE'),

  // ===== Crawl Config =====
  headless: process.env.HEADLESS === 'true',
  scrollDelay: Number(process.env.SCROLL_DELAY ?? 1500),
  maxScroll: Number(process.env.MAX_SCROLL ?? 20),

  // ===== File Output =====
  cookieFile: process.env.COOKIE_FILE || './cookies.json'
};
