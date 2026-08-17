/**
 * Плавная прокрутка страницы.
 *
 * Lenis живёт **на всю страницу и один раз**, а не внутри сцены: инерция —
 * свойство прокрутки сайта, и она обязана работать там, где первого экрана нет
 * вовсе (внутренние страницы, `/tokens`, выключенный на время hero). Раньше
 * экземпляр создавал `hero/scroll.ts`, и вместе с ним уезжала вся плавность.
 *
 * Инстанс один и создаётся тем, кто позвал первым: второй Lenis на том же
 * документе даёт два независимых сглаживания одного скролла — прокрутка
 * начинает дёргаться. Поэтому `init` идемпотентен, а `destroy` сцены его не
 * трогает: сцена только подписывает свой слушатель и снимает его.
 *
 * Прокрутка остаётся нативной (Lenis не подменяет скроллер), поэтому обычные
 * `scroll`-слушатели и `view()`-таймлайны продолжают работать как были.
 */

import Lenis from 'lenis';

let lenis: Lenis | null = null;
let raf = 0;
/** Свои подписчики, а не `lenis.on` у каждого: снимать их нужно по одному. */
const listeners = new Set<() => void>();

/**
 * Поднять прокрутку. Второй и следующие вызовы возвращают тот же экземпляр.
 *
 * При `prefers-reduced-motion` инерции нет вовсе (ТЗ 2.8): сглаживание — это
 * движение, которого просили не делать. Прокрутка при этом остаётся обычной,
 * ничего не отключается.
 */
export function initSmooth(): Lenis | null {
  if (lenis) return lenis;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;

  lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1 });
  lenis.on('scroll', () => listeners.forEach((fn) => fn()));
  const loop = (t: number) => {
    lenis!.raf(t);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return lenis;
}

/** Подписка на кадр прокрутки; возвращает функцию снятия. */
export function onSmoothScroll(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Пауза прокрутки — ей держит экран входа.
 *
 * Именно Lenis, а не `overflow: hidden` на документе: скрытый скроллбар меняет
 * ширину вьюпорта, а вернуть её потом можно только пересчётом границ — и этот
 * пересчёт переставляет узлы под пином, обрывая уход экрана входа вместе с
 * ходом строк. Здесь не меняется вообще ничего.
 */
export function stopSmooth(): void {
  lenis?.stop();
}

export function startSmooth(): void {
  lenis?.start();
}

/** Только для смены страницы: сцена и её пин экземпляр не убивают. */
export function destroySmooth(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  listeners.clear();
  lenis?.destroy();
  lenis = null;
}
