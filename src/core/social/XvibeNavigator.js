export class XvibeNavigator {

    constructor(rootPage, shouldStopFn) {
        this.page = rootPage;
        this.running = false;
        this.shouldStop = shouldStopFn; // callback check event
    }

    async ensureReady() {
        if (!this.page || this.page.isClosed()) {
            throw new Error('Root page is not available');
        }

        await this.page.bringToFront();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async openVibe() {
        await this.page.waitForTimeout(2000);
        await this.ensureReady();

        const vibeButton = this.page.locator(
            'button.w-full.text-left:has(i.fa-images)'
        );

        await vibeButton.waitFor({ state: 'visible', timeout: 5000 });
        await vibeButton.click();

        await this.page.waitForTimeout(1000);
    }

    async scrollAndClick() {

        await this.page.mouse.wheel(0, 1200);
        await this.page.waitForTimeout(500);

        const viewport = this.page.viewportSize();
        if (!viewport) return;

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

        this.running = true;
        await this.openVibe();

        let counter = 0;

        console.log('[Navigator] Auto mode started');

        while (this.running) {

            // 🔴 Stop nếu có event
            if (this.shouldStop && await this.shouldStop()) {
                console.log('[Navigator] Event detected → stop');
                break;
            }

            await this.scrollAndClick();
            counter++;

            // 🔥 đủ 100 lần → reload
            if (counter >= 100) {
                await this.page.waitForTimeout(1000);
                console.log('[Navigator] Reload after 100 actions');
                await this.page.reload({
                    waitUntil: 'domcontentloaded'
                });

                await this.page.waitForTimeout(1500);
                await this.openVibe();

                counter = 0;
            }

            await this.page.waitForTimeout(
                1500 + Math.floor(Math.random() * 1500)
            );
        }

        this.running = false;
    }

    stop() {
        this.running = false;
    }
}