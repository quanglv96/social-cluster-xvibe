import express from 'express';
import triggerRoutes from './routes/trigger.routes.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ✅ THÊM: Global error handlers
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
    console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection:', reason);
    console.error('Promise:', promise);
});

// Routes
app.use('', triggerRoutes);

// ✅ THÊM: Express error handler
app.use((err, req, res, next) => {
    console.error('💥 Express Error:', err);
    res.status(500).json({
        success: false,
        error: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running at ${PORT}`);
    console.log(`📍 Endpoints:`);
    console.log(`   POST http://localhost:${PORT}/post_tweet`);
    console.log(`   POST http://localhost:${PORT}/post_group`);
    console.log(`   POST http://localhost:${PORT}/trigger-crawl`);
});

// ✅ THÊM: Server error handler
server.on('error', (err) => {
    console.error('💥 Server Error:', err);
});

// ✅ THÊM: Graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
