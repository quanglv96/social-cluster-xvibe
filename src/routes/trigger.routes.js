import express from 'express';
import {SessionManager} from '../core/session/SessionManager.js';
import {FbCrawlTrigger} from '../triggers/FbCrawlTrigger.js';
import {PostGroupTrigger} from '../triggers/PostGroupTrigger.js';
import {PostTweetTrigger} from '../triggers/PostTweetTrigger.js';
import {ContextFactory} from '../core/browser/ContextFactory.js';
import {PostStoryTrigger} from "../triggers/PostStoryTrigger.js";
import {config} from "../config/config.js";
import {PostProfileTrigger} from "../triggers/PostProfileTrigger.js";
import {TwCrawlTrigger} from "../triggers/TwCrawlTrigger.js";

const router = express.Router();

let ACTIVE_REQUESTS = 0;
let EVENT_PAGE_SEQ = 0;
let QUEUE_SIZE = 0;

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

function trace(requestId, startTime, step, extra = '') {
    const prefix = `[${nowIso()}] [${requestId}] [${elapsed(startTime)}ms] ${step}`;
    if (extra) {
        console.log(`${prefix} | ${extra}`);
    } else {
        console.log(prefix);
    }
}

function traceError(requestId, startTime, step, err) {
    console.error(
        `[${nowIso()}] [${requestId}] [${elapsed(startTime)}ms] ${step} | ERROR=${err?.message || err}`
    );
    if (err?.stack) {
        console.error(`[${nowIso()}] [${requestId}] STACK:\n${err.stack}`);
    }
}

async function measure(requestId, startTime, label, fn) {
    const stepStart = Date.now();
    trace(requestId, startTime, `▶ START ${label}`);
    try {
        const result = await fn();
        trace(
            requestId,
            startTime,
            `✅ END ${label}`,
            `stepDuration=${Date.now() - stepStart}ms`
        );
        return result;
    } catch (err) {
        traceError(
            requestId,
            startTime,
            `❌ FAIL ${label} stepDuration=${Date.now() - stepStart}ms`,
            err
        );
        throw err;
    }
}

/* ===============================
   SIMPLE FIFO QUEUE
================================ */

const queue = [];
let processing = false;

function enqueue(task) {
    queue.push(task);
    processQueue().catch((err) => {
        console.error(`[${nowIso()}] [QUEUE] processQueue failed: ${err?.message || err}`);
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
                console.error(`[${nowIso()}] [QUEUE] task failed: ${err?.message || err}`);
            } finally {
                QUEUE_SIZE--;
            }
        }
    } finally {
        processing = false;
    }
}

function enqueueRequest(req, res, actionName, TriggerClass) {
    const requestId = buildRequestId(actionName);
    const startTime = Date.now();
    const dto = req.body;

    QUEUE_SIZE++;

    console.log(`\n================================================================================`);
    trace(
        requestId,
        startTime,
        '📥 REQUEST ENQUEUED',
        `action=${actionName} queueSize=${QUEUE_SIZE} activeRequests=${ACTIVE_REQUESTS} pid=${process.pid}`
    );
    trace(requestId, startTime, 'REQ BODY', safeJson(dto));

    enqueue(async () => {
        trace(
            requestId,
            startTime,
            '🎯 REQUEST DEQUEUED',
            `action=${actionName} queueSize=${QUEUE_SIZE} activeRequests=${ACTIVE_REQUESTS}`
        );

        try {
            await handleRequest(req, res, actionName, TriggerClass, requestId, startTime);
        } finally {
            trace(
                requestId,
                startTime,
                '📤 REQUEST REMOVED FROM QUEUE',
                `action=${actionName} queueSize=${Math.max(QUEUE_SIZE - 1, 0)} activeRequests=${ACTIVE_REQUESTS}`
            );
            console.log(`================================================================================\n`);
        }
    });
}

/* ===============================
   COMMON HANDLER TEMPLATE
================================ */

async function handleRequest(req, res, actionName, TriggerClass, requestId, startTime) {
    const dto = req.body;

    let page;
    let rootPage;
    let session;
    let trigger;
    let resultFactory;

    ACTIVE_REQUESTS++;
    trace(
        requestId,
        startTime,
        `🚀 REQUEST START`,
        `action=${actionName} activeRequests=${ACTIVE_REQUESTS} pid=${process.pid}`
    );

    try {
        trace(
            requestId,
            startTime,
            `CHECK PRE STATE`,
            `hasEvent=${SessionManager.hasEvent} navigatorExists=${!!SessionManager.navigator}`
        );

        session = await measure(requestId, startTime, 'SessionManager.getSession()', async () => {
            return await SessionManager.getSession();
        });

        rootPage = session?.rootPage;

        trace(
            requestId,
            startTime,
            `SESSION READY`,
            `rootPage=${pageDebugId(rootPage, 'ROOT_NULL')}`
        );

        await measure(requestId, startTime, 'Set SessionManager.hasEvent = true', async () => {
            SessionManager.hasEvent = true;
        });

        trace(
            requestId,
            startTime,
            `SESSION FLAG UPDATED`,
            `hasEvent=${SessionManager.hasEvent}`
        );

        if (SessionManager.navigator) {
            await measure(requestId, startTime, 'SessionManager.navigator.stop()', async () => {
                return await SessionManager.navigator.stop();
            });
        } else {
            trace(requestId, startTime, `SKIP navigator.stop()`, `navigator is null`);
        }

        if (TriggerClass.useEventPage) {
            page = await measure(requestId, startTime, 'SessionManager.createEventPage()', async () => {
                return await SessionManager.createEventPage();
            });

            trace(
                requestId,
                startTime,
                `EVENT PAGE CREATED`,
                `eventPage=${pageDebugId(page)}`
            );
        } else {
            trace(requestId, startTime, `SKIP createEventPage()`, `useEventPage=false`);
        }

        resultFactory = await measure(requestId, startTime, 'ContextFactory.create(dto)', async () => {
            return await ContextFactory.create(dto);
        });

        trace(
            requestId,
            startTime,
            `CONTEXT FACTORY READY`,
            `social=${resultFactory?.social?.constructor?.name || 'unknown'}`
        );

        trigger = await measure(requestId, startTime, `new ${TriggerClass.name}(social)`, async () => {
            return new TriggerClass(resultFactory.social);
        });

        trace(
            requestId,
            startTime,
            `TRIGGER READY`,
            `trigger=${TriggerClass.name} executePage=${pageDebugId(page || rootPage, 'NO_PAGE')}`
        );

        const result = await measure(requestId, startTime, `${TriggerClass.name}.execute(dto, page)`, async () => {
            return await trigger.execute(dto, page || rootPage);
        });

        trace(
            requestId,
            startTime,
            `TRIGGER EXECUTED SUCCESS`,
            `pageUsed=${pageDebugId(page || rootPage, 'NO_PAGE')}`
        );

        res.json({success: true, request_id: requestId, value: result?.images?.length ?? 0});

        trace(
            requestId,
            startTime,
            `HTTP RESPONSE SENT`,
            `status=200`
        );

    } catch (err) {
        traceError(requestId, startTime, 'HANDLE REQUEST FAILED', err);

        try {
            await measure(requestId, startTime, 'sendErrorLog(payload)', async () => {
                return await sendErrorLog({
                    type: dto?.type,
                    error_message: err.message,
                    request_id: requestId,
                    action: actionName
                });
            });
        } catch (sendErr) {
            traceError(requestId, startTime, 'sendErrorLog FAILED', sendErr);
        }

        if (page) {
            try {
                const closePageId = pageDebugId(page);
                await measure(requestId, startTime, 'SessionManager.closeEventPage(page) in catch', async () => {
                    return await SessionManager.closeEventPage(page);
                });
                trace(
                    requestId,
                    startTime,
                    `EVENT PAGE CLOSED IN CATCH`,
                    `eventPage=${closePageId}`
                );
                page = null;
            } catch (closeErr) {
                traceError(requestId, startTime, 'Cannot close event page in catch', closeErr);
            }
        } else {
            trace(requestId, startTime, `SKIP closeEventPage in catch`, `page is null`);
        }

        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: err.message,
                requestId
            });

            trace(
                requestId,
                startTime,
                `HTTP RESPONSE SENT`,
                `status=500`
            );
        }
    } finally {
        trace(
            requestId,
            startTime,
            `ENTER FINALLY`,
            `page=${pageDebugId(page, 'NULL')} hasEvent(before)=${SessionManager.hasEvent}`
        );

        if (page) {
            try {
                const closePageId = pageDebugId(page);
                await measure(requestId, startTime, 'SessionManager.closeEventPage(page) in finally', async () => {
                    return await SessionManager.closeEventPage(page);
                });
                trace(
                    requestId,
                    startTime,
                    `EVENT PAGE CLOSED IN FINALLY`,
                    `eventPage=${closePageId}`
                );
            } catch (closeErr) {
                traceError(requestId, startTime, 'Cannot close event page in finally', closeErr);
            }
        } else {
            trace(requestId, startTime, `SKIP closeEventPage in finally`, `page is null`);
        }

        try {
            await measure(requestId, startTime, 'Set SessionManager.hasEvent = false', async () => {
                SessionManager.hasEvent = false;
            });

            trace(
                requestId,
                startTime,
                `SESSION FLAG RESET`,
                `hasEvent=${SessionManager.hasEvent}`
            );
        } catch (err) {
            traceError(requestId, startTime, 'Set hasEvent=false FAILED', err);
        }

        if (SessionManager.navigator) {

            trace(
                requestId,
                startTime,
                'TRY START navigator (idle mode)',
                `activeRequests=${ACTIVE_REQUESTS} queueSize=${queue.length}`
            );
            const nextActive = ACTIVE_REQUESTS - 1;

            if (nextActive === 0 && queue.length === 0) {
                trace(
                    requestId,
                    startTime,
                    'START navigator in background',
                    `non-blocking`
                );
                setTimeout(() => {
                    const navStart = Date.now();
                    SessionManager.navigator.start()
                        .then(() => {
                            console.log(
                                `[${nowIso()}] [NAVIGATOR] start finished request=${requestId} duration=${Date.now() - navStart}ms`
                            );
                        })
                        .catch(err => {
                            console.error(
                                `[${nowIso()}] [NAVIGATOR] start failed: ${err.message}`
                            );
                        });
                }, 0);
            } else {
                trace(
                    requestId,
                    startTime,
                    'SKIP navigator.start()',
                    `system not idle activeRequests=${ACTIVE_REQUESTS} queueSize=${queue.length}`
                );
            }
        } else {
            trace(requestId, startTime, `SKIP navigator.start()`, `navigator is null`);
        }

        ACTIVE_REQUESTS--;
        trace(
            requestId,
            startTime,
            `🏁 REQUEST END`,
            `action=${actionName} total=${elapsed(startTime)}ms activeRequests=${ACTIVE_REQUESTS}`
        );
    }
}

async function sendErrorLog(payload) {
    try {
        console.error(`[${nowIso()}] [SEND_ERROR_LOG] payload=${safeJson(payload)}`);
        console.error(`[${nowIso()}] [SEND_ERROR_LOG] api=${config.apiLogError}`);
        await fetch(`${config.apiLogError}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.error(`[${nowIso()}] [SEND_ERROR_LOG] ❌ Cannot send log to API: ${e.message}`);
        throw e;
    }
}

/* ===============================
   ROUTES
================================ */

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
        trace(requestId, startTime, 'BOT SLEEP START');
        await SessionManager.sleep();
        trace(requestId, startTime, 'BOT SLEEP DONE');
        res.json({status: 'sleeping', requestId});
    } catch (err) {
        traceError(requestId, startTime, 'BOT SLEEP FAILED', err);
        res.status(500).json({status: 'error', error: err.message, requestId});
    }
});

router.post('/bot/wakeup', async (req, res) => {
    const requestId = buildRequestId('BOT_WAKEUP');
    const startTime = Date.now();
    try {
        trace(requestId, startTime, 'BOT WAKEUP START');
        await SessionManager.wakeup();
        trace(requestId, startTime, 'BOT WAKEUP DONE');
        res.json({status: 'running', requestId});
    } catch (err) {
        traceError(requestId, startTime, 'BOT WAKEUP FAILED', err);
        res.status(500).json({status: 'error', error: err.message, requestId});
    }
});
router.post('/bot/force-logout', async (req, res) => {
    const requestId = buildRequestId('FORCE_LOGOUT');
    const startTime = Date.now();

    try {
        trace(requestId, startTime, 'FORCE LOGOUT START');

        await SessionManager.forceLogout('manual_trigger');

        trace(requestId, startTime, 'FORCE LOGOUT DONE');

        res.json({
            success: true,
            requestId
        });
    } catch (err) {
        traceError(requestId, startTime, 'FORCE LOGOUT FAILED', err);

        res.status(500).json({
            success: false,
            error: err.message,
            requestId
        });
    }
});
export default router;