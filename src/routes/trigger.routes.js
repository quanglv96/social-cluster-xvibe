import express from 'express';
import { SessionManager } from '../core/session/SessionManager.js';
import { CrawlTrigger } from '../triggers/CrawlTrigger.js';
import { PostGroupTrigger } from '../triggers/PostGroupTrigger.js';
import { PostTweetTrigger } from '../triggers/PostTweetTrigger.js';
import { ContextFactory } from '../core/browser/ContextFactory.js';

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
    const requestId = dto.id || `REQ_${Date.now()}`;
    const startTime = Date.now();

    logStart(requestId, actionName, dto);

    let page;

    try {

        // ✅ Get long-lived session
        await SessionManager.getSession();

        // ✅ Create event page
        page = await SessionManager.createEventPage();

        // ✅ Create social via factory (KHÔNG lấy context nữa)
        const resultFactory = await ContextFactory.create(dto);

        const trigger = new TriggerClass(resultFactory.social);

        await trigger.execute(dto, page);

        res.json({ success: true });

        logEnd(requestId, Date.now() - startTime);

    } catch (err) {

        logError(requestId, err, Date.now() - startTime);
        res.status(500).json({ success: false, error: err.message });

    } finally {

        if (page) {
            await SessionManager.closeEventPage(page);
        }
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

router.post('/post_tweet', (req, res) =>
    handleRequest(req, res, 'POST_TWEET', PostTweetTrigger)
);

export default router;