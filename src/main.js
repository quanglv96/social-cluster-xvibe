// src/main.js
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let serverProcess;

// ======================
// WINDOW
// ======================
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

// ======================
// START SERVER
// ======================
function startServer() {
    if (serverProcess) return;

    const userDataPath = app.getPath('userData');

    serverProcess = fork(
        path.join(__dirname, 'app.js'),
        [],
        {
            env: {
                ...process.env,
                RUNTIME_CONFIG_PATH: path.join(userDataPath, 'config.runtime.json')
            }
        }
    );

    serverProcess.on('message', (msg) => {
        if (!mainWindow) return;

        mainWindow.webContents.send(msg.type, msg.data);
    });

    serverProcess.on('exit', (code) => {
        console.log("⚠️ Server exited:", code);

        serverProcess = null;

        // 🔥 chỉ restart nếu KHÔNG phải manual
        if (!isManualStop) {
            console.log("♻️ Auto restarting server...");
            setTimeout(() => startServer(), 1000);
        } else {
            console.log("⛔ Manual stop — no restart");
            isManualStop = false; // reset lại
        }
    });
}
let isManualStop = false;
// ======================
// CONTROL
// ======================
ipcMain.on("control", (_, cmd) => {

    if (cmd === 'stop') {
        if (serverProcess) {
            console.log("🛑 Stopping server...");

            isManualStop = true;

            serverProcess.kill();

            console.log("📴 Kill signal sent to server process");
        } else {
            console.log("⚠️ Stop requested but server is not running");
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
    if (isRestarting) return;

    isRestarting = true;

    if (serverProcess) {
        isManualStop = true; // 🔥 cực kỳ quan trọng
        serverProcess.kill();
    }

    setTimeout(() => {
        startServer();
        isRestarting = false;
    }, 1000);
}

ipcMain.on("update-config", (_, data) => {
    if (serverProcess) {
        serverProcess.send({
            type: "CONFIG_UPDATE",
            payload: data
        });

        // 🔥 restart sau khi update
        restartServer();
    }
});

// ======================
// APP
// ======================
app.whenReady().then(() => {
    createWindow();
    startServer();
});

app.on('window-all-closed', () => {
    if (serverProcess) serverProcess.kill();
    if (process.platform !== 'darwin') app.quit();
});