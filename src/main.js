// src/main.js
import {app, BrowserWindow, dialog, ipcMain} from 'electron';
import path from 'path';
import {fileURLToPath} from 'url';
import {fork} from 'child_process';
import {setupGlobalErrorHandler} from "./config/globalErrorHandler.js";
import fs from 'fs';
import {runtimeConfig, updateAdbPaths} from "./config/config.js";
import {setupAutoUpdater} from "./updater.js";
import pkg from 'electron-updater';
import {nowIso} from "./utils/time.js";
import {TunnelService} from "./TunnelService.js";
import {AdbEnvironmentManager} from "./platforms/adb/AdbEnvironmentManager.js";
import {AdbController} from "./platforms/adb/AdbController.js";

const {autoUpdater} = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let serverProcess;

// ======================
// Log Utils
// ======================


setupGlobalErrorHandler();

function clearRuntimeConfigIfVersionChanged() {
    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, 'config.runtime.json');
    const versionPath = path.join(userDataPath, 'app.version');

    const currentVersion = app.getVersion();

    try {
        // Đọc version cũ
        const savedVersion = fs.existsSync(versionPath)
            ? fs.readFileSync(versionPath, 'utf-8').trim()
            : null;

        if (savedVersion !== currentVersion) {
            // Version thay đổi → clear cache
            if (fs.existsSync(configPath)) {
                fs.unlinkSync(configPath);
                log('CONFIG', '🧹 cleared stale runtime config', {
                    oldVersion: savedVersion,
                    newVersion: currentVersion
                });
            }

            // Lưu version mới
            fs.writeFileSync(versionPath, currentVersion);
            log('CONFIG', '📌 version stamp updated', {version: currentVersion});
        }

    } catch (err) {
        logError('CONFIG', 'cache invalidation failed', {error: err.message});
    }
}

function formatLog(module, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${module}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function logToRenderer(type, msg) {
    if (mainWindow?.webContents) {
        mainWindow.webContents.send('log', {type, msg});
    }
}

function log(module, message, fields = {}) {
    const msg = formatLog(module, message, fields);
    logToRenderer('info', msg);
}

function logWarn(module, message, fields = {}) {
    const msg = formatLog(module, `⚠️ ${message}`, fields);
    logToRenderer('warn', msg);
}

function logError(module, message, fields = {}) {
    const msg = formatLog(module, `❌ ${message}`, fields);
    console.error(msg);
    logToRenderer('error', msg);
}

// ======================
// WINDOW
// ======================
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(process.resourcesPath, 'icon.ico'), // 🔥 quan trọng
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    log('WINDOW', 'created');
}

// ======================
// START SERVER
// ======================
function startServer(androidTools) {
    if (serverProcess) {
        logWarn('SERVER', 'startServer called but process already running');
        return;
    }

    const userDataPath = app.getPath('userData');

    serverProcess = fork(
        path.join(__dirname, 'app.js'),
        [],
        {
            env: {
                ...process.env,
                RUNTIME_CONFIG_PATH: path.join(userDataPath, 'config.runtime.json'),
                PORTABLE_EXECUTABLE_DIR: process.env.PORTABLE_EXECUTABLE_DIR
                    || path.dirname(process.execPath),
                HEADLESS: String(HEADLESS),   // ✅ truyền xuống child process
                // ✅ dùng tool đã verify
                ADB_PATH: androidTools.adbPath,
                EMULATOR_PATH: androidTools.emulatorPath
            }
        }
    );

    log('SERVER', '🚀 started', {pid: serverProcess.pid});
    log('BOOT', 'after tunnel start');
    (async () => {
        try {

            log('BOOT', 'starting tunnel...', {
                userDataPath
            });

            const tunnelUrl = await TunnelService.start(userDataPath);

            log('BOOT', 'tunnel started', {
                tunnelUrl
            });

        } catch (err) {

            logError('BOOT', 'tunnel failed', {
                error: err.message,
                stack: err.stack
            });

        }
    })();
    serverProcess.on('message', (msg) => {
        console.log('[MAIN IPC]', msg?.type, JSON.stringify(msg?.data)?.slice(0, 100)); // ← thêm

        if (!mainWindow) return;

        if (msg.type === 'LOG') {
            mainWindow.webContents.send('log', msg.data);
            return;
        }

        mainWindow.webContents.send(msg.type, msg.data);
    });

    serverProcess.on('exit', (code) => {
        log('SERVER', '🔚 exited', {code});
        serverProcess = null;

        // 🔥 chỉ restart nếu KHÔNG phải manual
        if (!isManualStop) {
            log('SERVER', '♻️ auto-restarting', {delayMs: 1000});
            setTimeout(() => startServer(cachedAndroidTools), 1000); // ← TRUYỀN VÀO
        } else {
            log('SERVER', '⛔ manual stop — no restart');
            isManualStop = false;
        }
    });
}

let isManualStop = false;
let cachedAndroidTools = null; // ← THÊM

// ======================
// CONTROL
// ======================
ipcMain.on("control", (_, cmd) => {
    log('CONTROL', `received cmd=${cmd}`);

    if (cmd === 'stop') {
        if (serverProcess) {
            isManualStop = true;
            serverProcess.kill();
            log('CONTROL', '🛑 stop — kill signal sent', {pid: serverProcess?.pid});
        } else {
            logWarn('CONTROL', 'stop requested but server is not running');
        }
    }

    if (cmd === 'restart') {
        restartServer();
    }

    if (cmd === 'start') {
        startServer();
    }
});

let isRestarting = false;

function restartServer() {
    if (isRestarting) {
        logWarn('SERVER', 'restartServer called but already restarting');
        return;
    }

    isRestarting = true;
    log('SERVER', '♻️ restarting', {hasPrevProcess: !!serverProcess});

    if (serverProcess) {
        isManualStop = true; // 🔥 cực kỳ quan trọng
        serverProcess.kill();
    }


    setTimeout(() => {
        startServer(cachedAndroidTools); // ← TRUYỀN VÀO
        isRestarting = false;
        log('SERVER', '♻️ restart complete');
    }, 1000)
}

ipcMain.on("update-config", (_, data) => {

    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, 'config.runtime.json');

    log('CONFIG', '📝 update received', {
        hasServer: !!serverProcess
    });

    try {
        // 🔥 GHI FILE CONFIG (nguồn duy nhất)
        fs.writeFileSync(configPath, JSON.stringify(data, null, 2));

        log('CONFIG', '💾 config saved', {
            path: configPath
        });

        // 🔥 luôn restart để apply config mới
        if (serverProcess) {
            restartServer();
        } else {
            logWarn('CONFIG', 'server not running — skip restart');
        }

    } catch (err) {
        logError('CONFIG', 'failed to save config', {
            error: err.message
        });
    }
});

// ======================
// APP
// ======================

// main.js — thay app.whenReady()
app.whenReady().then(async () => {
    log('APP', '🟢 ready');
    clearRuntimeConfigIfVersionChanged();
    createWindow();

    // Server start NGAY
    startServer({adbPath: null, emulatorPath: null});

    mainWindow.webContents.on('did-finish-load', () => {
        sendProfilesToRenderer();
        setupAutoUpdater(mainWindow);
    });
    if (!mainWindow.webContents.isLoading()) {
        sendProfilesToRenderer();
        setupAutoUpdater(mainWindow);
    }

    // ADB init bất đồng bộ — không block UI
    ensureAndroidToolsAsync();
});

async function ensureAndroidToolsAsync() {
    log('ADB', '🔧 starting background init...');
    try {
        const sdkRoot = await chooseAndroidSdkRoot();
        process.env.ANDROID_SDK_ROOT = sdkRoot;

        const manager = new AdbEnvironmentManager();
        logToRenderer('info', '[ADB] 🔧 Initializing Android environment...');

        const result = await manager.ensureReady();

        cachedAndroidTools = result;
        updateAdbPaths(result);

        log('ADB', '✅ environment ready', result);
        logToRenderer('ok', `[ADB] ✅ Android ready — adb=${result.adbPath}`);

        // Notify server
        if (serverProcess) {
            serverProcess.send({
                type: 'ADB_READY',
                payload: {
                    adbPath: result.adbPath,
                    emulatorPath: result.emulatorPath,
                    deviceId: 'emulator-5554',
                }
            });
        }

        // Khởi động emulator ngay sau khi ADB ready
        // Không chờ job — emulator sẵn sàng trước
        bootEmulatorInBackground(result);

    } catch (err) {
        logError('ADB', 'init failed', {error: err.message});
        logToRenderer('error', `[ADB] ❌ Init failed: ${err.message}`);
        setTimeout(() => ensureAndroidToolsAsync(), 30_000);
    }
}

// Boot emulator ngầm, không block
function bootEmulatorInBackground(androidTools) {
    log('ADB', '🤖 booting emulator in background...');
    logToRenderer('info', '[ADB] 🤖 Starting emulator...');

    // hoặc dùng dynamic import nếu ESM:
    const adb = new AdbController(
        'emulator-5554',
        'BOOT',
        androidTools.adbPath,
        androidTools.emulatorPath
    );

    if (adb.isOnline()) {
        log('ADB', '✅ emulator already running');
        logToRenderer('ok', '[ADB] ✅ Emulator already running');
        return;
    }

    // Load snapshot nếu có, không thì boot bình thường
    const snapshotPath = path.join(
        process.env.USERPROFILE || '',
        '.android', 'avd', 'TikTok_AVD.avd', 'snapshots', 'clean_with_apps'
    );
    const hasSnapshot = fs.existsSync(snapshotPath);

    log('ADB', `snapshot exists: ${hasSnapshot}`);
    adb.startEmulator('TikTok_AVD', {
        wipeData: false,
        snapshot: hasSnapshot ? 'clean_with_apps' : undefined
    });

    // Poll trạng thái boot để log lên UI
    let attempt = 0;
    const poll = setInterval(async () => {
        attempt++;
        try {
            if (adb.isOnline()) {
                const boot = adb.adb('shell', 'getprop', 'sys.boot_completed');
                if (boot.trim() === '1') {
                    clearInterval(poll);
                    log('ADB', '✅ emulator boot complete');
                    logToRenderer('ok', '[ADB] ✅ Emulator ready');

                    // Notify server emulator đã sẵn sàng
                    if (serverProcess) {
                        serverProcess.send({type: 'EMULATOR_READY', payload: {deviceId: 'emulator-5554'}});
                    }
                    return;
                }
            }
            if (attempt % 6 === 0) {
                logToRenderer('info', `[ADB] ⏳ Emulator booting... (${attempt * 5}s)`);
            }
        } catch (_) {
        }

        if (attempt > 60) { // 5 phút
            clearInterval(poll);
            logToRenderer('warn', '[ADB] ⚠️ Emulator boot timeout');
        }
    }, 5000);
}

async function ensureAndroidTools() {
    const sdkRoot = await chooseAndroidSdkRoot();

    // Truyền sdkRoot vào manager qua env
    process.env.ANDROID_SDK_ROOT = sdkRoot;

    const manager = new AdbEnvironmentManager();
    const result = await manager.ensureReady();
    updateAdbPaths(result);
    cachedAndroidTools = result;
    log('ADB', 'self-healing environment ready', result);
    return result;
}

async function chooseAndroidSdkRoot() {
    const userDataPath = app.getPath('userData');
    const sdkConfigPath = path.join(userDataPath, 'sdk-location.json');

    // Nếu đã chọn trước rồi thì dùng lại
    if (fs.existsSync(sdkConfigPath)) {
        const {sdkRoot} = JSON.parse(fs.readFileSync(sdkConfigPath, 'utf-8'));
        if (sdkRoot && fs.existsSync(sdkRoot)) {
            console.log('[SDK] using saved location:', sdkRoot);
            return sdkRoot;
        }
    }

    // Hỏi user lần đầu
    const result = await dialog.showMessageBox({
        type: 'question',
        title: 'Chọn vị trí lưu Android SDK',
        message: 'Android SDK cần ~5GB dung lượng.\nBạn muốn lưu ở đâu?',
        buttons: ['Chọn thư mục...', 'Dùng mặc định (ổ C)'],
        defaultId: 0,
        cancelId: 1,
    });

    let sdkRoot;

    if (result.response === 0) {
        // Mở dialog chọn thư mục
        const folder = await dialog.showOpenDialog({
            title: 'Chọn thư mục lưu Android SDK',
            properties: ['openDirectory', 'createDirectory'],
            buttonLabel: 'Chọn thư mục này',
        });

        if (folder.canceled || !folder.filePaths[0]) {
            // User cancel → dùng mặc định
            sdkRoot = path.join(userDataPath, 'android-sdk');
        } else {
            sdkRoot = path.join(folder.filePaths[0], 'android-sdk');
        }
    } else {
        sdkRoot = path.join(userDataPath, 'android-sdk');
    }

    // Lưu lại để lần sau không hỏi nữa
    fs.writeFileSync(sdkConfigPath, JSON.stringify({sdkRoot}, null, 2));
    console.log('[SDK] location saved:', sdkRoot);

    return sdkRoot;
}

app.on('window-all-closed', () => {
    log('APP', 'all windows closed — shutting down');
    if (serverProcess) serverProcess.kill();
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-version', () => {
    return app.getVersion();
});


// ==========UPDATE HEADLESS REALTIME==========
let HEADLESS = true; // 🔥 sync với BrowserManager default

ipcMain.handle('get-headless', () => HEADLESS);

ipcMain.on('set-headless', (e, val) => {
    HEADLESS = val;
    if (serverProcess) {
        serverProcess.send({type: 'SET_HEADLESS', payload: val});
    }
});


// ── THÊM VÀO CUỐI main.js ──────────────────────────────────────────

// ======================
// PROFILES
// ======================

// Đọc danh sách profile từ FB_PROFILES_DIR và gửi xuống renderer
function sendProfilesToRenderer() {
    const fbDir = runtimeConfig.facebookProfileDir;
    const twitterDir = runtimeConfig.twitterProfileDir;
    try {
        const fbProfiles = readProfilesFromDir(fbDir, 'facebook');
        const twitterProfiles = readProfilesFromDir(twitterDir, 'twitter');

        const profiles = [...fbProfiles, ...twitterProfiles];
        log('PROFILES', `sent ${profiles.length} profiles ...`);

        mainWindow?.webContents.send('profiles', profiles);

        log('PROFILES', `sent ${profiles.length} profiles (fb: ${fbProfiles.length}, twitter: ${twitterProfiles.length})`);

    } catch (err) {
        logError('PROFILES', 'failed to read profiles', {error: err.message});
        mainWindow?.webContents.send('profiles', []);
    }
}

function readProfilesFromDir(baseDir, type) {
    try {
        if (!fs.existsSync(baseDir)) return [];

        const entries = fs.readdirSync(baseDir, {withFileTypes: true});

        return entries
            .filter(e => e.isDirectory())
            .map(e => ({
                name: e.name,
                profilePath: path.join(baseDir, e.name),
                type: type // 'facebook' | 'twitter'
            }));

    } catch (err) {
        logError('PROFILES', 'failed to read dir', {dir: baseDir, error: err.message});
        return [];
    }
}

// Renderer request refresh danh sách
ipcMain.on('get-profiles', () => {
    sendProfilesToRenderer();
});

// Renderer bấm "Mở" → forward xuống server process
ipcMain.on('open-profile', (_, payload) => {
    const {profilePath, type} = payload;
    log('PROFILES', `open-profile requested`, {profilePath, type});

    if (!serverProcess) {
        logWarn('PROFILES', 'server not running, cannot open profile');
        return;
    }

    serverProcess.send({type: 'OPEN_PROFILE', payload: {profilePath, type}});
});

// Renderer bấm "Xóa" → xóa thư mục profile
ipcMain.on('delete-profile', (_, {profilePath}) => {
    log('PROFILES', `delete-profile requested`, {profilePath});

    try {
        // ✅ Đóng context nếu đang mở
        if (serverProcess) {
            serverProcess.send({type: 'CLOSE_PROFILE', payload: {profilePath}});
        }

        // Chờ 500ms để context đóng xong rồi mới xóa
        setTimeout(() => {
            try {
                fs.rmSync(profilePath, {recursive: true, force: true});
                log('PROFILES', `✅ deleted profile`, {profilePath});
                // Refresh lại danh sách
                sendProfilesToRenderer();
            } catch (err) {
                logError('PROFILES', `failed to delete profile`, {error: err.message});
            }
        }, 500);

    } catch (err) {
        logError('PROFILES', `delete-profile error`, {error: err.message});
    }
});

// main.js
ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall(false, true);
});