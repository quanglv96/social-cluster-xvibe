// src/platforms/adb/AdbController.js
import {execFileSync, spawn} from 'child_process';
import {nowIso} from '../../utils/time.js';
import {fileURLToPath} from "url";
import path from "path";
import {runtimeConfig} from "../../config/config.js";
import fs from "fs";

// =========================
// Log Utils — giống pattern CapCutRenderVideo
// =========================

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({type: 'LOG', data: {type, msg}});
}

function log(requestId, message, fields = {}) {
    sendToRenderer('info', formatMsg(requestId, message, fields));
}

function logWarn(requestId, message, fields = {}) {
    sendToRenderer('warn', formatMsg(requestId, `⚠️ ${message}`, fields));
}

function logError(requestId, message, err) {
    sendToRenderer('error', formatMsg(requestId, `❌ ${message}`, {error: err?.message || err}));
}

function logOk(requestId, message, fields = {}) {
    sendToRenderer('ok', formatMsg(requestId, `✅ ${message}`, fields));
}


// =========================
// Class
// =========================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AdbController {

    // requestId truyền vào từ trigger để log có context
    constructor(deviceId='emulator-5554', requestId='ADB', adbPath, emulatorPath) {
        this.device = deviceId;
        this.requestId = requestId;

        this.adbPath = adbPath;
        this.emulatorPath = emulatorPath;

        if (!fs.existsSync(this.adbPath)) {
            throw new Error(`ADB not found: ${this.adbPath}`);
        }
    }

    adb(...args) {
        try {
            return execFileSync(
                this.adbPath,
                ['-s', this.device, ...args],
                {
                    encoding: 'utf8',
                    timeout: 30000,
                    cwd: path.dirname(this.adbPath)
                }
            ).trim();

        } catch (err) {
            throw new Error(
                `adb ${args.join(' ')} failed: ${err.message}`
            );
        }
    }

    adbRaw(...args) {
        try {
            return execFileSync(
                this.adbPath,
                args,
                {
                    encoding: 'utf8',
                    timeout: 30000,
                    cwd: path.dirname(this.adbPath)
                }
            ).trim();

        } catch (err) {
            throw new Error(
                `adb ${args.join(' ')} failed: ${err.message}`
            );
        }
    }

// AdbController.js
    startEmulator(avdName = 'TikTok_AVD', { wipeData = false, snapshot = 'clean_with_apps' } = {}) {
        if (!this.emulatorPath) throw new Error('EMULATOR_PATH missing');
        console.log('[EMULATOR]', this.emulatorPath);

        const args = ['-avd', avdName, '-no-boot-anim', '-no-audio'];

        if (wipeData) {
            args.push('-wipe-data', '-no-snapshot-load', '-no-snapshot-save');
            console.log('[EMULATOR] wipe-data mode');
        } else if (snapshot) {
            args.push('-snapshot', snapshot, '-no-snapshot-save');
            console.log(`[EMULATOR] loading snapshot: ${snapshot}`);
        } else {
            // Boot bình thường, không load snapshot
            args.push('-no-snapshot-load', '-no-snapshot-save');
            console.log('[EMULATOR] normal boot, no snapshot');
        }

        spawn(this.emulatorPath, args, {
            detached: true,
            stdio: 'ignore',
            cwd: path.dirname(this.emulatorPath)
        }).unref();
    }
// Thêm method này vào AdbController
    async waitForPackageManager(timeout = 60_000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            try {
                const result = this.adb('shell', 'pm', 'path', 'android');
                if (result && result.includes('package:')) {
                    console.log('[ADB] package manager ready ✅');
                    return true;
                }
            } catch (_) {}
            console.log('[ADB] waiting for package manager...');
            await this.sleep(3000);
        }
        console.warn('[ADB] package manager timeout');
        return false;
    }
    async waitForDevice(timeout = 180000) {
        const start = Date.now();
        let attempt = 0;

        while (Date.now() - start < timeout) {
            attempt++;
            try {
                const devices = this.adbRaw('devices');
                const lines = devices.split('\n').map(v => v.trim()).filter(Boolean);

                if (attempt % 6 === 1) {
                    console.log(`[ADB] waitForDevice attempt=${attempt} elapsed=${Math.round((Date.now() - start) / 1000)}s`);
                    console.log('[ADB] devices:', lines.join(' | '));
                }

                const deviceLine = lines.find(v => v.startsWith(this.device));

                if (deviceLine) {
                    if (deviceLine.includes('\tdevice')) {
                        const boot = this.adb('shell', 'getprop', 'sys.boot_completed');
                        if (boot.trim() === '1') {
                            console.log('[ADB] ✅ Device ready');
                            return true;
                        }
                    } else if (deviceLine.includes('offline')) {
                        if (attempt % 6 === 1) console.log('[ADB] device is offline, waiting...');
                    } else if (deviceLine.includes('unauthorized')) {
                        // Với -wipe-data thì unauthorized chỉ là trạng thái tạm trong lúc boot
                        // Chờ thêm, KHÔNG restart server
                        if (attempt % 6 === 1) console.log('[ADB] device unauthorized, still booting...');
                    }
                }
            } catch (e) {
                if (attempt % 6 === 1) console.log('[ADB] adb error:', e.message);
            }

            await this.sleep(5000);
        }

        console.error('[ADB] ❌ waitForDevice timeout after', timeout / 1000, 's');
        return false;
    }
    sleep(ms) {
        return new Promise(resolve =>
            setTimeout(resolve, ms)
        );
    }
    push(local, remote) {
        log(this.requestId, `[ADB] push`, {local, remote});
        return this.adb('push', local, remote);
    }

    tap(x, y) {
        log(this.requestId, `[ADB] tap`, {x, y});
        return this.adb('shell', 'input', 'tap', String(x), String(y));
    }

    swipe(x1, y1, x2, y2, ms = 300) {
        log(this.requestId, `[ADB] swipe`, {x1, y1, x2, y2, ms});
        return this.adb('shell', 'input', 'swipe',
            String(x1), String(y1), String(x2), String(y2), String(ms));
    }

    keyEvent(code) {
        log(this.requestId, `[ADB] keyEvent`, {code});
        return this.adb('shell', 'input', 'keyevent', String(code));
    }

    // AdbController.js
    typeText(text) {
        // Thử ADBKeyboard trước (hỗ trợ Unicode/tiếng Việt)
        try {
            const encoded = encodeURIComponent(text);
            const result = this.adb('shell', 'am', 'broadcast',
                '-a', 'ADB_INPUT_TEXT', '--es', 'msg', encoded);
            if (result.includes('result=0')) {
                // broadcast không có receiver → fallback
                throw new Error('ADBKeyboard not installed');
            }
            return result;
        } catch (_) {
            // Fallback: input text (chỉ hoạt động với ASCII)
            log(`[ADB] fallback input text`);
            const safe = text.replace(/[^a-zA-Z0-9 .,!?]/g, ''); // strip non-ASCII
            return this.adb('shell', 'input', 'text', safe);
        }
    }

    dumpUi() {
        log(this.requestId, `[ADB] dumpUi`);
        this.adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
        return this.adb('shell', 'cat', '/sdcard/ui.xml');
    }

    findElement(xml, {text, resourceId, contentDesc, className} = {}) {
        let pattern;
        if (text) pattern = `text="${text}"`;
        else if (resourceId) pattern = `resource-id="${resourceId}"`;
        else if (contentDesc) pattern = `content-desc="${contentDesc}"`;
        else if (className) pattern = `class="${className}"`;
        else return null;

        const re = new RegExp(
            `<node[^>]*${pattern}[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`
        );
        const m = xml.match(re);
        if (!m) return null;

        return {
            x: Math.round((+m[1] + +m[3]) / 2),
            y: Math.round((+m[2] + +m[4]) / 2),
            bounds: {x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4]},
        };
    }

    tapElement(xml, query, fallback) {
        const el = this.findElement(xml, query);
        if (el) {
            log(this.requestId, `[ADB] tapElement found`, {query: JSON.stringify(query), x: el.x, y: el.y});
            this.tap(el.x, el.y);
            return true;
        }
        if (fallback) {
            logWarn(this.requestId, `[ADB] tapElement not found — fallback`, {
                query: JSON.stringify(query),
                fallback: JSON.stringify(fallback),
            });
            this.tap(fallback.x, fallback.y);
            return false;
        }
        throw new Error(`Element not found: ${JSON.stringify(query)}`);
    }

    scanMedia(remotePath) {
        log(this.requestId, `[ADB] scanMedia`, {remotePath});
        return this.adb('shell', 'am', 'broadcast',
            '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
            '-d', `file://${remotePath}`);
    }

    launchTikTok() {
        log(this.requestId, `[ADB] launchTikTok`);
        return this.adb('shell', 'monkey',
            '-p', 'com.zhiliaoapp.musically',
            '-c', 'android.intent.category.LAUNCHER', '1');
    }

    killTikTok() {
        log(this.requestId, `[ADB] killTikTok`);
        return this.adb('shell', 'am', 'force-stop', 'com.zhiliaoapp.musically');
    }

    screenshot(localPath) {
        log(this.requestId, `[ADB] screenshot`, {localPath});
        this.adb('shell', 'screencap', '-p', '/sdcard/__screen.png');
        this.adb('pull', '/sdcard/__screen.png', localPath);
    }

    isOnline() {
        try {
            const result = execFileSync(
                this.adbPath,
                ['devices'],
                {
                    encoding: 'utf8',
                    timeout: 10000,
                    cwd: path.dirname(this.adbPath)
                }
            );

            console.log('========== ADB OUTPUT ==========');
            console.log(result);

            const lines = result
                .split('\n')
                .map(v => v.trim())
                .filter(Boolean);

            const line = lines.find(
                v => v.startsWith(this.device)
            );

            if (!line) {
                return false;
            }

            return line.includes('\tdevice');

        } catch (e) {
            console.error('[ADB ONLINE ERROR]', e);
            return false;
        }
    }

    isPackageInstalled(packageName) {
        try {
            const result = this.adb('shell', 'pm', 'list', 'packages', packageName);
            return result.includes(packageName);
        } catch (e) {
            return false;
        }
    }

    installApk(apkPath) {
        console.log(`[ADB] installing APK:`, apkPath);
        try {
            const result = execFileSync(
                this.adbPath,
                ['-s', this.device, 'install', '-r', '-g', apkPath],
                {
                    encoding: 'utf8',
                    timeout: 120_000, // 2 phút
                    cwd: path.dirname(this.adbPath)
                }
            );
            console.log(`[ADB] install result:`, result.trim());
            return result;
        } catch (err) {
            // Log lỗi nhưng không throw — để flow tiếp tục
            console.error(`[ADB] install failed:`, err.message);
            throw new Error(`APK install failed: ${err.message}`);
        }
    }
}