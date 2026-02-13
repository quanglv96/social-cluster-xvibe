import express from 'express';
import triggerRoutes from './routes/trigger.routes.js';

const app = express();
app.use(express.json());
app.use(triggerRoutes);

const PORT = process.env.CRAWLER_PORT || 3001;

app.listen(PORT, () => {
    console.log(`🚀 Server running at ${PORT}`);
});
