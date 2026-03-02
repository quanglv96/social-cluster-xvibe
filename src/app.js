import express from 'express';
import triggerRoutes from './routes/trigger.routes.js';
import { BrowserManager } from './core/browser/BrowserManager.js';

const app = express();
const PORT = process.env.PORT || 3001;

let isShuttingDown = false;

// =========================
// Middleware
// =========================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// =========================
// Routes
// =========================
app.use('', triggerRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route not found'
    });
});

// Express error handler
app.use((err, req, res, next) => {
    console.error('💥 Express Error:', err);
    res.status(500).json({
        success: false,
        error: err.message,
        stack: process.env.NODE_ENV === 'development'
            ? err.stack
            : undefined
    });
});

// =========================
// Start server
// =========================
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running at ${PORT}`);
});

// =========================
// Graceful Shutdown Logic
// =========================

async function shutdown(reason, error = null) {

    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n👋 Shutting down (${reason})`);

    if (error) {
        console.error(error);
    }

    try {
        await BrowserManager.closeAll();
        console.log('🧹 Browser closed');
    } catch (err) {
        console.error('Error closing browser:', err);
    }

    server.close(() => {
        console.log('✅ Server closed');
        process.exit(error ? 1 : 0);
    });
}

// =========================
// Process-level handlers
// =========================

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT (Ctrl+C)'));

process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception');
    shutdown('uncaughtException', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('💥 Unhandled Rejection');
    shutdown('unhandledRejection', reason);
});