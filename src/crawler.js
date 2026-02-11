export async function crawlPage(pageData, browserContext) {

  const page = await browserContext.newPage();
  await page.bringToFront();

  const MAX_IMAGES = 10;

  // ===== Normalize viewer URL =====
  function normalizeViewerUrl(url) {

    if (!url) return url;

    if (!url.includes('type=3')) {
      url += (url.includes('?') ? '&' : '?') + 'type=3';
    }

    return url.replace('photo.php?', 'photo/?');
  }

  // ⭐ FIX: chỉ dùng lastImage
  let startUrl = normalizeViewerUrl(pageData.lastImage);

  if (!startUrl) {
    throw new Error('Missing lastImage');
  }

  // ===== Helpers =====

  async function getCurrentImage() {

    if (page.isClosed()) return null;

    await page.waitForTimeout(800);

    return await page.evaluate(() => {

      const images = Array.from(document.querySelectorAll('img'));

      let mainImg = null;

      for (const img of images) {

        if (!img.src.includes('scontent')) continue;

        if (!mainImg || img.naturalWidth > mainImg.naturalWidth) {
          mainImg = img;
        }
      }

      return {
        imageUrl: mainImg?.src || null,
        width: mainImg?.naturalWidth || null,
        height: mainImg?.naturalHeight || null,
        viewerUrl: window.location.href
      };
    });
  }

  async function isLeftDisabled() {

    if (page.isClosed()) return true;

    return await page.evaluate(() => {

      const leftBtn = document.querySelector(
          '[aria-label="Previous photo"], [aria-label="Ảnh trước"]'
      );

      if (!leftBtn) return true;

      return leftBtn.getAttribute('aria-disabled') === 'true';
    });
  }

  async function waitViewerChange(oldImageUrl) {

    if (page.isClosed()) return;

    try {

      await page.waitForFunction(
          (prevUrl) => {

            const imgs = Array.from(document.querySelectorAll('img'));

            const main = imgs.find(img =>
                img.naturalWidth > 900 &&
                img.src.includes('scontent')
            );

            return main && main.src !== prevUrl;
          },
          oldImageUrl,
          { timeout: 5000 }
      );

    } catch {

      if (!page.isClosed()) {
        await page.waitForTimeout(1500);
      }
    }
  }

  // ===== NAVIGATE =====

  console.log('🌐 Open viewer:', startUrl);

  await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const disabled = await isLeftDisabled();
  console.log('⬅ LEFT disabled =', disabled);

  if (disabled) {

    await page.close();

    return {
      images: [],
      newLastUrl: pageData.lastImage
    };
  }

  // ===== MOVE LEFT FROM CHECKPOINT =====

  console.log('📸 MOVE LEFT FROM CHECKPOINT');

  const checkpoint = await getCurrentImage();

  if (checkpoint?.imageUrl) {

    await page.locator('body').press('ArrowLeft');
    await waitViewerChange(checkpoint.imageUrl);

    const afterMove = await getCurrentImage();

    // 🔥 Nếu quay lại checkpoint → nghĩa là chưa có ảnh mới
    if (!afterMove || afterMove.imageUrl === checkpoint.imageUrl) {

      console.log('🟡 No new images → STOP');

      await page.close();

      return {
        images: [],
        newLastUrl: pageData.lastImage
      };
    }
  }

  // ===== START COLLECT =====

  console.log('📸 START COLLECT IMAGES');

  const images = [];
  const seenImages = new Set();

  let newLastUrl = pageData.lastImage;

  for (let i = 0; i < MAX_IMAGES; i++) {

    console.log(`👉 Collect image ${i + 1}`);

    const data = await getCurrentImage();

    if (!data || !data.imageUrl) break;

    if (seenImages.has(data.imageUrl)) {
      console.log('🔁 Duplicate image → STOP');
      break;
    }

    seenImages.add(data.imageUrl);

    images.push({
      imageUrl: data.imageUrl,
      width: data.width,
      height: data.height
    });

    console.log('✅ Collected:', data.imageUrl);

    newLastUrl = data.viewerUrl;

    const disabledLeft = await isLeftDisabled();

    if (disabledLeft) {
      console.log('⬅ LEFT disabled → STOP');
      break;
    }

    const oldImage = data.imageUrl;

    await page.locator('body').press('ArrowLeft');
    await waitViewerChange(oldImage);
  }

  console.log('📦 FINAL IMAGE COUNT:', images.length);

  await page.close();

  return {
    images,
    newLastUrl
  };
}
