import pkg from 'electron-updater';
import { app, dialog, ipcMain } from 'electron';

const { autoUpdater } = pkg;

export function setupAutoUpdater(mainWindow) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    // ✅ Bỏ qua lỗi cert trên một số môi trường
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;

    function sendLog(type, msg) {
        mainWindow?.webContents.send('log', { type, msg: `[UPDATER] ${msg}` });
    }

    function sendUpdate(event, data = {}) {
        mainWindow?.webContents.send('updater', { event, ...data });
    }

    // ── EVENTS ──────────────────────────────────

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

    // updater.js — sửa event update-downloaded
    autoUpdater.on('update-downloaded', (info) => {
        sendLog('ok', `✅ Update v${info.version} downloaded. Will install on quit.`);
        sendUpdate('downloaded', { version: info.version });

        // Dialog vẫn giữ để user có thể restart ngay
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

    // ── CHECK FOR UPDATES ────────────────────────

    setTimeout(() => {
        if (app.isPackaged) {
            autoUpdater.checkForUpdates();
        } else {
            sendLog('warn', '⚠️ Dev mode — skipping update check');
        }
    }, 3000);

    // ── IPC: renderer có thể trigger check thủ công ──
    ipcMain.on('check-for-updates', () => {
        if (app.isPackaged) {
            autoUpdater.checkForUpdates();
        }
    });
}