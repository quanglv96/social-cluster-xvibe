// src/platforms/adb/AdbEnvironmentManager.js
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import unzipper from 'unzipper';
import {spawn} from 'child_process';
import {app} from 'electron';
import {AdbController} from "./AdbController.js";

export class AdbEnvironmentManager {
    constructor() {
        this.sdkRoot = process.env.ANDROID_SDK_ROOT
            || path.join(app.getPath('userData'), 'android-sdk');
        this.cmdlineToolsZip = path.join(this.sdkRoot, 'cmdline.zip');
        this.platformToolsDir = path.join(this.sdkRoot, 'platform-tools');
        this.emulatorDir = path.join(this.sdkRoot, 'emulator');
        this.isWin = process.platform === 'win32';
        this.binExt = this.isWin ? '.bat' : '';
    }

    // =========================
    // ENTRY
    // =========================
    async ensureReady() {
        console.log('[ADB] INIT START');
        await this.runJavaCheck();
        await this.ensureSdkRoot();
        await this.ensureCmdlineTools();
        await this.ensureSdkPackages();
        await this.ensureAvd('TikTok_AVD');
        // Chỉ reset + install app nếu chưa từng setup
        const setupDoneFlag = path.join(this.sdkRoot, '.setup_complete');
        if (!fs.existsSync(setupDoneFlag)) {
            await this.resetAdbAndKeys();
            await this.ensureAppsInstalled();
            fs.writeFileSync(setupDoneFlag, new Date().toISOString());
            console.log('[ADB] first-time setup complete, flag written');
        } else {
            console.log('[ADB] already setup — skip app install');
        }
        console.log('[ADB] INIT DONE');
        return {
            adbPath: this.getAdbPath(),
            emulatorPath: this.getEmulatorPath()
        };
    }

    // =========================
    // ENSURE APPS INSTALLED
    // =========================
    async forceResetup() {
        const setupDoneFlag = path.join(this.sdkRoot, '.setup_complete');
        if (fs.existsSync(setupDoneFlag)) {
            fs.unlinkSync(setupDoneFlag);
            console.log('[ADB] setup flag cleared — will reinstall on next boot');
        }
        await this.resetAdbAndKeys();
        await this.ensureAppsInstalled();
        fs.writeFileSync(setupDoneFlag, new Date().toISOString());
    }
    async resetAdbAndKeys() {
        // 1. Kill emulator nếu đang chạy
        try {
            const { execFileSync } = await import('child_process');
            execFileSync(this.getAdbPath(), ['emu', 'kill'], {
                encoding: 'utf8', timeout: 5000,
                cwd: path.dirname(this.getAdbPath())
            });
            console.log('[ADB] emulator killed');
        } catch (_) {
            // không sao nếu chưa có emulator
        }

        // 2. Kill ADB server
        try {
            const { execFileSync } = await import('child_process');
            execFileSync(this.getAdbPath(), ['kill-server'], {
                encoding: 'utf8', timeout: 5000,
                cwd: path.dirname(this.getAdbPath())
            });
            console.log('[ADB] adb server killed');
        } catch (_) {}

        await new Promise(r => setTimeout(r, 1500));

        // 3. Xóa key cũ
        const adbKeyDir = path.join(
            process.env.USERPROFILE || process.env.HOME || '',
            '.android'
        );
        for (const f of ['adbkey', 'adbkey.pub']) {
            const p = path.join(adbKeyDir, f);
            if (fs.existsSync(p)) {
                fs.unlinkSync(p);
                console.log('[ADB] deleted old key:', p);
            }
        }

        // 4. Start lại ADB server với key mới
        try {
            const { execFileSync } = await import('child_process');
            execFileSync(this.getAdbPath(), ['start-server'], {
                encoding: 'utf8', timeout: 10000,
                cwd: path.dirname(this.getAdbPath())
            });
            console.log('[ADB] adb server restarted with fresh keys');
        } catch (_) {}

        await new Promise(r => setTimeout(r, 1000));
    }

    async ensureAppsInstalled() {
        const apkDir = path.join(this.sdkRoot, 'apk');
        const apps = [
            {
                packageName: 'com.zhiliaoapp.musically',
                label: 'TikTok',
                apkUrl: process.env.TIKTOK_APK_URL
                    || 'https://d.apkpure.com/b/APK/com.zhiliaoapp.musically?version=latest',
                apkDest: path.join(apkDir, 'tiktok.apk'),
            },
            {
                packageName: 'com.lemon.lvoverseas',
                label: 'CapCut',
                apkUrl: process.env.CAPCUT_APK_URL
                    || 'https://d.apkpure.com/b/APK/com.lemon.lvoverseas?version=latest',
                apkDest: path.join(apkDir, 'capcut.apk'),
            },
            {
                packageName: 'com.android.adbkeyboard',
                label: 'ADBKeyboard',
                apkUrl: 'https://github.com/senzhk/ADBKeyBoard/raw/master/ADBKeyboard.apk',
                apkDest: path.join(apkDir, 'adbkeyboard.apk'),
            },
        ];

        console.log('[ADB] booting emulator for first-time app install (wipe-data)...');
        const adb = this._makeAdbController();

        if (adb.isOnline()) {
            try {
                const { execFileSync } = await import('child_process');
                execFileSync(this.getAdbPath(), ['-s', 'emulator-5554', 'emu', 'kill'], {
                    encoding: 'utf8', timeout: 5000,
                    cwd: path.dirname(this.getAdbPath())
                });
                await new Promise(r => setTimeout(r, 3000));
                console.log('[ADB] killed existing emulator before fresh boot');
            } catch (_) {}
        }

        adb.startEmulator('TikTok_AVD', { wipeData: true });

        // Bước 1: chờ device online
        const ready = await adb.waitForDevice(300_000);
        if (!ready) {
            console.warn('[ADB] ⚠️ emulator boot timeout — skip app install');
            return;
        }

        // Bước 2: chờ package manager sẵn sàng — key fix
        console.log('[ADB] waiting for package manager...');
        const pmReady = await adb.waitForPackageManager(120_000);
        if (!pmReady) {
            console.warn('[ADB] ⚠️ package manager not ready — skip app install');
            return;
        }

        // Bước 3: thêm delay nhỏ để system settle
        await new Promise(r => setTimeout(r, 3000));

        fs.mkdirSync(apkDir, { recursive: true });
        for (const a of apps) {
            await this.ensureApp(adb, a);
        }

        await this.enableAdbKeyboard(adb);
        await this.saveSnapshot(adb, 'clean_with_apps');
        console.log('[ADB] apps installed + snapshot saved ✅');
    }

// Lưu snapshot để lần sau boot nhanh + giữ app
    async saveSnapshot(adb, snapshotName = 'clean_with_apps') {
        console.log(`[ADB] saving snapshot: ${snapshotName}...`);
        try {
            // Dùng adb emu avd snapshot save
            const { execFileSync } = await import('child_process');
            execFileSync(
                this.getAdbPath(),
                ['-s', 'emulator-5554', 'emu', 'avd', 'snapshot', 'save', snapshotName],
                {
                    encoding: 'utf8',
                    timeout: 60_000, // snapshot có thể mất ~30-60s
                    cwd: path.dirname(this.getAdbPath())
                }
            );
            console.log(`[ADB] snapshot saved: ${snapshotName} ✅`);
        } catch (e) {
            console.warn('[ADB] snapshot save failed (non-fatal):', e.message);
        }
    }
    async enableAdbKeyboard(adb) {
        try {
            adb.adb('shell', 'ime', 'enable', 'com.android.adbkeyboard/.AdbIME');
            adb.adb('shell', 'ime', 'set', 'com.android.adbkeyboard/.AdbIME');
            console.log('[ADB] ADBKeyboard enabled ✅');
        } catch (e) {
            console.warn('[ADB] ADBKeyboard enable failed:', e.message);
        }
    }
    async ensureApp(adb, { packageName, label, apkUrl, apkDest }) {
        console.log(`[ADB] check app: ${label} (${packageName})`);

        if (adb.isPackageInstalled(packageName)) {
            console.log(`[ADB] ${label} already installed ✅`);
            return;
        }

        console.log(`[ADB] ${label} not found → download APK...`);

        if (!fs.existsSync(apkDest)) {
            await this.downloadAny(apkUrl, apkDest);
        } else {
            console.log(`[ADB] APK cached: ${apkDest}`);
        }

        try {
            console.log(`[ADB] installing ${label}...`);
            adb.installApk(apkDest);
            console.log(`[ADB] ${label} installed ✅`);
        } catch (err) {
            console.error(`[ADB] ⚠️ ${label} install error:`, err.message);
        } finally {
            // Xóa APK ngay sau khi install — dù thành công hay fail
            try {
                fs.unlinkSync(apkDest);
                console.log(`[ADB] APK deleted after install: ${apkDest}`);
            } catch (_) {}
        }
    }

    _makeAdbController() {
        return new AdbController(
            'emulator-5554',
            'ADB_INIT',
            this.getAdbPath(),
            this.getEmulatorPath()
        );
    }

    // =========================
    // DOWNLOAD — support http + https + redirect + User-Agent
    // =========================
    download(url, dest) {
        return this.downloadAny(url, dest);
    }

    downloadAny(url, dest) {
        return new Promise((resolve, reject) => {
            const request = (u, redirectCount = 0) => {
                if (redirectCount > 10) {
                    return reject(new Error('[ADB] too many redirects'));
                }

                console.log(`[ADB] download → ${u}`);
                const protocol = u.startsWith('https') ? https : http;

                protocol.get(u, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/octet-stream,*/*',
                    }
                }, res => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        console.log(`[ADB] redirect ${res.statusCode} → ${res.headers.location}`);
                        res.resume();
                        return request(res.headers.location, redirectCount + 1);
                    }

                    if (res.statusCode !== 200) {
                        return reject(new Error(`[ADB] download failed: HTTP ${res.statusCode} at ${u}`));
                    }

                    const contentType = res.headers['content-type'] || '';
                    if (contentType.includes('text/html')) {
                        return reject(new Error(`[ADB] URL trả về HTML, không phải APK: ${u}`));
                    }

                    const total = Number(res.headers['content-length'] || 0);
                    let downloaded = 0;
                    const file = fs.createWriteStream(dest);

                    res.on('data', chunk => {
                        downloaded += chunk.length;
                        if (total && downloaded % (1024 * 512) === 0) {
                            console.log(`[ADB] download progress: ${((downloaded / total) * 100).toFixed(1)}%`);
                        }
                    });

                    res.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        console.log(`[ADB] download complete → ${dest}`);
                        resolve();
                    });
                    file.on('error', reject);

                }).on('error', reject);
            };

            request(url);
        });
    }

    // =========================
    // COMMAND RUNNER
    // =========================
    _buildWindowsArgs(cmd, args) {
        const dir = path.dirname(cmd);
        const file = path.basename(cmd);
        // Trả về { cmd, args, options } thay vì chỉ args
        return { file, args, cwd: dir };
    }

    runCommand(cmd, args = []) {
        return new Promise((resolve, reject) => {
            const isWindows = process.platform === 'win32';
            const child = spawn(
                isWindows ? path.basename(cmd) : cmd,
                args,
                {
                    shell: true,
                    cwd: path.dirname(cmd),
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: {
                        ...process.env,
                        ANDROID_SDK_ROOT: this.sdkRoot,  // ← sdkmanager đọc cái này
                        ANDROID_HOME: this.sdkRoot,       // ← fallback
                        JAVA_TOOL_OPTIONS: '-Dfile.encoding=UTF-8'
                    }
                }
            );

            let buffer = '';
            const parse = (chunk) => {
                buffer += chunk.toString();
                const parts = buffer.split(/\r/);
                buffer = parts.pop();
                for (const p of parts) {
                    const txt = p.trim();
                    if (txt) console.log('[ADB]', txt);
                }
            };
            child.stdout.on('data', parse);
            child.stderr.on('data', parse);
            child.on('error', reject);
            child.on('close', (code) => {
                console.log('[ADB] exit:', code);
                code === 0 ? resolve() : reject(new Error(`Command failed ${code}`));
            });
        });
    }

    runCommandWithAutoInput(cmd, args = []) {
        return new Promise((resolve, reject) => {
            const isWindows = process.platform === 'win32';
            const child = spawn(
                isWindows ? path.basename(cmd) : cmd,
                args,
                {
                    shell: true,
                    cwd: path.dirname(cmd),
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: {
                        ...process.env,
                        ANDROID_SDK_ROOT: this.sdkRoot,  // ← key fix
                        ANDROID_HOME: this.sdkRoot,
                        JAVA_TOOL_OPTIONS: '-Dfile.encoding=UTF-8'
                    }
                }
            );

            const sendY = () => { try { child.stdin.write('y\n'); } catch (_) {} };
            sendY();
            const interval = setInterval(sendY, 500);

            let buffer = '';
            const parse = (chunk) => {
                buffer += chunk.toString();
                const parts = buffer.split(/\r|\n/);
                buffer = parts.pop();
                for (const p of parts) {
                    const txt = p.trim();
                    if (txt) console.log('[ADB]', txt);
                }
            };
            child.stdout.on('data', parse);
            child.stderr.on('data', parse);
            child.on('error', (err) => { clearInterval(interval); reject(err); });

            const timeout = setTimeout(() => {
                console.log('[ADB] timeout → force close');
                clearInterval(interval);
                try { child.stdin.end(); } catch (_) {}
                child.kill();
                resolve();
            }, 90_000);

            child.on('close', (code) => {
                clearTimeout(timeout);
                clearInterval(interval);
                console.log('[ADB] exit code:', code);
                resolve();
            });
        });
    }

    // =========================
    // JAVA CHECK
    // =========================
    runJavaCheck() {
        return new Promise((resolve, reject) => {
            const child = spawn('java', ['-version']);
            child.on('error', () => reject(new Error('Java not installed')));
            child.on('close', code => code === 0 ? resolve() : reject(new Error('Java not installed')));
        });
    }

    // =========================
    // SDK ROOT
    // =========================
    async ensureSdkRoot() {
        if (!fs.existsSync(this.sdkRoot)) {
            fs.mkdirSync(this.sdkRoot, { recursive: true });
        }
    }

    // =========================
    // CMDLINE TOOLS
    // =========================
    async ensureCmdlineTools() {
        try {
            if (fs.existsSync(this.resolveSdkManagerPath())) {
                console.log('[ADB] cmdline-tools already exists');
                return;
            }
        } catch (_) {}

        console.log('[ADB] download cmdline-tools');
        const url = 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip';
        await this.downloadAny(url, this.cmdlineToolsZip);
        console.log('[ADB] unzip');
        await fs.createReadStream(this.cmdlineToolsZip).pipe(unzipper.Extract({ path: this.sdkRoot })).promise();
        fs.unlinkSync(this.cmdlineToolsZip);

        const base = path.join(this.sdkRoot, 'cmdline-tools');
        const latest = path.join(base, 'latest');
        const tmp = path.join(this.sdkRoot, 'cmdline-tools-tmp');
        fs.renameSync(base, tmp);
        fs.mkdirSync(latest, { recursive: true });
        for (const item of fs.readdirSync(tmp)) {
            fs.renameSync(path.join(tmp, item), path.join(latest, item));
        }
        fs.rmSync(tmp, { recursive: true, force: true });
        console.log('[ADB] cmdline-tools ready');
    }

    // =========================
    // SDK PACKAGES — skip nếu đã cài
    // =========================
    async ensureSdkPackages() {
        const systemImageDir = path.join(
            this.sdkRoot, 'system-images', 'android-30', 'google_apis_playstore', 'x86_64'
        );

        const adbOk = fs.existsSync(this.getAdbPath());
        const emulatorOk = fs.existsSync(this.getEmulatorPath());
        const imageOk = fs.existsSync(systemImageDir);

        if (adbOk && emulatorOk && imageOk) {
            console.log('[ADB] sdk packages already installed — skip');
            return;
        }

        console.log('[ADB] install sdk packages');
        console.log('[ADB] adb:', adbOk, '| emulator:', emulatorOk, '| image:', imageOk);

        const sdkmanager = this.resolveSdkManagerPath();

        console.log('[ADB] licenses stage start');
        await this.runCommandWithAutoInput(sdkmanager, ['--licenses']);
        console.log('[ADB] licenses done');

        if (!adbOk) {
            console.log('[ADB] installing platform-tools...');
            await this.runCommandWithAutoInput(sdkmanager, ['platform-tools']);
        }

        if (!emulatorOk) {
            console.log('[ADB] installing emulator...');
            await this.runCommandWithAutoInput(sdkmanager, ['emulator']);
        }

        if (!imageOk) {
            console.log('[ADB] installing system image google_apis_playstore...');
            await this.runCommandWithAutoInput(
                sdkmanager,
                ['system-images;android-30;google_apis_playstore;x86_64']
            );
        }

        console.log('[ADB] sdk install complete');
    }

    async ensureAvd(name) {
        const avdPath = path.join(process.env.USERPROFILE || '', '.android', 'avd', `${name}.avd`);
        console.log('[ADB] check AVD:', avdPath);

        if (fs.existsSync(avdPath)) {
            console.log('[ADB] AVD exists ✅');
            return; // AVD còn → không làm gì
        }

        // AVD mất → tạo lại + xóa setup flag để reinstall app
        console.log('[ADB] AVD not found → creating...');
        const avdmanagerPath = path.join(
            this.sdkRoot, 'cmdline-tools', 'latest', 'bin',
            this.isWin ? 'avdmanager.bat' : 'avdmanager'
        );

        await this.runCommandWithAutoInput(avdmanagerPath, [
            'create', 'avd',
            '--name', name,
            '--package', 'system-images;android-30;google_apis_playstore;x86_64',
            '--device', 'pixel_3a',
            '--force'
        ]);
        console.log('[ADB] AVD created:', name);

        // ← QUAN TRỌNG: AVD mới = không có app → xóa flag để reinstall
        const setupDoneFlag = path.join(this.sdkRoot, '.setup_complete');
        if (fs.existsSync(setupDoneFlag)) {
            fs.unlinkSync(setupDoneFlag);
            console.log('[ADB] setup flag cleared — AVD was recreated, will reinstall apps');
        }
    }

    // =========================
    // PATH RESOLVE
    // =========================
    resolveSdkManagerPath() {
        const p = path.join(this.sdkRoot, 'cmdline-tools', 'latest', 'bin', `sdkmanager${this.binExt}`);
        if (fs.existsSync(p)) return p;
        throw new Error('[ADB] sdkmanager not found');
    }

    getAdbPath() {
        return path.join(this.platformToolsDir, this.isWin ? 'adb.exe' : 'adb');
    }

    getEmulatorPath() {
        return path.join(this.emulatorDir, this.isWin ? 'emulator.exe' : 'emulator');
    }

    // =========================
    // HEALTH CHECK
    // =========================
    isHealthy() {
        return fs.existsSync(this.getAdbPath()) && fs.existsSync(this.getEmulatorPath());
    }
}