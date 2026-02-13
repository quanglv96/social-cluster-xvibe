import express from 'express';
import { ContextFactory } from '../core/browser/ContextFactory.js';
import { CrawlTrigger } from '../triggers/CrawlTrigger.js';
import { PostGroupTrigger } from '../triggers/PostGroupTrigger.js';
import { PostTweetTrigger } from '../triggers/PostTweetTrigger.js';

const router = express.Router();

function logStart(requestId, action, dto) {
    console.log(`\n[${requestId}] =============================`);
    console.log(`[${requestId}] 🚀 START ${action}`);
    console.log(`[${requestId}] Type: ${dto.type}`);
    console.log(`[${requestId}] Time: ${new Date().toISOString()}`);
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
   CRAWL
================================ */
router.post('/trigger-crawl', async (req, res) => {

    const dto = req.body;
    const requestId = dto.id || `REQ_${Date.now()}`;
    const startTime = Date.now();

    let context;

    logStart(requestId, 'CRAWL', dto);

    try {

        console.log(`[${requestId}] 🌐 Creating browser context...`);
        const resultFactory = await ContextFactory.create(dto);
        context = resultFactory.context;

        console.log(`[${requestId}] ✅ Context created`);

        const trigger = new CrawlTrigger(resultFactory.social);

        console.log(`[${requestId}] 🔍 Executing CrawlTrigger...`);
        const result = await trigger.execute(dto);

        res.json({ success: true, ...result });

        logEnd(requestId, Date.now() - startTime);

    } catch (err) {

        logError(requestId, err, Date.now() - startTime);
        res.status(500).json({ success: false, error: err.message });

    } finally {

        if (context) {
            console.log(`[${requestId}] 🔒 Closing browser context`);
            await context.close();
        }
    }
});


/* ===============================
   POST GROUP
================================ */
router.post('/post_group', async (req, res) => {

    const dto = req.body;
    const requestId = dto.id || `REQ_${Date.now()}`;
    const startTime = Date.now();

    let context;

    logStart(requestId, 'POST_GROUP', dto);

    try {

        console.log(`[${requestId}] 🌐 Creating browser context...`);
        const resultFactory = await ContextFactory.create(dto);
        context = resultFactory.context;

        console.log(`[${requestId}] ✅ Context created`);

        const trigger = new PostGroupTrigger(resultFactory.social);

        console.log(`[${requestId}] 📤 Executing PostGroupTrigger...`);
        await trigger.execute(dto);

        res.json({ success: true });

        logEnd(requestId, Date.now() - startTime);

    } catch (err) {

        logError(requestId, err, Date.now() - startTime);
        res.status(500).json({ success: false, error: err.message });

    } finally {

        if (context) {
            console.log(`[${requestId}] 🔒 Closing browser context`);
            await context.close();
        }
    }
});


/* ===============================
   POST TWEET
================================ */
router.post('/post_tweet', async (req, res) => {

    const dto = req.body;
    const requestId = dto.id || `REQ_${Date.now()}`;
    const startTime = Date.now();

    let context;

    logStart(requestId, 'POST_TWEET', dto);

    try {

        console.log(`[${requestId}] 🌐 Creating Twitter context...`);

        const resultFactory = await ContextFactory.create({
            ...dto,
            type: dto.type
        });

        context = resultFactory.context;

        console.log(`[${requestId}] ✅ Context created`);

        const trigger = new PostTweetTrigger(resultFactory.social);

        console.log(`[${requestId}] 🐦 Executing PostTweetTrigger...`);
        await trigger.execute(dto);

        res.json({ success: true });

        logEnd(requestId, Date.now() - startTime);

    } catch (err) {

        logError(requestId, err, Date.now() - startTime);
        res.status(500).json({ success: false, error: err.message });

    } finally {

        if (context) {
            console.log(`[${requestId}] 🔒 Closing browser context`);
            await context.close();
        }
    }
});

export default router;
