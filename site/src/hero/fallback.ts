/**
 * Фолбэк без WebGL (ТЗ 2.8): CSS-размытие плюс радиальная маска за курсором.
 *
 * Даёт около 70% эффекта и работает везде. Параллакса и светлячков здесь нет —
 * они и есть та часть, которую без шейдера воспроизвести нечем; точки-легенды
 * остаются кнопками в DOM, поэтому контент не теряется.
 */

import { state } from './state';

export function initFallback(root: HTMLElement) {
  root.dataset.mode = 'css';
  const hole = root.querySelector<HTMLElement>('[data-css-hole]');
  if (!hole) return;

  let x = 0.5;
  let y = 0.5;
  let tx = 0.5;
  let ty = 0.5;
  let raf = 0;

  const move = (e: PointerEvent) => {
    tx = e.clientX / window.innerWidth;
    ty = e.clientY / window.innerHeight;
  };
  window.addEventListener('pointermove', move, { passive: true });

  const tick = () => {
    x += (tx - x) * 0.06;
    y += (ty - y) * 0.06;
    hole.style.setProperty('--x', `${(x * 100).toFixed(2)}%`);
    hole.style.setProperty('--y', `${(y * 100).toFixed(2)}%`);
    hole.style.setProperty('--r', `${18 + state.reveal * 140}vmin`);
    hole.style.setProperty('--fog', `${1 - state.reveal}`);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', move);
  };
}
