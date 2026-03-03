import express from 'express';
import { SessionManager } from '../core/session/SessionManager.js';
import { CrawlTrigger } from '../triggers/CrawlTrigger.js';
import { PostGroupTrigger } from '../triggers/PostGroupTrigger.js';
import { PostTweetTrigger } from '../triggers/PostTweetTrigger.js';
import { ContextFactory } from '../core/browser/ContextFactory.js';
import {PostStoryTrigger} from "../triggers/PostStoryTrigger.js";

const router = express.Router();

function logStart(requestId, action, dto) {
    console.log(`\n[${requestId}] =============================`);
    console.log(`[${requestId}] 🚀 START ${action}`);
    console.log(`[${requestId}] Type: ${dto.type}`);
}

function logEnd(requestId, duration) {
    console.log(`[${requestId}] ✅ DONE - ${duration}ms`);
    console.log(`[${requestId}] =============================\n`);
}

function logError(requestId, err, duration) {
    console.error(`[${requestId}] ❌ ERROR: ${err.message}`);
    console.error(`[${requestId}] ⏱ Failed after ${duration}ms`);
    console.log(`[${requestId}] =============================\n`);
}

/* ===============================
   COMMON HANDLER TEMPLATE
================================ */
async function handleRequest(req, res, actionName, TriggerClass) {

    const dto = req.body;
    const requestId = `REQ_${Date.now()}`;
    const startTime = Date.now();

    logStart(requestId, actionName, dto);

    let page;
    let rootPage;

    try {

        // Always ensure session
        const session = await SessionManager.getSession();
        rootPage = session.rootPage;

        // 🔴 STOP root auto nếu đang chạy
        SessionManager.hasEvent = true;

        if (SessionManager.navigator) {
            SessionManager.navigator.stop();
        }
        // Nếu trigger yêu cầu event page
        if (TriggerClass.useEventPage) {
            page = await SessionManager.createEventPage();
        }

        const resultFactory = await ContextFactory.create(dto);

        const trigger = new TriggerClass(resultFactory.social);

        // Truyền page nếu có, không thì truyền root
        await trigger.execute(dto, page || rootPage);

        res.json({ success: true });

        logEnd(requestId, Date.now() - startTime);

    } catch (err) {

        logError(requestId, err, Date.now() - startTime);
        res.status(500).json({ success: false, error: err.message });

    } finally {

        if (page) {
            await SessionManager.closeEventPage(page);
        }
        // 🔥 Sau khi event xong → cho root chạy lại
        SessionManager.hasEvent = false;
    }
}

/* ===============================
   ROUTES
================================ */

router.post('/trigger-crawl', (req, res) =>
    handleRequest(req, res, 'CRAWL', CrawlTrigger)
);

router.post('/post_group', (req, res) =>
    handleRequest(req, res, 'POST_GROUP', PostGroupTrigger)
);
router.post('/post-story', (req, res) =>
    handleRequest(req, res, 'POST_STORY', PostStoryTrigger)
);

router.post('/post_tweet', (req, res) =>
    handleRequest(req, res, 'POST_TWEET', PostTweetTrigger)
);
router.post('/', (req, res) =>
    handleRequest(req, res, 'POST_TWEET', PostTweetTrigger)
);
router.post('/bot/sleep', async (req, res) => {
    await SessionManager.sleep();
    res.json({ status: 'sleeping' });
});

router.post('/bot/wakeup', async (req, res) => {
    await SessionManager.wakeup();
    res.json({ status: 'running' });
});
export default router;