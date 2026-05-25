import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {createRequire} from 'module';
import os from 'os';

const require = createRequire(import.meta.url);
const envPath = process.env.PORTABLE_EXECUTABLE_DIR
    ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, '.env')
    : path.resolve('.env');
dotenv.config({path: envPath});

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

const HOST = 'http://localhost:1234';

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
    adb: buildAdb(),
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
        capCutExplorerUrl: `https://www.capcut.com/template-explorer`,
        apiGetImageVibe: `${host}/api/cap-cut/get-image`,
        apiUploadVideoCapCut: `${host}/api/cap-cut/render-video`,
    };
}

// function buildAdb() {
//     const userData =
//         process.env.USER_DATA_DIR ||
//         process.env.APPDATA ||
//         process.env.HOME ||
//         '';
//
//     // FIX: app.getPath('userData') = APPDATA/fb-crawler, không phải APPDATA thẳng
//     const appName = 'fb-crawler'; // phải khớp với tên app trong package.json
//     const sdkRoot = path.join(userData, appName, 'android-sdk');
//
//     return {
//         deviceId: persisted.adb?.deviceId || 'emulator-5554',
//         avdName: persisted.adb?.avdName || 'TikTok_AVD',
//
//         adbPath:
//             process.env.ADB_PATH ||
//             path.join(sdkRoot, 'platform-tools', 'adb.exe'),
//
//         emulatorPath:
//             process.env.EMULATOR_PATH ||
//             path.join(sdkRoot, 'emulator', 'emulator.exe'),
//     };
// }
function buildAdb() {
    return {
        deviceId: persisted.adb?.deviceId || 'emulator-5554',
        avdName:  persisted.adb?.avdName  || 'TikTok_AVD',
        // adbPath và emulatorPath để TRỐNG — sẽ được set sau bởi AdbEnvironmentManager
        adbPath:       persisted.adb?.adbPath       || process.env.ADB_PATH       || '',
        emulatorPath:  persisted.adb?.emulatorPath  || process.env.EMULATOR_PATH  || '',
    };
}

// =============================
// Persist helper
// =============================

function persistConfig() {
    try {
        fs.mkdirSync(path.dirname(RUNTIME_PATH), { recursive: true });
        fs.writeFileSync(RUNTIME_PATH, JSON.stringify({
            rootUrl: runtimeConfig.rootUrl,
            host:    runtimeConfig.host,
            adb:     runtimeConfig.adb,
        }, null, 2));
        console.log('💾 Config persisted');
    } catch (e) {
        console.error('❌ Failed to persist config:', e);
    }
}

// =============================
// Update config (🔥 core)
// =============================
export function updateConfig(newConfig = {}) {
    let changed = false;

    if (newConfig.host && newConfig.host !== runtimeConfig.host) {
        runtimeConfig.host = newConfig.host.trim();
        runtimeConfig.api  = buildApi(runtimeConfig.host);
        changed = true;
    }

    if (newConfig.adb && typeof newConfig.adb === 'object') {
        runtimeConfig.adb = { ...runtimeConfig.adb, ...newConfig.adb };
        changed = true;
    }

    if (newConfig.rootUrl) {
        console.warn('⚠️ rootUrl is immutable');
    }

    // 'adb' thêm vào exclude list — đã xử lý riêng ở trên
    const SKIP = ['host', 'rootUrl', 'adb'];
    for (const key of Object.keys(newConfig)) {
        if (!SKIP.includes(key) && key in runtimeConfig) {
            runtimeConfig[key] = newConfig[key];
            changed = true;
        }
    }

    if (changed) persistConfig();

    console.log('⚡ Updated config:', runtimeConfig);
}

export function updateAdbPaths({ adbPath, emulatorPath }) {
    runtimeConfig.adb.adbPath      = adbPath;
    runtimeConfig.adb.emulatorPath = emulatorPath;
    persistConfig(); // lưu lại để lần sau không cần cài lại
    console.log('[CONFIG] adb paths updated:', adbPath, emulatorPath);
}