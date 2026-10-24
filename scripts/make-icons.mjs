// Renders public/icon.svg to the PNG sizes the web app manifest needs (placeholder until the design pass).
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const svg = fs.readFileSync('public/icon.svg', 'utf8');
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const page = await browser.newPage();
for (const size of [192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path: `public/icons/icon-${size}.png`, omitBackground: false });
}
await browser.close();
