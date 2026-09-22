import { chromium } from 'playwright-core';
import { readdirSync, readFileSync } from 'node:fs';

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
// Таймлайн считается от числа легенд, а не зашит числами: он и в сцене выведен
// из него же (`REVEAL 1 + HOLD 0.5 + LEGEND_SCREENS × N + OUTRO 1`). Снятая
// легенда сдвигает все щупы разом, и прежние числа щупали бы уже отпущенный пин
// — молча, с пустым `errors`.
const N = JSON.parse(readFileSync(new URL('../public/kv/manifest.json', import.meta.url), 'utf8'))
  .legends.length;
const SCREENS = 1.35;          // LEGEND_SCREENS в hero/scroll.ts
const L1 = 1.5;                // раскрытие 1 + пауза 0.5
const outro = L1 + SCREENS * N;   // старт финального слота, длиной ровно в экран
const last = outro - 0.1;         // конец последней легенды
// Наплыв идёт по скроллу и занимает первые 35% слота, то есть 0.47 экрана:
// позиция целиком задаёт фронт, ждать после прокрутки нужно только доводку
// инерции Lenis и вход карточки.
for (const [name, vh, wait] of [
  ['hold', 1.3, 1200],
  ['l1-wipe-30', L1 + SCREENS * 0.35 * 0.3, 900],
  ['l1-wipe-70', L1 + SCREENS * 0.35 * 0.7, 900],
  ['l1-done', L1 + SCREENS * 0.37, 1200],
  ['l1-mid', L1 + SCREENS * 0.67, 1200],
  ['l1-end', L1 + SCREENS * 0.96, 1200],
  ['l2-wipe', L1 + SCREENS * 1.11, 900],
  ['l2-done', L1 + SCREENS * 1.41, 1200],
  ['l3-mid', L1 + SCREENS * 2.52, 1200],
  ['back-l2', L1 + SCREENS * 1.19, 1200],   // отмотка: тот же фронт уходит назад, не встречный
  [`l${N}-end`, last, 1400],
  // финал: за последней легендой тем же фронтом канвас снимается в прозрачность,
  // и в дыру видно секцию «О территории». Слот длиной ровно в экран, фронт
  // занимает его целиком — пин отпускает вместе с ним
  ['outro-20', outro + 0.2, 1000],
  ['outro-40', outro + 0.4, 1000],
  ['outro-60', outro + 0.6, 1000],
  ['outro-90', outro + 0.9, 1400],
  ['after-pin', outro + 1.7, 1400],         // пин отпустил: финал уезжает вверх сам, как секция
  [`back-l${N}`, outro - 0.2, 1400],        // отмотка: финал уходит тем же фронтом назад
]) {
  await go(vh);
  await page.waitForTimeout(wait);
  log.push({ name, vh: +vh.toFixed(2), ...(await snap()) });
  await page.screenshot({ path: `shots/wipe-${name}.png` });
}
console.log(JSON.stringify({ log, errors }, null, 2));
await browser.close();
