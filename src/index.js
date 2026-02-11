import dotenv from 'dotenv';
dotenv.config();

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

import { config } from './config.js';
import { getPageList, uploadExcel, updatePageCheckpoint } from './api.js';
import { crawlPage } from './crawler.js';
import { buildExcel } from './excel.js';

async function run() {

  let browser;

  try {

    console.log('🚀 START FB CRAWLER JOB');

    browser = await chromium.launch({
      headless: false
    });

    const context = await browser.newContext();

    // ===== LOAD COOKIE =====
    const cookiePath = path.resolve(config.cookieFile);

    if (fs.existsSync(cookiePath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
      await context.addCookies(cookies);
      console.log('🍪 Cookie loaded');
    }

    const pages = await getPageList();

    if (!pages?.length) {
      console.log('⚠ Không có page crawl');
      return;
    }

    for (const page of pages) {

      console.log('\n===================================');
      console.log('▶ Crawl page:', page.id);

      const { images, newLastUrl } =
          await crawlPage(page, context);

      if (!images.length) {
        console.log('⚠ Không có ảnh mới');
        continue;
      }

      console.log(`📸 Collected ${images.length} images`);

      // ===== BUILD EXCEL -> BUFFER =====
      const excelBuffer = await buildExcel(page.id, images);

      console.log('📄 Excel buffer created');

      // ===== UPLOAD =====
      await uploadExcel(excelBuffer, page.id);

      console.log('⬆ Excel uploaded');

      // ===== UPDATE CHECKPOINT =====
      await updatePageCheckpoint(
          page.id,
          newLastUrl
      );

      console.log('🆕 Checkpoint updated');
    }

    console.log('\n🔥 JOB DONE');

  } catch (err) {

    console.error('❌ JOB FAILED');
    console.error(err);

  } finally {

    if (browser) await browser.close();
  }
}

run();
