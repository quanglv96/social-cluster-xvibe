import pkg from 'electron-updater';
import { app, dialog, ipcMain } from 'electron';
import {nowIso} from "./utils/time.js";

const { autoUpdater } = pkg;

let isSetup = false;

export function setupAutoUpdater(mainWindow) {
    if (isSetup) return;
    isSetup = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;

    // ✅ Dùng đúng format như các module khác → hiện trong log panel
    function sendLog(type, message) {
        const msg = `[${nowIso()}] [UPDATER] ${message}`;
        console.log(msg);
        mainWindow?.webContents.send('log', { type, msg });
    }

    function sendUpdate(event, data = {}) {
        mainWindow?.webContents.send('updater', { event, ...data });
    }

    autoUpdater.on('checking-for-update', () => {
        sendLog('info', '🔍 Checking for update...');
        sendUpdate('checking');
    });

    autoUpdater.on('update-available', (info) => {
        sendLog('ok', `🆕 New version available: v${info.version}`);
        sendUpdate('available', { version: info.version });

        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Available',
            message: `🆕 Version ${info.version} is available`,
            detail: 'Download and install the latest version now?',
            buttons: ['Download Now', 'Later'],
            defaultId: 0,
            cancelId: 1,
        }).then(({ response }) => {
            if (response === 0) {
                autoUpdater.downloadUpdate();
                sendLog('info', '⬇️ Starting download...');
                sendUpdate('downloading', { percent: 0 });
            } else {
                sendUpdate('idle');
            }
        });
    });

    autoUpdater.on('update-not-available', (info) => {
        sendLog('info', `✅ Already on latest version v${info.version}`);
        sendUpdate('idle');
    });

    autoUpdater.on('download-progress', (progress) => {
        const pct = Math.round(progress.percent);
        const kbps = Math.round(progress.bytesPerSecond / 1024);
        const transferred = (progress.transferred / 1024 / 1024).toFixed(1);
        const total = (progress.total / 1024 / 1024).toFixed(1);

        sendLog('info', `⬇️ ${pct}% — ${transferred}/${total} MB @ ${kbps} KB/s`);
        sendUpdate('downloading', { percent: pct, kbps, transferred, total });
    });

    autoUpdater.on('update-downloaded', (info) => {
        sendLog('ok', `✅ Update v${info.version} ready to install`);
        sendUpdate('downloaded', { version: info.version });

        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Ready',
            message: `✅ Version ${info.version} downloaded`,
            detail: 'Restart now to apply the update?',
            buttons: ['Restart Now', 'Later'],
            defaultId: 0,
            cancelId: 1,
        }).then(({ response }) => {
            if (response === 0) {
                autoUpdater.quitAndInstall(false, true);
            }
        });
    });

    autoUpdater.on('error', (err) => {
        sendLog('error', `❌ Update error: ${err.message}`);
        sendUpdate('error', { message: err.message });
    });

    setTimeout(() => {
        if (app.isPackaged) {
            sendLog('info', '🔍 Starting update check...');
            autoUpdater.checkForUpdates();
        } else {
            sendLog('warn', '⚠️ Dev mode — skipping update check');
        }
    }, 3000);

    ipcMain.removeAllListeners('check-for-updates');
    ipcMain.on('check-for-updates', () => {
        if (app.isPackaged) {
            autoUpdater.checkForUpdates();
        }
    });
}