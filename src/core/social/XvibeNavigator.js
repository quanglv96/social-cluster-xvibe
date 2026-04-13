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

const TAG = 'XVIBE_NAV';

export class XvibeNavigator {

    constructor(rootPage, shouldStopFn) {
        this.page = rootPage;
        this.running = false;
        this.shouldStop = shouldStopFn;
        this.requestId = `${TAG}_${Date.now()}`;
    }

    async ensureReady() {
        if (!this.page || this.page.isClosed()) {
            logError(this.requestId, 'Root page not available');
            throw new Error('Root page is not available');
        }

        log(this.requestId, 'Ensuring page ready');

        await this.page.bringToFront();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async openVibe() {

        log(this.requestId, 'Opening vibe UI');

        await this.page.waitForTimeout(2000);
        await this.ensureReady();

        const vibeButton = this.page.locator(
            'button.w-full.text-left:has(i.fa-images)'
        );

        await vibeButton.waitFor({ state: 'visible', timeout: 5000 });
        await vibeButton.click();

        await this.page.waitForTimeout(1000);

        logOk(this.requestId, 'Vibe UI opened');
    }

    async scrollAndClick() {

        await this.page.mouse.wheel(0, 1200);
        await this.page.waitForTimeout(500);

        const viewport = this.page.viewportSize();
        if (!viewport) {
            logWarn(this.requestId, 'Viewport not available');
            return;
        }

        const x = viewport.width / 2;
        const y = viewport.height / 2;

        await this.page.mouse.move(x, y);
        await this.page.waitForTimeout(150);
        await this.page.mouse.dblclick(x, y);
    }

    // =========================
    // MAIN LOOP
    // =========================
    async start() {

        const startTime = Date.now();

        this.running = true;

        log(this.requestId, 'Navigator auto mode started');

        await this.openVibe();

        let counter = 0;

        while (this.running) {

            try {
                // 🔴 Stop nếu có event
                if (this.shouldStop && await this.shouldStop()) {
                    logWarn(this.requestId, 'Stop condition triggered');
                    break;
                }

                await this.scrollAndClick();
                counter++;

                // 🔥 đủ 100 lần → reload
                if (counter >= 100) {

                    log(this.requestId, 'Reloading after threshold', {
                        counter
                    });

                    await this.page.waitForTimeout(1000);

                    await this.page.reload({
                        waitUntil: 'domcontentloaded'
                    });

                    await this.page.waitForTimeout(1500);
                    await this.openVibe();

                    counter = 0;

                    logOk(this.requestId, 'Reload completed');
                }

                await this.page.waitForTimeout(
                    1500 + Math.floor(Math.random() * 1500)
                );

            } catch (err) {
                logError(this.requestId, 'Navigator loop error', err);
            }
        }

        this.running = false;

        logOk(this.requestId, 'Navigator stopped', {
            duration: `${Date.now() - startTime}ms`
        });
    }

    stop() {
        this.running = false;
        logWarn(this.requestId, 'Navigator stop requested');
    }
}