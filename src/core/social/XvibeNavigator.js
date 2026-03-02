export class XvibeNavigator {

    constructor(rootPage) {
        this.page = rootPage;
    }

    // =========================
    // Ensure root ready
    // =========================
    async ensureReady() {

        if (!this.page || this.page.isClosed()) {
            throw new Error('Root page is not available');
        }

        await this.page.waitForLoadState('domcontentloaded');
    }

    // =========================
    // Click Vibe button
    // =========================
    async openVibe() {

        await this.ensureReady();

        const vibeButton = this.page.locator(
            'button:has(i.fa-images)'
        );

        await vibeButton.waitFor({ state: 'visible' });
        await vibeButton.click();

        // nếu UI có animation
        await this.page.waitForTimeout(800);
    }

    // =========================
    // Human-like scroll
    // =========================
    async scrollFeed(times = 3) {

        for (let i = 0; i < times; i++) {
            await this.page.mouse.wheel(0, 1200);
            await this.page.waitForTimeout(500);
        }
    }

    // =========================
    // Double click center
    // =========================
    async doubleClickCenter() {

        const viewport = this.page.viewportSize();

        const x = viewport.width / 2;
        const y = viewport.height / 2;

        await this.page.mouse.move(x, y);
        await this.page.waitForTimeout(200);

        await this.page.mouse.dblclick(x, y);
    }

    // =========================
    // Full flow
    // =========================
    async openVibeAndInteract() {

        await this.openVibe();
        await this.scrollFeed(3);
        await this.doubleClickCenter();
    }
}