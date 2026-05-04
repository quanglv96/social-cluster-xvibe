// src/updater.js
import pkg from 'electron-updater';

import {app, dialog} from 'electron';

const {autoUpdater} = pkg;

export function setupAutoUpdater(mainWindow) {
    // Tắt auto-download để tự control
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    function sendLog(type, msg) {
        mainWindow?.webContents.send('log', {type, msg: `[UPDATER] ${msg}`});
    }

    autoUpdater.on('checking-for-update', () => {
        sendLog('info', '🔍 Checking for update...');
    });

    autoUpdater.on('update-available', (info) => {
        sendLog('ok', `🆕 Update available: v${info.version}`);

        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Available',
            message: `Version ${info.version} is available.\nDownload now?`,
            buttons: ['Download', 'Later']
        }).then(({response}) => {
            if (response === 0) {
                autoUpdater.downloadUpdate();
                sendLog('info', '⬇️ Downloading update...');
            }
        });
    });

    autoUpdater.on('update-not-available', () => {
        sendLog('info', '✅ App is up to date');
    });

    autoUpdater.on('download-progress', (progress) => {
        const pct = Math.round(progress.percent);
        sendLog('info', `⬇️ Downloading... ${pct}% (${Math.round(progress.bytesPerSecond / 1024)} KB/s)`);
    });

    autoUpdater.on('update-downloaded', (info) => {
        sendLog('ok', `✅ Update v${info.version} downloaded. Will install on quit.`);

        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Ready',
            message: `v${info.version} downloaded. Restart to install?`,
            buttons: ['Restart Now', 'Later']
        }).then(({response}) => {
            if (response === 0) {
                autoUpdater.quitAndInstall();
            }
        });
    });

    autoUpdater.on('error', (err) => {
        sendLog('error', `❌ Update error: ${err.message}`);
    });

    // Check sau 3 giây để window load xong
    setTimeout(() => {
        if (app.isPackaged) {
            autoUpdater.checkForUpdates();
        } else {
            sendLog('warn', '⚠️ Skipping update check in dev mode');
        }
    }, 3000);
}