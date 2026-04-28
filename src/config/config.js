import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createRequire } from 'module';
import os from 'os';  // ← thêm dòng này

const require = createRequire(import.meta.url);
const envPath = process.env.PORTABLE_EXECUTABLE_DIR
    ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, '.env')
    : path.resolve('.env');
dotenv.config({ path: envPath });

// =============================
// Đọc built-in config từ package.json
// =============================
let builtinConfig = {};
try {
    const pkg = require('../../package.json'); // hoặc path phù hợp
    builtinConfig = pkg.config || {};
} catch (e) {
    // ignore
}

// runtime path
const RUNTIME_PATH =
    process.env.RUNTIME_CONFIG_PATH
    || path.resolve('./src/config/config.runtime.json');



// =============================
// Load persisted config
// =============================
let persisted = {};
if (fs.existsSync(RUNTIME_PATH)) {
    try {
        persisted = JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf-8'));
    } catch (e) {
        console.error("❌ Failed to read runtime config file");
    }
}

// =============================
// Utils
// =============================
const toStr = (val, def = '') => val ? val.trim() : def;

const toBool = (val, def = false) =>
    val === undefined ? def : val.toString().toLowerCase() === 'true';

const toNumber = (val, def) => {
    const n = Number(val);
    return isNaN(n) ? def : n;
};

// =============================
// Base (🔥 Ưu tiên persisted)
// =============================
const ROOT_URL = persisted.rootUrl || toStr(process.env.ROOT_URL) || builtinConfig.rootUrl || 'https://xvibe.me';

const HOST = persisted.host || toStr(process.env.HOST) || builtinConfig.host || '';

// =============================
// Config (immutable base)
// =============================
const USER_DATA_DIR =
    process.env.APPDATA                          // Windows: C:\Users\xxx\AppData\Roaming
    || process.env.HOME                          // macOS/Linux: /Users/xxx
    || os.homedir();
export const config = {
    headless: toBool(process.env.HEADLESS, builtinConfig.headless ?? true),
    rootUrl: ROOT_URL,
    host: HOST,
    api: buildApi(HOST),
    maxImages: toNumber(process.env.MAX_IMAGES, builtinConfig.maxImages ?? 100),
    defaultWait: toNumber(process.env.DEFAULT_WAIT, builtinConfig.defaultWait ?? 3000),
    facebookProfileDir: process.env.FB_PROFILES_DIR || path.join(USER_DATA_DIR, 'SocialCluster', 'fb-profiles'),
    twitterProfileDir: process.env.TW_PROFILES_DIR || path.join(USER_DATA_DIR, 'SocialCluster', 'twitter-profiles'),
};

// =============================
// Runtime (mutable)
// =============================
export const runtimeConfig = JSON.parse(JSON.stringify(config));

// =============================
// API builder
// =============================
function buildApi(host) {
    return {
        apiImportImage: `${host}/api/import-image`,
        apiUpdatePage: `${host}/api/update-crawls`,
        apiUpdateCookie: `${host}/api/update-cookies`,
        apiLogError: `${host}/api/internal/error-fb-crawls`,
        apiLogCheckPoint: `${host}/api/internal/log-check-point`,
        apiRegisterSever: `${host}/api/register-sever-social`,
        apiCallbackResponse: `${host}/api/social-callback`,
        apiGetVideo: `${host}/api/reel`,
        apiNotifyCaptcha: `${host}/api/internal/notify-captcha`,
    };
}

// =============================
// Persist helper
// =============================
function persistConfig(data) {
    try {
        fs.mkdirSync(path.dirname(RUNTIME_PATH), { recursive: true });
        fs.writeFileSync(RUNTIME_PATH, JSON.stringify({
            rootUrl: runtimeConfig.rootUrl,  // ← luôn giữ lại
            ...data                           // ← host từ caller ghi đè nếu có
        }, null, 2));
        console.log("💾 Config persisted");
    } catch (e) {
        console.error("❌ Failed to persist config:", e);
    }
}

// =============================
// Update config (🔥 core)
// =============================
export function updateConfig(newConfig = {}) {

    let changed = false;

    if (newConfig.host && newConfig.host !== runtimeConfig.host) {
        runtimeConfig.host = newConfig.host.trim();
        runtimeConfig.api = buildApi(runtimeConfig.host);
        changed = true;
    }

    if (newConfig.rootUrl) {
        console.warn("⚠️ rootUrl is immutable");
    }

    for (const key of Object.keys(newConfig)) {
        if (!['host', 'rootUrl'].includes(key) && key in runtimeConfig) {
            runtimeConfig[key] = newConfig[key];
            changed = true;
        }
    }

    if (changed) {
        persistConfig({
            host: runtimeConfig.host,
        });
    }

    console.log("⚡ Updated config:", runtimeConfig);
}