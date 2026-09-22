import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';

const dir = `${process.env.HOME}/Library/Caches/ms-playwright`;
const build = readdirSync(dir).filter((d) => d.startsWith('chromium-')).sort().pop();
const exe = `${dir}/${build}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => errors.push(`[failed] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`[${r.status()}] ${r.url()}`); });

await page.goto('http://localhost:4321/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelector('[data-hero]')?.dataset.ready === '1', { timeout: 20000 })
  .catch(() => errors.push('[fatal] сцена не поднялась: data-ready не выставлен'));

// Экран входа: до клика сцена стоит закрытой и скролла нет вовсе. Снимаем его
// и входим — дальше проверяется то же, что и раньше.
await page.screenshot({ path: 'shots/shot-gate.png' });
const gateVisible = await page.evaluate(() =>
  getComputedStyle(document.querySelector('[data-gate]')).visibility === 'visible');
await page.click('[data-gate-enter="mute"]');
await page.waitForTimeout(2600);
await page.screenshot({ path: 'shots/shot-entered.png' });

const mode = await page.getAttribute('[data-hero]', 'data-mode');
const glInfo = await page.evaluate(() => {
  const c = document.querySelector('.hero__canvas');
  const gl = c?.getContext('webgl2') || c?.getContext('webgl');
  return { mode: document.querySelector('[data-hero]')?.dataset.mode, ctx: !!gl, w: c?.width, h: c?.height };
});

// фаза 1: пятно за курсором
await page.mouse.move(400, 500);
await page.waitForTimeout(900);
await page.screenshot({ path: 'shots/shot-fog.png' });

// наведение на светлячок
const hits = await page.$$('.hero__hit');
if (hits.length) {
  const box = await hits[0].boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1200);
}
await page.screenshot({ path: 'shots/shot-hover.png' });
const miniVisible = await page.evaluate(() => !document.querySelector('[data-mini]')?.hidden);

// фаза 2: раскрытие
await page.evaluate(() => window.scrollTo(0, window.innerHeight * 0.9));
await page.waitForTimeout(1400);
await page.screenshot({ path: 'shots/shot-reveal.png' });

// замер изгиба: насколько разъезжаются дальние и ближние пиксели за раскрытие
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(900);
await page.screenshot({ path: 'shots/bend-0.png' });
await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.0));
await page.waitForTimeout(1400);
await page.screenshot({ path: 'shots/bend-1.png' });

// фаза 3: легенды
await page.evaluate(() => window.scrollTo(0, window.innerHeight * 3.2));
await page.waitForTimeout(1600);
await page.screenshot({ path: 'shots/shot-legend.png' });
const activeCard = await page.evaluate(() => document.querySelector('.card.is-active')?.querySelector('.card__title')?.textContent);

// прогресс скролла и число точек
const info = await page.evaluate(() => ({
  hits: document.querySelectorAll('.hero__hit').length,
  cards: document.querySelectorAll('[data-legend-card]').length,
  // страница под сценой: факты конкурса — по ним видно, что секция собралась.
  // Ленты ключевых объектов в «О территории» больше нет (блок сведён к составу
  // ТЗ), блоков голосования и «О проекте» — тоже: заказчик снял их с главной,
  // вёрстка лежит в `site/backup/components/`.
  competitionFacts: document.querySelectorAll('#about .fact').length,
  // фиксированный хедер: показан он или нет в текущей точке прокрутки
  topbar: document.querySelector('[data-topbar]')?.hasAttribute('data-shown'),
  scrollHeight: document.body.scrollHeight,
}));

console.log(JSON.stringify({ mode, glInfo, gateVisible, miniVisible, activeCard, ...info, errors }, null, 2));
await browser.close();
