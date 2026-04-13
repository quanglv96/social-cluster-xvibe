// =========================
// Log Utils
// =========================

function nowIso() {
    return new Date().toISOString();
}

function formatMsg(requestId, message, fields = {}) {
    const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    return `[${nowIso()}] [${requestId}] ${message}${fieldStr ? ' | ' + fieldStr : ''}`;
}

function sendToRenderer(type, msg) {
    process.send?.({ type: 'LOG', data: { type, msg } });
}

function log(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, message, fields);
    sendToRenderer('info', msg);
}

function logWarn(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, `⚠️ ${message}`, fields);
    sendToRenderer('warn', msg);
}

function logError(requestId, message, err) {
    const msg = formatMsg(requestId, `❌ ${message}`, {
        error: err?.message || err
    });
    sendToRenderer('error', msg);
}

function logOk(requestId, message, fields = {}) {
    const msg = formatMsg(requestId, `✅ ${message}`, fields);
    sendToRenderer('ok', msg);
}

// =========================
// Class
// =========================

const TAG = 'DELAY';

export class DelayService {

    constructor(options = {}) {

        this.requestId = `${TAG}_${Date.now()}`;

        this.config = {
            actionMin: 800,
            actionMax: 2500,

            navigationMin: 3000,
            navigationMax: 8000,

            uploadMin: 4000,
            uploadMax: 9000,

            betweenGroupMin: 4000,
            betweenGroupMax: 9000,

            scrollProbability: 0.35,

            scrollStepMin: 80,
            scrollStepMax: 300,

            chunkMin: 150,
            chunkMax: 500,

            ...options
        };
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    random(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    async action(label = '', page = null) {
        const total = this.random(
            this.config.actionMin,
            this.config.actionMax
        );

        log(this.requestId, 'Action delay', {
            label,
            duration: `${total}ms`
        });

        await this.#humanizedWait(total, page);
    }

    async navigation(label = '', page = null) {
        const total = this.random(
            this.config.navigationMin,
            this.config.navigationMax
        );

        log(this.requestId, 'Navigation delay', {
            label,
            duration: `${total}ms`
        });

        await this.#humanizedWait(total, page);
    }

    async upload(label = '') {
        const total = this.random(
            this.config.uploadMin,
            this.config.uploadMax
        );

        log(this.requestId, 'Upload delay', {
            label,
            duration: `${total}ms`
        });

        await this.sleep(total);
    }

    async betweenGroup(label = '') {
        const total = this.random(
            this.config.betweenGroupMin,
            this.config.betweenGroupMax
        );

        log(this.requestId, 'Between group delay', {
            label,
            duration: `${total}ms`
        });

        await this.sleep(total);
    }

    /**
     * 🔥 Core: sleep + scroll xen kẽ
     */
    async #humanizedWait(totalTime, page) {

        let elapsed = 0;

        // 🔇 KHÔNG log mỗi chunk để tránh spam

        while (elapsed < totalTime) {

            const chunk = this.random(
                this.config.chunkMin,
                this.config.chunkMax
            );

            await this.sleep(chunk);
            elapsed += chunk;

            if (page && Math.random() < this.config.scrollProbability) {

                const distance = this.random(
                    this.config.scrollStepMin,
                    this.config.scrollStepMax
                );

                try {
                    await page.mouse.wheel(0, distance);

                    // 25% khả năng scroll ngược nhẹ
                    if (Math.random() < 0.25) {
                        const reverse = this.random(40, 120);
                        await page.mouse.wheel(0, -reverse);
                    }

                } catch (err) {
                    logWarn(this.requestId, 'Scroll failed', {
                        error: err?.message
                    });
                }
            }
        }

        logOk(this.requestId, 'Delay completed', {
            total: `${totalTime}ms`
        });
    }
}