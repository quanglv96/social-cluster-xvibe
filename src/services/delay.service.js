export class DelayService {

    constructor(options = {}) {

        this.config = {
            actionMin: 800,
            actionMax: 2500,

            navigationMin: 3000,
            navigationMax: 8000,

            uploadMin: 4000,
            uploadMax: 9000,

            betweenGroupMin: 15000,
            betweenGroupMax: 45000,

            scrollProbability: 0.35, // xác suất mỗi chunk có scroll

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

        console.log(`[DelayService] Action delay ${label}: ${total}ms`);

        await this.#humanizedWait(total, page);
    }

    async navigation(label = '', page = null) {
        const total = this.random(
            this.config.navigationMin,
            this.config.navigationMax
        );

        console.log(`[DelayService] Navigation delay ${label}: ${total}ms`);

        await this.#humanizedWait(total, page);
    }

    async upload(label = '') {
        const total = this.random(
            this.config.uploadMin,
            this.config.uploadMax
        );

        console.log(`[DelayService] Upload delay ${label}: ${total}ms`);

        await this.sleep(total);
    }

    async betweenGroup(label = '') {
        const total = this.random(
            this.config.betweenGroupMin,
            this.config.betweenGroupMax
        );

        console.log(`[DelayService] Between group delay ${label}: ${total}ms`);

        await this.sleep(total);
    }

    /**
     * 🔥 Core: sleep + scroll xen kẽ
     */
    async #humanizedWait(totalTime, page) {

        let elapsed = 0;

        while (elapsed < totalTime) {

            const chunk = this.random(
                this.config.chunkMin,
                this.config.chunkMax
            );

            await this.sleep(chunk);
            elapsed += chunk;

            // Nếu có page thì mới scroll
            if (page && Math.random() < this.config.scrollProbability) {

                const distance = this.random(
                    this.config.scrollStepMin,
                    this.config.scrollStepMax
                );

                await page.mouse.wheel(0, distance);

                // 25% khả năng scroll ngược nhẹ
                if (Math.random() < 0.25) {
                    const reverse = this.random(40, 120);
                    await page.mouse.wheel(0, -reverse);
                }
            }
        }
    }
}
