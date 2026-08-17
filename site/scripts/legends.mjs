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
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
await page.goto('http://localhost:4322/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelector('[data-hero]')?.dataset.ready === '1');
// до входа сцена закрыта и скролл-сценария нет: лента начинается после клика
await page.click('[data-gate-enter="mute"]');
await page.waitForTimeout(2600);

const snap = () => page.evaluate(() => {
  const st = window.__hero?.state;
  const card = document.querySelector('.card.is-active');
  return st && {
    i: st.legendIndex, local: +st.legendLocal.toFixed(2), wipe: +st.legendWipe.toFixed(2),
    cover: +st.legendCover.toFixed(2),
    outro: +st.outroWipe.toFixed(2),
    // докуда снизу канвас снят гарантированно и уход карточки: оба идут от наплыва
    rise: +st.outroRise.toFixed(2),
    // Выход из сцены: секция под ней едет снизу вверх обычным скроллом, и к
    // концу пина её верхняя кромка обязана встать ровно на ноль. Разъедься
    // перекрытие с длиной финального слота — пин отпустил бы скачком, и видно
    // это только числом: на скриншоте два светлых экрана неотличимы.
    terr: Math.round(document.querySelector('#territory').getBoundingClientRect().top),
    out: card ? getComputedStyle(card).getPropertyValue('--out').trim() : null,
    card: card?.querySelector('.card__title')?.textContent?.slice(0, 22) ?? null,
    // ход карточки по слоту: +1 — ниже центра, −1 — выше; и прогресс дивайдера
    y: card ? getComputedStyle(card).getPropertyValue('--y').trim() : null,
    p: card ? getComputedStyle(card).getPropertyValue('--p').trim() : null,
  };
});
const go = (k) => page.evaluate((v) => window.scrollTo(0, window.innerHeight * v), k);

const log = [];
// Таймлайн: раскрытие 0..1, пауза 1..1.5, легенда N — [1.5 + 1.35N, +1.35).
// Наплыв идёт по скроллу и занимает первые 35% слота, то есть 0.47 экрана:
// позиция целиком задаёт фронт, ждать после прокрутки нужно только доводку
// инерции Lenis и вход карточки.
for (const [name, vh, wait] of [
  ['hold', 1.3, 1200],
  ['l1-wipe-30', 1.64, 900],
  ['l1-wipe-70', 1.83, 900],
  ['l1-done', 2.0, 1200],
  ['l1-mid', 2.4, 1200],
  ['l1-end', 2.8, 1200],
  ['l2-wipe', 3.0, 900],
  ['l2-done', 3.4, 1200],
  ['l3-mid', 4.9, 1200],
  ['back-l2', 3.1, 1200],       // отмотка: тот же фронт уходит назад, не встречный
  ['l6-end', 9.5, 1400],
  // финал: за последней легендой той же маской наплывает светлая заливка.
  // Слот 9.6..10.6, и фронт занимает его целиком — пин отпускает вместе с ним
  ['outro-20', 9.8, 1000],
  ['outro-40', 10.0, 1000],
  ['outro-60', 10.2, 1000],
  ['outro-90', 10.5, 1400],
  ['after-pin', 11.3, 1400],    // пин отпустил: финал уезжает вверх сам, как секция
  ['back-l6', 9.4, 1400],       // отмотка: финал уходит тем же фронтом назад
]) {
  await go(vh);
  await page.waitForTimeout(wait);
  log.push({ name, vh, ...(await snap()) });
  await page.screenshot({ path: `shots/wipe-${name}.png` });
}
console.log(JSON.stringify({ log, errors }, null, 2));
await browser.close();
