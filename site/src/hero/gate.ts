/**
 * Экран входа.
 *
 * Первое, что видно: плоский тёмно-синий фон темы, крупный леттеринг и две
 * кнопки — со звуком и без. Звука в проекте ещё нет, обе кнопки делают одно и
 * то же; выбор запоминается в состоянии, чтобы звуку было куда прийти.
 *
 * Зачем экран нужен механически: сцена под ним стоит закрытой (`state.enter`
 * = 0 — форм кальки ещё нет, пятна тоже), и вход её запускает. Фон экрана — тот
 * же `--bg`, что и плоский фон кальки, поэтому его уход не подменяет картинку:
 * на том же цвете начинают проступать её белые формы.
 *
 * Прокрутка до входа стоит: страница длинная, и скролл сквозь тёмный экран увёл
 * бы в ленту легенд мимо всей сцены. Держит её Lenis, а не `overflow: hidden` —
 * см. `Scroll.stop`.
 */

import { state } from './state';

export type Gate = { destroy(): void };

/** Клавиши, которыми страницу тоже листают: Lenis их не перехватывает. */
const KEYS = new Set([' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End']);

/**
 * Вешает вход. `scroll` останавливается на время экрана; если его нет
 * (статичный режим), блокировать нечего. Если экрана входа нет в разметке,
 * сцена считается открытой сразу — иначе она осталась бы в тумане навсегда.
 */
export function initGate(
  root: HTMLElement,
  scroll: { stop(): void; start(): void } | null,
): Gate {
  const gate = root.querySelector<HTMLElement>('[data-gate]');
  if (!gate) {
    state.entered = true;
    state.enter = 1;
    return { destroy() {} };
  }

  // Атрибут ставит скрипт, а не разметка: под ним прячется текст первого экрана,
  // и без JS он обязан остаться видимым — там нет ни входа, ни анимаций.
  root.dataset.gated = '';
  scroll?.stop();
  // Возврат на страницу браузер восстанавливает вместе с прокруткой, а сцена
  // начинается с нуля: без этого вход открывался бы посреди ленты легенд.
  window.scrollTo(0, 0);

  const onKey = (e: KeyboardEvent) => {
    if (KEYS.has(e.key)) e.preventDefault();
  };
  window.addEventListener('keydown', onKey, { passive: false });

  const buttons = Array.from(gate.querySelectorAll<HTMLElement>('[data-gate-enter]'));

  const enter = (e: Event) => {
    const el = e.currentTarget as HTMLElement;
    state.sound = el.dataset.gateEnter === 'sound';
    state.entered = true;
    // Дальше всё рисует CSS по атрибуту: текст экрана гаснет, следом уходит его
    // фон, и тем же порядком входят строки первого экрана. Ход кальки и пятна
    // считает кадровый цикл — он же ведёт и остальную сцену.
    root.dataset.entered = '1';
    scroll?.start();
    window.removeEventListener('keydown', onKey);
    buttons.forEach((b) => b.removeEventListener('click', enter));
  };

  buttons.forEach((b) => b.addEventListener('click', enter));

  return {
    destroy() {
      buttons.forEach((b) => b.removeEventListener('click', enter));
      window.removeEventListener('keydown', onKey);
      scroll?.start();
    },
  };
}
