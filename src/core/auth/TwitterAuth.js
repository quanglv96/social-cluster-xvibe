import { BaseAuth } from './BaseAuth.js';

export class TwitterAuth extends BaseAuth {

    async authenticate(context, dto) {

        const { cookie, user_name, password } = dto;

        const page = await context.newPage();
        let loggedIn = false;

        if (cookie) {
            try {
                const cookies = JSON.parse(cookie);
                await context.addCookies(cookies);

                await page.goto('https://x.com/home');
                await page.waitForTimeout(5000);

                if (await page.$('a[data-testid="SideNav_NewTweet_Button"]')) {
                    loggedIn = true;
                }
            } catch {}
        }

        if (!loggedIn) {

            if (!user_name || !password) {
                throw new Error("Twitter credential missing");
            }

            await page.goto('https://x.com/i/flow/login');
            await page.waitForSelector('input[name="text"]');

            await page.fill('input[name="text"]', user_name);
            await page.keyboard.press("Enter");
            await page.waitForTimeout(3000);

            await page.fill('input[name="password"]', password);
            await page.keyboard.press("Enter");
            await page.waitForTimeout(6000);

            if (!await page.$('a[data-testid="SideNav_NewTweet_Button"]')) {
                throw new Error("Twitter login failed");
            }
        }

        await page.close();
    }
}
