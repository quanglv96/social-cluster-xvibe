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
let isHealthy = false; // ❗ chưa healthy cho đến khi bootstrap xong
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
        if (error) {
            console.error('Recovery cause:', error);
        }

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

        recoverSystem('overload').catch(err => {
            console.error('Recovery trigger error:', err);
        });

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
    res.status(404).json({
        success: false,
        error: 'Route not found'
    });
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

        // 2. start ngrok
        const publicUrl = await TunnelService.start(PORT);

        // 3. register
        await registerWithRetry(publicUrl);

        isHealthy = true;

        server.listen(PORT, () => {
            console.log(`✅ Server ready at ${PORT}`);
        });

    } catch (err) {
        console.error('❌ Bootstrap failed:', err);
        process.exit(1);
    }
}

bootstrap(); // ✅ chỉ gọi 1 lần

server.keepAliveTimeout = 5000;
server.headersTimeout = 10000;

// =========================
// Process handlers
// =========================
async function gracefulExit(signal) {
    console.log(`👋 Received ${signal}`);

    try {
        isRecovering = true;
        isHealthy = false;
        await BrowserManager.closeAll();
    } catch (err) {
        console.error(`Error on ${signal} cleanup:`, err);
    } finally {
        server.close(() => {
            console.log('✅ Server closed');
            process.exit(0);
        });
    }
}

process.on('SIGTERM', () => gracefulExit('SIGTERM'));
process.on('SIGINT', () => gracefulExit('SIGINT'));

process.on('unhandledRejection', (reason) => {
    const error = safeToError(reason);
    console.error('💥 Unhandled Rejection:', error);

    recoverSystem('unhandledRejection', error).catch(console.error);
});

process.on('uncaughtException', async (err) => {
    console.error('💥 Uncaught Exception:', err);
    await gracefulExit('uncaughtException');
});