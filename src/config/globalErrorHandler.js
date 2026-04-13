function nowIso() {
    return new Date().toISOString();
}

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');

    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({ type: 'LOG', data: { type, msg } });
}

function logError(requestId, message, err) {
    const msg = formatMsg(requestId, `❌ ${message}`, {
        error: err?.message || err
    });
    sendToRenderer('error', msg);
}

// =========================
// GLOBAL HANDLER
// =========================

export function setupGlobalErrorHandler() {

    const TAG = 'GLOBAL';

    // 1. Uncaught Exception (sync error)
    process.on('uncaughtException', (err) => {
        const requestId = `${TAG}_UNCAUGHT_${Date.now()}`;

        logError(requestId, 'Uncaught Exception', err);

        // ⚠️ Tuỳ bạn: có thể exit hoặc không
        // process.exit(1);
    });

    // 2. Unhandled Promise Rejection (async error)
    process.on('unhandledRejection', (reason) => {
        const requestId = `${TAG}_REJECTION_${Date.now()}`;

        logError(requestId, 'Unhandled Rejection', reason);
    });

    // 3. Warning (optional nhưng rất hữu ích)
    process.on('warning', (warning) => {
        const requestId = `${TAG}_WARNING_${Date.now()}`;

        const msg = formatMsg(requestId, `⚠️ Node Warning`, {
            name: warning.name,
            message: warning.message
        });

        sendToRenderer('warn', msg);
    });
}