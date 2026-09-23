/**
 * Сборка первого экрана.
 *
 * Один островок на всё (ТЗ 2.9): пятно, светлячки, размытие и скролл делят общий
 * rAF и общее состояние. Резать это по островкам значит гонять несколько циклов
 * анимации и потом синхронизировать их между собой.
 */

import { Blob } from './blob';
import { detect, probe, type Caps } from './caps';
import { Field } from './field';
import { initFallback } from './fallback';
import { initGate, type Gate } from './gate';
import { Points } from './points';
import { Scene } from './scene';
import { initScroll, type Scroll } from './scroll';
import { Phase, state, type Manifest, type Point } from './state';
import { Tally } from './tally';
import { TextMask } from './textmask';

let scroll: Scroll | null = null;
let gate: Gate | null = null;
let raf = 0;

/** сглаживание концов: линейный ход трогается и тормозит рывком */
const smooth01 = (v: number) => v * v * (3 - 2 * v);

/**
 * Вход, в секундах: сколько ждать и сколько идти. Своё время, а не скролл —
 * вход это один клик, прокручивать в нём нечего.
 *
 * Задержка равна уходу экрана входа (0.25 текст + 0.5 фон): проявление кальки
 * под непрозрачным фоном не видно вовсе, а стоит ему начаться раньше — вход
 * читается сменой картинки, а не одним движением. Пересечение в четверть
 * секунды оставлено намеренно, чтобы между ними не появилась пауза.
 */
const ENTER_DELAY = 0.55;
const ENTER_SECONDS = 1.5;

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

export async function mount(root: HTMLElement) {
  const section = root.closest<HTMLElement>('[data-hero-section]') ?? root;
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  const layer = root.querySelector<HTMLElement>('[data-points]')!;
  const teasers: Record<string, string> = JSON.parse(root.dataset.teasers ?? '{}');
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-legend-card]'));

  const [manifest, points] = await Promise.all([
    fetchJson<Manifest>('/kv/manifest.json'),
    fetchJson<Point[]>('/kv/points.json'),
  ]);

  const caps: Caps = await detect(manifest.plateWidths);
  state.reduced = caps.reduced;

  const dom = new Points(layer, points, teasers);
  /**
   * Карточка легенды.
   *
   * Появляется следом за наплывом, а не вместе с ним: пока фронт идёт, под
   * текстом ещё половина предыдущего кадра. Смена легенды — это смена карточки:
   * предыдущая гаснет прозрачностью прямо под наплывом, следующая раскрывается
   * клипом и вводит текст построчно. Отсюда и условие показа — не «какая
   * легенда», а «какая легенда, у которой наплыв уже прошёл больше половины»:
   * на границе слотов оно само даёт паузу, в которой старая карточка уходит.
   *
   * Всё время слота карточка ползёт снизу вверх: прокрутка обязана что-то
   * двигать, иначе пин читается зависшим.
   */
  let shown = -1;
  const showCard = (index: number, local: number) => {
    const on3 = state.phase === Phase.Legends && index >= 0;
    const want = on3 && state.legendWipe > 0.55 ? index : -1;

    if (want !== shown) {
      cards[shown]?.classList.remove('is-in', 'is-active');
      shown = want;
      const el = cards[want];
      if (el) {
        // Перезапуск анимации: без чтения раскладки класс вернулся бы в том же
        // кадре и вход не проигрался бы вовсе.
        void el.offsetWidth;
        el.classList.add('is-in', 'is-active');
      }
      cards.forEach((c, i) => c.setAttribute('aria-hidden', i === want ? 'false' : 'true'));
    }

    const el = cards[shown];
    if (el) {
      // --y: +1 в начале слота, −1 в конце. Сглаживание концов обязательно:
      // линейный ход трогается и встаёт рывком ровно там, где идёт наплыв.
      el.style.setProperty('--y', (1 - 2 * smooth01(local)).toFixed(3));
      // --p: прогресс слота, его показывает дивайдер карточки
      el.style.setProperty('--p', local.toFixed(3));
      // --out: финальный наплыв. Карточка — часть уходящего экрана и уезжает
      // вверх вместе со своим кадром, а не гаснет на месте. Гаснет она при этом
      // тоже: кадр под ней накрывает маска, а карточка живёт в DOM поверх
      // канваса, и доехать до верхней кромки поверх новой заливки ей нечем.
      el.style.setProperty('--out', state.outroWipe.toFixed(3));
    }
  };

  // ТЗ 2.8: reduced-motion — статичный кадр, всё остальное всё равно доступно
  if (!caps.webgl || caps.reduced) {
    initFallback(root);
    // Наплыв считает сцена, а её здесь нет: без этого прозрачность карточки
    // навсегда осталась бы на нуле и легенды не показались бы вовсе.
    state.legendWipe = 1;
    if (!caps.reduced) {
      // Перекрытия здесь нет: открыть кадр нечем — фолбэк держит картинку, а не
      // канвас, и секция под сценой наехала бы на неё без всякого перехода.
      scroll = initScroll(section, cards.length, showCard, false, false);
      gate = initGate(root, scroll);
    } else {
      root.dataset.mode = 'static';
      state.legendIndex = 0;
      showCard(0, 0.5);
      gate = initGate(root, null);
    }
    root.dataset.ready = '1';
    return;
  }

  // качество решается по замеру: скачок числа частиц посреди сцены заметнее,
  // чем низкий фреймрейт, поэтому меряем до инициализации сцены
  caps.quality = await probe(1200);

  const scene = new Scene(canvas, manifest, points, caps);
  await scene.init();
  const blob = new Blob(points);

  // отладочный доступ к сцене: только в dev-сборке, в прод не попадает
  if (import.meta.env.DEV) (window as any).__hero = { scene, blob, state };

  root.dataset.mode = 'webgl';
  root.dataset.ready = '1';

  // ── тёмная копия текста ──────────────────────────────────────────────────
  // Клон, а не вторая ветка разметки: две версии одного текста в шаблоне
  // разъедутся на первой же правке. Копия ничего не ловит — ни курсор, ни Tab.
  // Копий две: снимок маски всегда назначается скрытой, и она подменяет
  // показанную уже с готовой маской. Одна копия мигала на каждой смене.
  let textMask: TextMask | null = null;
  const ui = root.querySelector<HTMLElement>('[data-hero-ui]');
  if (ui) {
    const clones = [0, 1].map(() => {
      const c = ui.cloneNode(true) as HTMLElement;
      c.removeAttribute('data-hero-ui');
      c.dataset.heroUiHole = '';
      c.setAttribute('aria-hidden', 'true');
      c.setAttribute('inert', '');
      ui.after(c);
      return c;
    }) as [HTMLElement, HTMLElement];
    try {
      textMask = new TextMask(scene.noiseImage, clones);
      textMask.resize(window.innerWidth, window.innerHeight);
    } catch (e) {
      // без второго контекста текст остаётся одноцветным — это хуже, но живо
      console.warn(e);
      clones.forEach((c) => c.remove());
    }
  }

  // ── свободное поле кадра ─────────────────────────────────────────────────
  // Полоса между текстом первого экрана и подписью к карте. В неё сцена
  // опускает кадр, и в ней же держится мини-плашка: обе меряют одно и то же
  // место одним объектом — два замера одного поля разъехались бы.
  const intro = root.querySelector<HTMLElement>('.hero__intro');
  const map = root.querySelector<HTMLElement>('.hero__map');
  const field = intro && map ? new Field(intro, map) : null;
  if (field) {
    scene.setField(field);
    dom.setField(field);
  }

  // ── счётчик собранных легенд ─────────────────────────────────────────────
  // Точки слетаются в него на раскрытии; место сцена спрашивает у плашки, а не
  // считает — она стоит по общей колонке страницы.
  let tally: Tally | null = null;
  try {
    tally = new Tally(root, scene.dotPx);
    scene.setGatherTarget(tally.target);
  } catch (e) {
    console.warn(e);
  }

  // ── ввод ─────────────────────────────────────────────────────────────────
  let lastX = 0.5;
  let lastY = 0.5;
  const onMove = (e: PointerEvent) => {
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    // Насколько активно ведут курсор. Копится по событиям и гаснет в кадре:
    // считать скорость одной разницей между кадрами нельзя, события мыши
    // приходят реже кадров и дают дыры.
    state.motion = Math.min(1, state.motion + Math.hypot(x - lastX, y - lastY) * 7);
    lastX = x;
    lastY = y;
    state.pointer.x = x;
    state.pointer.y = y;
    state.mouse.x = x * 2 - 1;
    state.mouse.y = y * 2 - 1;
    blob.pointer(x, y, performance.now());
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  const onResize = () => {
    scene.resize();
    if (field) {
      // Поле пересчитывается на resize, а не в кадре: его держит раскладка
      // страницы, а она меняется только вместе с шириной окна.
      field.measure();
      dom.setField(field);
    }
    textMask?.resize(window.innerWidth, window.innerHeight);
    if (tally) {
      tally.resize(scene.dotPx);
      scene.setGatherTarget(tally.target);
    }
  };
  window.addEventListener('resize', onResize);

  // ── скролл ───────────────────────────────────────────────────────────────
  // Подъезда камеры к точке в фазе 3 больше нет: точки живут на мастер-кадре, а
  // его закрывает кадр легенды. Двигать камеру под наплывом значит дёргать
  // картинку, которую вот-вот перекроют.
  //
  // Карточку обновляет кадровый цикл, а не событие скролла: её показ зависит от
  // наплыва, а тот считается в кадре — Lenis доводит прокрутку инерцией и после
  // последнего события колеса.
  //
  // Сценарий поднимается ДО входа, хотя прокрутка на нём же и остановлена: pin
  // переносит секцию в свою обёртку, то есть переставляет узлы, а перестановка
  // сбрасывает запущенные переходы. Подними его по клику — и уход экрана входа
  // вместе с ходом строк не проиграется вовсе.
  // Последний аргумент — перекрытие: секция под сценой поднимается вместе с
  // финальным наплывом, и открывает её сам канвас, уходя в прозрачность.
  scroll = initScroll(section, cards.length, () => {}, false, true);
  gate = initGate(root, scroll);

  // ── кадр ─────────────────────────────────────────────────────────────────
  let prev = performance.now();
  let visible = true;
  /** часы входа: идут с клика, включая паузу на уход экрана входа */
  let enterClock = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (!visible) return;
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    state.time += dt;
    // Время маски бежит быстрее, пока ведут курсор: обрывки живут интенсивнее.
    // Отдельные часы, а не множитель на state.time — иначе фаза шума прыгает
    // при каждом изменении скорости и обрывки дёргаются.
    state.motion *= Math.exp(-dt * 2.2);
    state.maskTime += dt * (1 + 3.5 * state.motion);
    // Вход: калька проступает, следом открывается пятно. Обе отсечки и
    // сглаживание — в сцене, здесь только часы.
    if (state.entered && state.enter < 1) {
      enterClock += dt;
      state.enter = Math.max(0, Math.min(1, (enterClock - ENTER_DELAY) / ENTER_SECONDS));
    }

    // фаза уезжает в атрибут: заголовок и подсказка гасятся стилями, а не скриптом
    const phase = state.phase === Phase.Fog ? 'fog' : state.phase === Phase.Reveal ? 'reveal' : 'legends';
    if (root.dataset.phase !== phase) root.dataset.phase = phase;

    // в фазе раскрытия пятно перестаёт слушать курсор (ТЗ 1.5, фаза 2)
    const fog = state.phase === Phase.Fog;
    if (!fog) dom.dismiss();
    const hovered = fog ? dom.hovered() : null;
    blob.update(dt, now, hovered, (uv) => scene.screenOf(uv));
    scene.advanceLegends();
    showCard(state.legendIndex, state.legendLocal);
    tally?.update();
    scene.render(blob);
    // Снимок маски — после кадра сцены и только в тумане: дальше текст уходит
    // вместе с фазой, и держать под него второй рендер незачем.
    textMask?.update(now, fog, scene.maskState());
    dom.update((uv, d) => scene.screenOf(uv, d), window.innerWidth, window.innerHeight);
  };
  raf = requestAnimationFrame(tick);

  // rAF на паузу, когда вкладка скрыта или канвас вне вьюпорта (ТЗ 2.7)
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    prev = performance.now();
  });
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting && !document.hidden;
    prev = performance.now();
  }, { threshold: 0 }).observe(canvas);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('resize', onResize);
    textMask?.destroy();
    scroll?.destroy();
    gate?.destroy();
  };
}

/** ТЗ 2.9: при ClientRouter сцена поднимается на astro:page-load и умирает на swap. */
export function autoMount() {
  const root = document.querySelector<HTMLElement>('[data-hero]');
  if (!root) return;
  let teardown: (() => void) | void;
  mount(root).then((t) => {
    teardown = t;
  });
  document.addEventListener('astro:before-swap', () => teardown?.(), { once: true });
}
