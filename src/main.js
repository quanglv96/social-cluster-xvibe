// src/main.js
import {app, BrowserWindow, ipcMain} from 'electron';
import path from 'path';
import {fileURLToPath} from 'url';
import {fork} from 'child_process';
import {setupGlobalErrorHandler} from "./config/globalErrorHandler.js";
import fs from 'fs';
import {runtimeConfig} from "./config/config.js";
import {setupAutoUpdater} from "./updater.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let serverProcess;

// ======================
// Log Utils
// ======================

function nowIso() {
    return new Date().toISOString();
}

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
            log('CONFIG', '📌 version stamp updated', { version: currentVersion });
        }

    } catch (err) {
        logError('CONFIG', 'cache invalidation failed', { error: err.message });
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
function startServer() {
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
            }
        }
    );

    log('SERVER', '🚀 started', {pid: serverProcess.pid});

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
            setTimeout(() => startServer(), 1000);
        } else {
            log('SERVER', '⛔ manual stop — no restart');
            isManualStop = false;
        }
    });
}

let isManualStop = false;

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
        startServer();
        isRestarting = false;
        log('SERVER', '♻️ restart complete');
    }, 1000);
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
app.whenReady().then(() => {
    log('APP', '🟢 ready');
    clearRuntimeConfigIfVersionChanged();
    createWindow();
    startServer();
    // ✅ Thêm dòng này
    mainWindow.webContents.on('did-finish-load', () => {
        setupAutoUpdater(mainWindow);
    });
});

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
        serverProcess.send({ type: 'SET_HEADLESS', payload: val });
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
        logError('PROFILES', 'failed to read profiles', { error: err.message });
        mainWindow?.webContents.send('profiles', []);
    }
}

function readProfilesFromDir(baseDir, type) {
    try {
        if (!fs.existsSync(baseDir)) return [];

        const entries = fs.readdirSync(baseDir, { withFileTypes: true });

        return entries
            .filter(e => e.isDirectory())
            .map(e => ({
                name: e.name,
                profilePath: path.join(baseDir, e.name),
                type:type // 'facebook' | 'twitter'
            }));

    } catch (err) {
        logError('PROFILES', 'failed to read dir', { dir: baseDir, error: err.message });
        return [];
    }
}

// Gửi profiles ngay khi window ready
app.whenReady().then(() => {
    // (đã có createWindow + startServer ở trên, chỉ thêm dòng này)
    mainWindow?.webContents.on('did-finish-load', () => {
        sendProfilesToRenderer();
    });
});

// Renderer request refresh danh sách
ipcMain.on('get-profiles', () => {
    sendProfilesToRenderer();
});

// Renderer bấm "Mở" → forward xuống server process
ipcMain.on('open-profile', (_, payload) => {
    const { profilePath, type } = payload;
    log('PROFILES', `open-profile requested`, { profilePath, type });

    if (!serverProcess) {
        logWarn('PROFILES', 'server not running, cannot open profile');
        return;
    }

    serverProcess.send({ type: 'OPEN_PROFILE', payload: { profilePath, type }});
});