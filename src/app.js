import express from 'express';
import http from 'http';
import triggerRoutes from './routes/trigger.routes.js';
import {BrowserManager} from './core/browser/BrowserManager.js';
import {AppRegistryService} from "./AppRegistryService.js";
import {TunnelService} from "./TunnelService.js";

const app = express();
const PORT = process.env.PORT || 3001;

const MAX_ACTIVE_REQUESTS = Number(process.env.MAX_ACTIVE_REQUESTS || 20);
const RECOVERY_WAIT_TIMEOUT_MS = Number(process.env.RECOVERY_WAIT_TIMEOUT_MS || 10000);

let isRecovering = false;
let isHealthy = false;
let activeRequests = 0;
let recoveryPromise = null;

// =========================
// Utils
// =========================
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function safeToError(value) {
    if (value instanceof Error) return value;
    try {
        return new Error(typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
        return new Error(String(value));
    }
}

async function waitForActiveRequestsToDrain(timeoutMs = RECOVERY_WAIT_TIMEOUT_MS) {
    const start = Date.now();
    while (activeRequests > 0) {
        if (Date.now() - start >= timeoutMs) {
            console.warn(`⚠️ Timeout waiting active requests drain. Remaining=${activeRequests}`);
            return false;
        }
        await sleep(200);
    }
    return true;
}

// =========================
// Recovery
// =========================
async function recoverSystem(reason, error = null) {
    if (recoveryPromise) {
        console.warn(`⚠️ Recovery already in progress (${reason})`);
        return recoveryPromise;
    }

    recoveryPromise = (async () => {
        isRecovering = true;
        isHealthy = false;
        console.log(`🔄 Start recovery: ${reason}`);
        if (error) console.error('Recovery cause:', error);

        try {
            await waitForActiveRequestsToDrain();

            if (typeof BrowserManager.reset === 'function') {
                await BrowserManager.reset();
            } else {
                await BrowserManager.closeAll();
                if (typeof BrowserManager.init === 'function') {
                    await BrowserManager.init();
                }
            }

            isHealthy = true;
            console.log('✅ Recovery completed');
        } catch (err) {
            console.error('❌ Recovery failed:', err);
            isHealthy = false;
        } finally {
            isRecovering = false;
            recoveryPromise = null;
        }
    })();

    return recoveryPromise;
}

// =========================
// Middleware
// =========================
app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({extended: true, limit: '50mb'}));

app.use((req, res, next) => {
    if (!isHealthy || isRecovering) {
        return res.status(503).json({
            success: false,
            error: 'Server is recovering, please try again later'
        });
    }

    if (activeRequests >= MAX_ACTIVE_REQUESTS) {
        console.warn(`⚠️ Overload detected. activeRequests=${activeRequests}/${MAX_ACTIVE_REQUESTS}`);
        recoverSystem('overload').catch(err => console.error('Recovery trigger error:', err));
        return res.status(503).json({
            success: false,
            error: 'Server overloaded, recovery triggered'
        });
    }

    activeRequests++;

    let released = false;
    const release = () => {
        if (!released) {
            released = true;
            activeRequests = Math.max(0, activeRequests - 1);
        }
    };

    res.on('finish', release);
    res.on('close', release);

    next();
});

// =========================
// Routes
// =========================
app.use('', triggerRoutes);

app.use((req, res) => {
    res.status(404).json({success: false, error: 'Route not found'});
});

app.use((err, req, res, next) => {
    console.error('💥 Express Error:', err);

    if (!res.headersSent) {
        res.status(500).json({
            success: false,
            error: err.message || 'Internal server error',
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }

    const message = (err?.message || '').toLowerCase();
    const shouldRecover =
        message.includes('target closed') ||
        message.includes('browser has been closed') ||
        message.includes('context closed') ||
        message.includes('page crashed') ||
        message.includes('protocol error');

    if (shouldRecover) {
        recoverSystem(`express error: ${err.message}`, err).catch(console.error);
    }
});

// =========================
// Server
// =========================
const server = http.createServer(app);

server.keepAliveTimeout = 5000;
server.headersTimeout = 10000;

async function registerWithRetry(publicUrl) {
    let attempt = 0;
    try {
        return await AppRegistryService.register(publicUrl);
    } catch (err) {
        attempt++;
        console.error(`❌ Register failed (attempt ${attempt}):`, err.message);
    }
}

async function bootstrap() {
    console.log(`🚀 Starting server at ${PORT}`);

    try {
        // 1. init browser
        if (typeof BrowserManager.init === 'function') {
            await BrowserManager.init();
        }
        console.log('✨ BrowserManager initialized');

        // 2. server listen trước
        await new Promise((resolve, reject) => {
            server.listen(PORT, (err) => {
                if (err) return reject(err);
                console.log(`✅ Server listening at ${PORT}`);
                resolve();
            });
        });

        // 3. mở tunnel sau khi port đã listen
        const publicUrl = await TunnelService.start(PORT);

        // 4. register
        await registerWithRetry(publicUrl);

        isHealthy = true;
        console.log('🎉 Bootstrap complete');

    } catch (err) {
        console.error('❌ Bootstrap failed:', err);
        process.exit(1);
    }
}


// =========================
// Process handlers
// =========================

let isExiting = false;

async function gracefulExit(signal) {
    console.log("gracefulExit");
    // ✅ chống gọi nhiều lần (Ctrl+C liên tiếp)
    if (isExiting) return;
    isExiting = true;

    console.log(`\n👋 Received ${signal} — shutting down...`);

    isRecovering = true;
    isHealthy = false;

    // ✅ force exit sau 5s phòng trường hợp cleanup bị treo
    const forceTimer = setTimeout(() => {
        console.warn('⚠️ Force exit after 5s timeout');
        process.exit(1);
    }, 5000);
    forceTimer.unref(); // không giữ process sống chỉ vì timer này

    try {
        // ✅ dừng tunnel — quan trọng, nếu thiếu SSH process còn sống
        await TunnelService.stop();

        // dừng browser
        await BrowserManager.closeAll();

    } catch (err) {
        console.error(`Error on ${signal} cleanup:`, err);
    }

    // đóng HTTP server, không nhận request mới
    server.close(() => {
        clearTimeout(forceTimer);
        console.log('✅ Server closed — bye!');
        process.exit(0);
    });
}

process.on('SIGINT',  () => gracefulExit('SIGINT'));   // Ctrl+C
process.on('SIGTERM', () => gracefulExit('SIGTERM'));  // docker stop / kill

process.on('unhandledRejection', (reason) => {
    const error = safeToError(reason);
    console.error('💥 Unhandled Rejection:', error);
    recoverSystem('unhandledRejection', error).catch(console.error);
});

process.on('uncaughtException', async (err) => {
    console.error('💥 Uncaught Exception:', err);
    await gracefulExit('uncaughtException');
});


bootstrap();