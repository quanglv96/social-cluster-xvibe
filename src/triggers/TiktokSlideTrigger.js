// src/triggers/TiktokSlideTrigger.js
import { AdbController } from '../platforms/adb/AdbController.js';
import { TiktokAdbUpload } from '../platforms/adb/TiktokAdbUpload.js';
import { runtimeConfig } from '../config/config.js';

const TAG = 'TK_SLIDE_TRIGGER';

function send(type, msg) {
    process.send?.({ type: 'LOG', data: { type, msg } });
}
function log(msg)  { send('info',  `[${TAG}] ${msg}`); }
function warn(msg) { send('warn',  `[${TAG}] ⚠️ ${msg}`); }
function logErr(msg) { send('error', `[${TAG}] ❌ ${msg}`); }

export class TiktokSlideTrigger {
    static useEventPage = false;

    constructor(_social) {}

    async execute(dto) {
        log(`execute START — schedulerId=${dto.scheduler_id}`);
        log(`dto = ${JSON.stringify({
            id: dto.id,
            scheduler_id: dto.scheduler_id,
            type: dto.type,
            content_length: dto.content?.length,
            map_images: dto.map_images,
        })}`);

        // ── 1. Parse images ──────────────────────────────────────
        const images = this.parseSources(dto.map_images);
        log(`parseSources → ${images.size} images: ${JSON.stringify([...images.entries()])}`);
        if (images.size === 0) {
            throw new Error('No images provided in dto.map_images');
        }

        // ── 2. ADB config ────────────────────────────────────────
        const adbPath      = runtimeConfig.adb?.adbPath;
        const emulatorPath = runtimeConfig.adb?.emulatorPath;
        const deviceId     = runtimeConfig.adb?.deviceId ?? 'emulator-5554';

        log(`runtimeConfig.adb = ${JSON.stringify(runtimeConfig.adb)}`);
        log(`adbPath=${adbPath} | emulatorPath=${emulatorPath} | deviceId=${deviceId}`);

        if (!adbPath) {
            throw new Error(`ADB chưa được khởi tạo. runtimeConfig.adb = ${JSON.stringify(runtimeConfig.adb)}`);
        }

        // ── 3. ADB controller ────────────────────────────────────
        log('Creating AdbController...');
        const adb = new AdbController(deviceId, dto.scheduler_id, adbPath, emulatorPath);

        const online = adb.isOnline();
        log(`adb.isOnline() = ${online}`);

        if (!online) {
            console.log('Device offline → start emulator from snapshot');
            // Không wipeData → load snapshot clean_with_apps → boot ~30s, app còn nguyên
            adb.startEmulator('TikTok_AVD', { wipeData: false, snapshot: 'clean_with_apps' });
            const ready = await adb.waitForDevice(300_000);
            if (!ready) throw new Error('Emulator boot timeout');
        }

        // ── 4. Launch TikTok ─────────────────────────────────────
        log('Launching TikTok...');
        try {
            adb.launchTikTok();
            log('TikTok launched ✅');
        } catch (e) {
            logErr(`launchTikTok failed: ${e.message}`);
            // Check package installed
            try {
                const pkgs = adb.adb('shell', 'pm', 'list', 'packages', 'com.zhiliaoapp.musically');
                log(`pm list packages result: "${pkgs}"`);
                if (!pkgs.includes('com.zhiliaoapp.musically')) {
                    throw new Error('TikTok (com.zhiliaoapp.musically) chưa được install trên emulator');
                }
            } catch (pmErr) {
                logErr(`pm check failed: ${pmErr.message}`);
            }
            throw e;
        }

        // ── 5. Upload ────────────────────────────────────────────
        log('Starting TiktokAdbUpload...');
        const uploader = new TiktokAdbUpload(adb);

        let result;
        try {
            result = await uploader.upload({
                images,
                caption: dto.content || '',
            });
            log(`upload result = ${JSON.stringify(result)}`);
        } catch (e) {
            logErr(`uploader.upload failed: ${e.message}`);
            logErr(`stack: ${e.stack}`);
            throw e;
        }

        // ── 6. Return ────────────────────────────────────────────
        const returnVal = {
            images: [...images.values()],
            index: null,
            request_type: 'TIKTOK_SLIDE',
            ...result,
        };
        log(`execute DONE — returning: ${JSON.stringify(returnVal)}`);
        return returnVal;
    }

    parseSources(sources) {
        const map = new Map();
        if (!sources) {
            warn(`parseSources: sources is ${sources}`);
            return map;
        }

        log(`parseSources input type=${typeof sources} isArray=${Array.isArray(sources)}`);

        if (Array.isArray(sources)) {
            sources.forEach((v, i) => map.set(i, v));
        } else if (typeof sources === 'object') {
            for (const [k, v] of Object.entries(sources)) {
                map.set(Number(k), v);
            }
        }

        log(`parseSources output: ${JSON.stringify([...map.entries()])}`);
        return map;
    }
}