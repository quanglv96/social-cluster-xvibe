import fs from 'fs';
import path from 'path';

// runtime path
const RUNTIME_PATH =
    process.env.RUNTIME_CONFIG_PATH
    || path.resolve('./src/config/config.runtime.json');

console.log("📂 Runtime config path:", RUNTIME_PATH);


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
const ROOT_URL = persisted.rootUrl || toStr(process.env.ROOT_URL);

// =============================
// Config (immutable base)
// =============================
export const config = {
    headless: toBool(process.env.HEADLESS, true),

    rootUrl: ROOT_URL,

    api: buildApi(ROOT_URL),

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
function buildApi(root) {
    return {
        apiImportImage: `${root}/api/vibe/import-image`,
        apiUpdatePage: `${root}/api/vibe/update-crawls`,
        apiUpdateCookie: `${root}/api/vibe/update-cookies`,
        apiLogError: `${root}/api/vibe/internal/error-fb-crawls`,
        apiLogCheckPoint: `${root}/api/vibe/internal/log-check-point`,
        apiRegisterSever: `${root}/api/vibe/register-sever-social`,
        apiCallbackResponse: `${root}/api/vibe/social-callback`,
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

    // 🔥 handle rootUrl (quan trọng nhất)
    if (newConfig.rootUrl) {
        const root = newConfig.rootUrl.trim();

        if (root !== runtimeConfig.rootUrl) {
            runtimeConfig.rootUrl = root;
            runtimeConfig.api = buildApi(root);
            changed = true;

            console.log("🌐 New host:", root);
        }
    }

    // 🔥 các field khác
    Object.keys(newConfig).forEach(key => {
        if (key !== 'rootUrl' && key in runtimeConfig) {
            runtimeConfig[key] = newConfig[key];
            changed = true;
        }
    });

    // 🔥 persist nếu có thay đổi
    if (changed) {
        persistConfig({
            rootUrl: runtimeConfig.rootUrl
        });
    }

    console.log("⚡ Updated config:", JSON.stringify(runtimeConfig, null, 2));
}