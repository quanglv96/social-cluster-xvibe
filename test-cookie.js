import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  const cookies = JSON.parse(fs.readFileSync('./cookies.json', 'utf8'));
  await context.addCookies(cookies);

  const page = await context.newPage();
  await page.goto('https://www.facebook.com', { waitUntil: 'networkidle' });

})();
