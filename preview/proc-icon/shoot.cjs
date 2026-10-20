// Screenshots the execution-icon style gallery for review.
// Usage: node preview/proc-icon/shoot.cjs
const path = require('node:path');
const { chromium } = require('/Users/0the/node_modules/playwright');

const dir = __dirname;
const url = 'file://' + path.join(dir, 'index.html');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const report = await page.evaluate(() => {
    const imgs = Array.from(document.images);
    return {
      total: imgs.length,
      broken: imgs.filter(img => !img.complete || !img.naturalWidth).map(img => img.getAttribute('src'))
    };
  });
  await page.screenshot({ path: path.join(dir, 'preview-light.png'), fullPage: true });
  await page.click('#btn-dark');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(dir, 'preview-dark.png'), fullPage: true });
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
