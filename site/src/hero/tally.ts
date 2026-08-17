/**
 * Счётчик собранных легенд.
 *
 * Продолжение меток, а не отдельный элемент: на раскрытии шесть точек слетаются
 * в одну (`state.gather`, движение считает шейдер), и ровно в её месте встаёт
 * эта плашка — тот же круг того же акцентного цвета. С первой легендой круг
 * разворачивается в плашку со счётчиком.
 *
 * Место назначает DOM, а не сцена: плашка стоит по общей колонке страницы, и
 * посчитанная вторым разом координата разъехалась бы с колонкой на первой же
 * правке полей. Сцена спрашивает `target` и ведёт точки туда.
 *
 * Счёт монотонный: отмотка вверх возвращает кадры и карточки, но не отбирает
 * уже собранное — собранное собрано.
 */

import { Phase, state } from './state';

export class Tally {
  private el: HTMLElement;
  private count: HTMLElement;
  /** максимум показанного: назад счёт не идёт */
  private shown = 0;
  private open = false;
  private on = false;
  /** центр круга в UV экрана; пересчитывается на resize, а не в кадре */
  private center: [number, number] = [0.08, 0.5];

  constructor(root: HTMLElement, dotPx: number) {
    const el = root.querySelector<HTMLElement>('[data-tally]');
    if (!el) throw new Error('нет плашки счётчика');
    this.el = el;
    this.count = el.querySelector<HTMLElement>('[data-tally-count]')!;
    this.resize(dotPx);
  }

  /**
   * Размер круга приходит из сцены: собранная точка обязана быть ровно той же
   * меткой, что прилетела. Число живёт в одном месте — `DOT_SIZE` в scene.ts.
   */
  resize(dotPx: number) {
    this.el.style.setProperty('--dot', `${dotPx}px`);
    const r = this.el.getBoundingClientRect();
    // Полуширина берётся от круга, а не от плашки: развернувшись, она растёт
    // вправо, и её середина уезжает от места, куда слетались точки.
    this.center = [
      (r.left + dotPx / 2) / window.innerWidth,
      (r.top + r.height / 2) / window.innerHeight,
    ];
  }

  get target(): [number, number] {
    return this.center;
  }

  update() {
    // Плашка встаёт, когда сборка кончилась. Тогда же сцена снимает метки —
    // порог один на оба конца подмены, второе число здесь разъехалось бы.
    const on = state.gather >= 1;
    if (on !== this.on) {
      this.on = on;
      this.el.classList.toggle('is-on', on);
    }

    // Финальный экран закрывает сцену: счётчик к нему уже не относится, и
    // коралловое пятно поверх светлой заливки читается забытым элементом.
    // Гаснет отдельным классом, а не снятием is-on: вход обязан остаться
    // мгновенной подменой метки, уход — плавным.
    const gone = state.outroWipe > 0.25;
    this.el.classList.toggle('is-gone', gone);

    const open = state.phase === Phase.Legends && state.legendIndex >= 0;
    if (open !== this.open) {
      this.open = open;
      this.el.classList.toggle('is-open', open);
    }

    const n = state.legendIndex + 1;
    if (n > this.shown) {
      this.shown = n;
      this.count.textContent = String(n);
      // перезапуск анимации: без снятия класса и чтения layout браузер видит
      // то же состояние и второй раз её не играет
      this.count.classList.remove('is-bump');
      void this.count.offsetWidth;
      this.count.classList.add('is-bump');
    }
  }
}
