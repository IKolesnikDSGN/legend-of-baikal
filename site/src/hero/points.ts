/**
 * Точки-легенды в DOM.
 *
 * ТЗ 2.4: сам светлячок рисует шейдер, а поверх лежит прозрачная `<button>` —
 * она нужна клавиатуре и поисковику, а не глазу. Позиция обновляется каждый кадр
 * из `scene.screenOf`, потому что точка едет вместе со своим планом: посчитать её
 * один раз в процентах нельзя, параллакс её увезёт от огня.
 */

import type { Field } from './field';
import { state, type Point } from './state';

/**
 * Отбивка плашки: от метки и от кромок свободного поля. Одно число на оба
 * случая — плашка, отодвинутая от метки на 1.5rem и прижатая к тексту вплотную,
 * читалась бы приклеенной к чужой строке.
 */
const CARD_GAP = 1.5;

export type Hit = { point: Point; el: HTMLButtonElement };

export class Points {
  hits: Hit[] = [];
  private card: HTMLElement;
  /** свободное поле кадра: за его кромки плашка не выходит — см. `cardY` */
  private field: Field | null = null;
  /** отбивка в пикселях; rem меняется только с корневым кеглем, то есть на resize */
  private gap = 0;
  /** отложенное `hidden`: ждёт, пока доиграет затухание */
  private hide: ReturnType<typeof setTimeout> | undefined;

  constructor(
    /* Слой нужен только на сборке — кнопки в него класть и мини-плашку в нём
       найти; полем класса он не становится, за позиции отвечает `hits`. */
    layer: HTMLElement,
    private points: Point[],
    private teasers: Record<string, string>,
  ) {
    this.card = layer.querySelector<HTMLElement>('[data-mini]')!;

    points.forEach((p, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'hero__hit';
      el.dataset.id = p.id;
      el.setAttribute('aria-label', `${p.title ?? p.id}. ${p.object ?? ''}`.trim());
      el.addEventListener('pointerenter', () => this.enter(p, i));
      el.addEventListener('pointerleave', () => this.leave(p));
      el.addEventListener('focus', () => this.enter(p, i));
      el.addEventListener('blur', () => this.leave(p));
      el.addEventListener('click', () => {
        // ТЗ 2.10: нажатие уводит к легенде, фокус уезжает на её карточку
        document.getElementById(`legend-${p.id}`)?.scrollIntoView({ behavior: 'smooth' });
      });
      layer.appendChild(el);
      this.hits.push({ point: p, el });
    });
  }

  /**
   * Номер легенды — порядок точки в points.json. Он же номер её карточки:
   * порядок в манифесте и `order` в контенте — одна и та же нумерация, и
   * второго счёта здесь заводить нельзя.
   */
  private enter(p: Point, i: number) {
    state.hover = p.id;
    clearTimeout(this.hide);
    this.card.hidden = false;
    this.card.querySelector('[data-mini-index]')!.textContent = String(i + 1).padStart(2, '0');
    this.card.querySelector('[data-mini-title]')!.textContent = p.title ?? p.id;
    this.card.querySelector('[data-mini-text]')!.textContent = this.teasers[p.id] ?? '';
    // Перезапуск раскрытия: с меткой на метку плашка обязана открыться заново,
    // а класс, возвращённый в том же кадре, анимацию не проиграет.
    this.card.classList.remove('is-in');
    void this.card.offsetWidth;
    this.card.classList.add('is-in');
  }

  private leave(p: Point) {
    if (state.hover === p.id) state.hover = null;
    this.close();
  }

  /**
   * Плашка гаснет прозрачностью, и только потом уходит из потока: `hidden`,
   * снятый сразу, обрывает затухание первым же кадром.
   */
  private close() {
    if (this.card.hidden) return;
    this.card.classList.remove('is-in');
    clearTimeout(this.hide);
    this.hide = setTimeout(() => {
      this.card.hidden = true;
    }, 200);
  }

  /**
   * Свободное поле кадра — то же, по которому сцена опускает сам кадр
   * (`field.ts`). Плашка обязана держаться его так же, как метка: она выходит
   * из метки вверх на полвысоты, и у верхних легенд это ровно строка подписей.
   */
  setField(field: Field) {
    this.field = field;
    this.gap = CARD_GAP * parseFloat(getComputedStyle(document.documentElement).fontSize);
  }

  /**
   * Где стоит середина плашки. Метка задаёт её, поле — поправляет: у маяка и
   * церкви плашка иначе легла бы на подписи первого экрана (замер на 1280×720:
   * верх плашки на 199 при тексте до 268). Сдвиг вниз, а не смена стороны:
   * плашка встаёт сбоку от метки, и уход вниз оставляет её у той же метки.
   */
  private cardY(y: number, h: number): number {
    if (!this.field) return y;
    const half = this.card.offsetHeight / 2;
    const lo = this.field.top * h + half + this.gap;
    const hi = this.field.bottom * h - half - this.gap;
    // Поле уже самой плашки бывает только на совсем низком окне: там она
    // встаёт по его середине — ближе к метке её всё равно не поставить.
    return hi < lo ? (lo + hi) / 2 : Math.min(Math.max(y, lo), hi);
  }

  /** Точка под курсором — берётся из состояния, а не из hit-теста: hover уже дал DOM. */
  hovered(): Point | null {
    return this.points.find((p) => p.id === state.hover) ?? null;
  }

  /**
   * Мини-карточка живёт только в фазе тумана (ТЗ 1.4). Курсор из кадра при
   * скролле не уходит, pointerleave не приходит — снимать её нужно явно.
   */
  dismiss() {
    if (state.hover === null && this.card.hidden) return;
    state.hover = null;
    this.close();
  }

  update(screenOf: (uv: [number, number], depth?: number) => [number, number], w: number, h: number) {
    for (const { point, el } of this.hits) {
      const [x, y] = screenOf(point.canvas, point.depth);
      const off = x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1;
      el.style.transform = `translate3d(${(x * w).toFixed(1)}px, ${(y * h).toFixed(1)}px, 0) translate(-50%, -50%)`;
      el.style.visibility = off ? 'hidden' : 'visible';
      if (state.hover === point.id && !this.card.hidden) {
        // мини-карточка встаёт со стороны, где есть место, и внутри поля кадра
        const right = x < 0.62;
        const side = right ? `${CARD_GAP}rem` : `calc(-100% - ${CARD_GAP}rem)`;
        this.card.style.transform =
          `translate3d(${(x * w).toFixed(1)}px, ${this.cardY(y * h, h).toFixed(1)}px, 0) ` +
          `translate(${side}, -50%)`;
      }
    }
  }
}
