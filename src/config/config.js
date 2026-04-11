import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv'; dotenv.config();
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
const ROOT_URL = toStr(process.env.ROOT_URL);
const HOST = persisted.host || toStr(process.env.HOST);

// =============================
// Config (immutable base)
// =============================
export const config = {
    headless: toBool(process.env.HEADLESS, true),

    rootUrl: ROOT_URL,
    host: HOST,
    api: buildApi(HOST),
    maxImages: toNumber(process.env.MAX_IMAGES, 100),
    defaultWait: toNumber(process.env.DEFAULT_WAIT, 3000),

    facebookProfileDir: './fb_profiles',
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
        apiImportImage: `${host}/api/vibe/import-image`,
        apiUpdatePage: `${host}/api/vibe/update-crawls`,
        apiUpdateCookie: `${host}/api/vibe/update-cookies`,
        apiLogError: `${host}/api/vibe/internal/error-fb-crawls`,
        apiLogCheckPoint: `${host}/api/vibe/internal/log-check-point`,
        apiRegisterSever: `${host}/api/vibe/register-sever-social`,
        apiCallbackResponse: `${host}/api/vibe/social-callback`,
    };
}

// =============================
// Persist helper
// =============================
function persistConfig(data) {
    try {
        fs.mkdirSync(path.dirname(RUNTIME_PATH), { recursive: true });
        fs.writeFileSync(RUNTIME_PATH, JSON.stringify(data, null, 2));
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
            // rootUrl: runtimeConfig.rootUrl
        });
    }

    console.log("⚡ Updated config:", runtimeConfig);
}