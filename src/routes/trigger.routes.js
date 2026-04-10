import express from 'express';
import {SessionManager} from '../core/session/SessionManager.js';
import {FbCrawlTrigger} from '../triggers/FbCrawlTrigger.js';
import {PostGroupTrigger} from '../triggers/PostGroupTrigger.js';
import {PostTweetTrigger} from '../triggers/PostTweetTrigger.js';
import {ContextFactory} from '../core/browser/ContextFactory.js';
import {PostStoryTrigger} from "../triggers/PostStoryTrigger.js";
import {runtimeConfig} from "../config/config.js";
import {PostProfileTrigger} from "../triggers/PostProfileTrigger.js";
import {TwCrawlTrigger} from "../triggers/TwCrawlTrigger.js";
import {FacebookContextPool} from "../core/auth/FacebookContextPool.js";
import {reportError} from '../app.js';

const router = express.Router();

let ACTIVE_REQUESTS = 0;
let EVENT_PAGE_SEQ = 0;
let QUEUE_SIZE = 0;

// =========================
// Utils
// =========================

function nowIso() {
    return new Date().toISOString();
}

function elapsed(startTime) {
    return Date.now() - startTime;
}

function buildRequestId(actionName) {
    return `${actionName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeJson(data) {
    try {
        return JSON.stringify(data);
    } catch (e) {
        return '[unserializable-payload]';
    }
}

function pageDebugId(page, fallback = 'null') {
    if (!page) return fallback;
    if (!page.__debugId) {
        page.__debugId = `PAGE_${++EVENT_PAGE_SEQ}`;
    }
    return page.__debugId;
}

// =========================
// Log Utils
// =========================

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({ type: 'LOG', data: { type, msg } });
}

function log(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, message, fields);
    sendToRenderer('info', msg);
}

function logWarn(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, `⚠️ ${message}`, fields);
    sendToRenderer('warn', msg);
}

function logError(requestId, message, err) {
    const msg = formatMsg(requestId, `❌ ${message}`, { error: err?.message || err });
    sendToRenderer('error', msg);
}

function logOk(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, `✅ ${message}`, fields);
    sendToRenderer('ok', msg);
}

async function measure(requestId, label, fn) {
    const t = Date.now();
    try {
        const result = await fn();
        log(requestId, `  ✔ ${label}`, {ms: Date.now() - t});
        return result;
    } catch (err) {
        logError(requestId, `${label} failed`, err);
        throw err;
    }
}

// =========================
// Callback về Java
// =========================

async function sendCallback(callbackUrl, schedulerId, requestId, actionName, dtoType, success, data) {
    if (!callbackUrl) {
        logWarn(requestId, 'no callback_url, skip');
        return;
    }
    try {
        const body = {
            request_id: requestId,
            scheduler_id: schedulerId,
            type: dtoType,         // CRAWLS_FB | CRAWLS_TW | POST_GROUP_FB | POST_STORY | POST_TWEET | POST_PROFILE — Java dùng để phân loại
            success,
            ...data
        };

        log(requestId, `📡 CALLBACK SENDING`, {url: callbackUrl, type: dtoType, success});

        const res = await fetch(callbackUrl, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });

        log(requestId, `📡 CALLBACK SENT`, {status: res.status});
    } catch (e) {
        logError(requestId, 'CALLBACK FAILED', e);
    }
}

// =========================
// FIFO Queue
// =========================

const queue = [];
let processing = false;

function enqueue(task) {
    queue.push(task);
    processQueue().catch((err) => {
        logError('QUEUE', 'processQueue failed', err);
    });
}

async function processQueue() {
    if (processing) return;
    processing = true;
    try {
        while (queue.length > 0) {
            const task = queue.shift();
            try {
                await task();
            } catch (err) {
                logError('QUEUE', 'task failed', err);
            } finally {
                QUEUE_SIZE--;
            }
        }
    } finally {
        processing = false;
    }
}

// =========================
// enqueueRequest — trả 202 ngay, xử lý ngầm
// =========================

function enqueueRequest(req, res, actionName, TriggerClass) {
    const startTime = Date.now();
    const dto = req.body;
    const requestId = dto.id;
    const schedulerId = dto.scheduler_id;
    const requestTrace = dto.type + "_" + schedulerId;

    // Java truyền callback_url vào body hoặc header
    const callbackUrl = runtimeConfig.api.apiCallbackResponse;
    const dtoType = dto.type || actionName;

    QUEUE_SIZE++;

    const separator = '\n' + '='.repeat(80);
    sendToRenderer('info', separator);

    log(requestId, `📥 ENQUEUED`, {
        action: actionName,
        type: dtoType,
        queue: QUEUE_SIZE,
        active: ACTIVE_REQUESTS,
        pid: process.pid,
    });
    log(requestTrace, `REQ BODY`, {body: safeJson(dto)});

    // ✅ Trả về ngay — Java không bị timeout dù crawl lâu bao nhiêu
    res.status(202).json({
        success: true,
        request_id: requestId,
        action: actionName,
        type: dtoType,
        message: 'queued',
        queue_position: QUEUE_SIZE
    });

    log(requestTrace, `↩️ 202 ACCEPTED`, {callbackUrl: callbackUrl || 'none'});

    // Xử lý ngầm sau khi đã trả response
    enqueue(async () => {
        log(requestId, `🎯 DEQUEUED`, {
            action: actionName,
            queue: QUEUE_SIZE,
            active: ACTIVE_REQUESTS,
        });

        // res giả — thay HTTP response bằng callback
        const fakeRes = {
            headersSent: false,

            json(data) {
                this.headersSent = true;
                sendCallback(callbackUrl, schedulerId, requestId, actionName, dtoType, true, data)
                    .catch(() => {});
            }
        };
        try {
            await handleRequest(req, fakeRes, actionName, TriggerClass, requestId, startTime);
        } finally {
            reportError(); // 🔥 điểm quan trọng
            log(requestId, `🏁 DONE`, {
                action: actionName,
                queue: Math.max(QUEUE_SIZE - 1, 0),
                active: ACTIVE_REQUESTS,
                totalMs: elapsed(startTime),
            });
            const closingSeparator = '='.repeat(80);
            sendToRenderer('info', closingSeparator);
        }
    });
}

// =========================
// handleRequest — không đổi logic, chỉ dùng fakeRes
// =========================

async function handleRequest(req, res, actionName, TriggerClass, requestId, startTime) {
    const dto = req.body;

    let page;
    let rootPage;
    let session;
    let trigger;
    let resultFactory;
    const requestTrace = dto.type + "_" + dto.scheduler_id;

    ACTIVE_REQUESTS++;
    log(requestTrace, `🚀 REQUEST START`, {action: actionName, active: ACTIVE_REQUESTS, pid: process.pid});

    const isFacebook = ['CRAWLS_FB', 'POST_STORY', 'POST_PROFILE', 'POST_GROUP_FB'].includes(dto.type);

    try {
        session = await measure(requestTrace, 'getSession', async () => {
            return await SessionManager.getSession();
        });
        rootPage = session?.rootPage;

        await measure(requestTrace, 'set hasEvent=true', async () => {
            SessionManager.hasEvent = true;
        });

        if (SessionManager.navigator) {
            await measure(requestTrace, 'navigator.stop', async () => {
                return await SessionManager.navigator.stop();
            });
        }

        if (TriggerClass.useEventPage) {
            page = await measure(requestTrace, 'createEventPage', async () => {
                if (isFacebook) {
                    page = await FacebookContextPool.createEventPage(dto);
                } else {
                    page = await SessionManager.createEventPage();
                }
                return page;
            });
        }

        resultFactory = await measure(requestTrace, 'ContextFactory.create', async () => {
            return await ContextFactory.create(dto);
        });

        trigger = await measure(requestTrace, `new ${TriggerClass.name}`, async () => {
            return new TriggerClass(resultFactory.social);
        });

        const result = await measure(requestTrace, `${TriggerClass.name}.execute`, async () => {
            return await trigger.execute(dto, page);
        });

        logOk(requestTrace, `REQUEST SUCCESS`, {
            action: actionName,
            images: result?.images?.length ?? 0,
            totalMs: elapsed(startTime),
        });

        res.json({
            success: true,
            request_id: requestId,
            scheduler_id: dto.scheduler_id,
            value: result?.images?.length ?? 0
        });

    } catch (err) {
        logError(requestTrace, `REQUEST FAILED | action=${actionName} totalMs=${elapsed(startTime)}`, err);

        try {
            let screenshotBase64 = null;

            if (page) {
                await measure(requestTrace, 'closeEventPage[catch]', async () => {
                    if (!isFacebook) {
                        await SessionManager.closeEventPage(page);
                    } else {
                        await SessionManager.restoreRootOnly();
                    }
                });
                page = null;
            }

            await measure(requestTrace, 'sendErrorLog', async () => {
                return await sendErrorLog({
                    type: dto?.type,
                    error_message: err.message,
                    request_id: requestId,
                    action: actionName,
                    ...(screenshotBase64 && {screenshot_base64: screenshotBase64})
                });
            });

        } catch (sendErr) {
            logError(requestTrace, 'sendErrorLog failed', sendErr);
        }

        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: err.message,
                requestId
            });
        }

    } finally {
        if (page) {
            await measure(requestTrace, 'closeEventPage[finally]', async () => {
                if (!isFacebook) {
                    await SessionManager.closeEventPage(page);
                } else {
                    await SessionManager.restoreRootOnly();
                }
            });
        }

        try {
            await measure(requestTrace, 'set hasEvent=false', async () => {
                SessionManager.hasEvent = false;
            });
        } catch (err) {
            logError(requestTrace, 'set hasEvent=false failed', err);
        }

        if (SessionManager.navigator) {
            const nextActive = ACTIVE_REQUESTS - 1;
            if (nextActive === 0 && queue.length === 0) {
                setTimeout(() => {
                    SessionManager.navigator.start().catch(() => {});
                }, 0);
            }
        }

        ACTIVE_REQUESTS--;
        log(requestTrace, `🔚 REQUEST END`, {
            action: actionName,
            active: ACTIVE_REQUESTS,
            totalMs: elapsed(startTime),
        });
    }
}

// =========================
// sendErrorLog
// =========================

async function sendErrorLog(payload) {
    try {
        logError('SEND_ERROR_LOG', `sending`, { payload: safeJson(payload), api: runtimeConfig.api.apiLogError });
        await fetch(`${runtimeConfig.api.apiLogError}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
    } catch (e) {
        logError('SEND_ERROR_LOG', 'cannot send log to API', e);
        throw e;
    }
}

// =========================
// Routes
// =========================

router.post('/trigger-fb-crawl', (req, res) =>
    enqueueRequest(req, res, 'FB_CRAWL', FbCrawlTrigger)
);

router.post('/trigger-tw-crawl', (req, res) =>
    enqueueRequest(req, res, 'TW_CRAWL', TwCrawlTrigger)
);

router.post('/post_group', (req, res) =>
    enqueueRequest(req, res, 'POST_GROUP', PostGroupTrigger)
);

router.post('/post-story', (req, res) =>
    enqueueRequest(req, res, 'POST_STORY', PostStoryTrigger)
);

router.post('/post_tweet', (req, res) =>
    enqueueRequest(req, res, 'POST_TWEET', PostTweetTrigger)
);

router.post('/post-profile', (req, res) =>
    enqueueRequest(req, res, 'POST_PROFILE', PostProfileTrigger)
);

router.post('/bot/sleep', async (req, res) => {
    const requestId = buildRequestId('BOT_SLEEP');
    const startTime = Date.now();
    try {
        log(requestId, 'BOT SLEEP START');
        await SessionManager.sleep();
        logOk(requestId, 'BOT SLEEP DONE', {ms: elapsed(startTime)});
        res.json({status: 'sleeping', requestId});
    } catch (err) {
        logError(requestId, 'BOT SLEEP FAILED', err);
        res.status(500).json({status: 'error', error: err.message, requestId});
    }
});

router.post('/bot/wakeup', async (req, res) => {
    const requestId = buildRequestId('BOT_WAKEUP');
    const startTime = Date.now();
    try {
        log(requestId, 'BOT WAKEUP START');
        await SessionManager.wakeup();
        logOk(requestId, 'BOT WAKEUP DONE', {ms: elapsed(startTime)});
        res.json({status: 'running', requestId});
    } catch (err) {
        logError(requestId, 'BOT WAKEUP FAILED', err);
        res.status(500).json({status: 'error', error: err.message, requestId});
    }
});

router.post('/bot/force-logout', async (req, res) => {
    const requestId = buildRequestId('FORCE_LOGOUT');
    const startTime = Date.now();
    try {
        log(requestId, 'FORCE LOGOUT START');
        await SessionManager.forceLogout('manual_trigger');
        logOk(requestId, 'FORCE LOGOUT DONE', {ms: elapsed(startTime)});
        res.json({success: true, requestId});
    } catch (err) {
        logError(requestId, 'FORCE LOGOUT FAILED', err);
        res.status(500).json({success: false, error: err.message, requestId});
    }
});

export default router;