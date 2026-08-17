import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const dir = `${process.env.HOME}/Library/Caches/ms-playwright`;
const b = readdirSync(dir).filter(d => d.startsWith('chromium-')).sort().pop();
const br = await chromium.launch({ executablePath: `${dir}/${b}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` });
const p = await br.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => document.querySelector('[data-hero]')?.dataset.ready === '1');
await p.evaluate(() => window.scrollTo(0, window.innerHeight * 1.385));
await p.waitForTimeout(1500);
await p.screenshot({ path: 'shots/dbg-bend-on.png' });
await p.evaluate(() => { window.__hero.scene.manifest.travel.depth_bend = 0; });
await p.waitForTimeout(600);
await p.screenshot({ path: 'shots/dbg-bend-off.png' });
console.log(JSON.stringify(await p.evaluate(() => {
  const s = window.__hero.scene, u = s.quad.program.uniforms;
  return { frame: u.uFrame.value, bend: u.uBend.value };
})));
await br.close();
