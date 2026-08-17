/**
 * Пятно-окно в тумане (ТЗ 1.2).
 *
 * Три поведения одним объектом: догоняет курсор с инерцией, подтягивается к
 * светлячку при наведении, а после 3.5 секунд покоя уходит гулять само по кривой
 * между точками — то же решение закрывает тач-устройства, где курсора нет.
 */

import { state, type Point } from './state';

const LERP = 0.06;            // ТЗ 1.2: без отставания пятно выглядит приклеенным
const IDLE_AFTER = 3500;      // мс покоя до автономного режима
const R_BASE = 0.18;          // 18 vmin
const R_HOVER = 0.50;         // при наведении окно распахивается заметно шире
const SAT_COUNT = 3;

type Sat = { x: number; y: number; r: number; lag: number };

export class Blob {
  x = 0.5;
  y = 0.5;
  r = R_BASE;
  /** 0 — шум в полную силу, 1 — пятно успокоилось у точки */
  calm = 0;
  sats: Sat[] = [];

  private lastMove = 0;
  private targetX = 0.5;
  private targetY = 0.5;
  private drift = 0;
  private from = 0;
  private to = 1;
  /** цель автономного дрейфа в UV канваса — на экран её переводит сцена */
  private auto: [number, number] | null = null;

  constructor(private points: Point[]) {
    for (let i = 0; i < SAT_COUNT; i++) {
      this.sats.push({ x: 0.5, y: 0.5, r: R_BASE * (0.34 + i * 0.1), lag: 0.02 + i * 0.012 });
    }
    this.lastMove = -IDLE_AFTER;
  }

  /** Курсор двигался — выходим из автономного режима. */
  pointer(x: number, y: number, now: number) {
    this.targetX = x;
    this.targetY = y;
    this.lastMove = now;
  }

  /**
   * Кривая между двумя точками: пятно не телепортируется, а переползает.
   * Точка выбирается не случайно, а следующая по списку — иначе на коротком
   * простое пятно дёргается между двумя соседями.
   */
  private autonomous(dt: number) {
    const pts = this.points;
    if (!pts.length) return;
    this.drift += dt * 0.09;
    if (this.drift >= 1) {
      this.drift = 0;
      this.from = this.to;
      this.to = (this.to + 1) % pts.length;
    }
    const a = pts[this.from].canvas;
    const b = pts[this.to].canvas;
    const t = this.drift * this.drift * (3 - 2 * this.drift);
    // прогиб поперёк отрезка, чтобы траектория не была прямой линией
    const nx = -(b[1] - a[1]);
    const ny = b[0] - a[0];
    const bow = Math.sin(t * Math.PI) * 0.12;
    this.auto = [a[0] + (b[0] - a[0]) * t + nx * bow,
                 a[1] + (b[1] - a[1]) * t + ny * bow];
  }

  update(dt: number, now: number, hovered: Point | null, screenOf: (p: [number, number]) => [number, number]) {
    state.idle = now - this.lastMove > IDLE_AFTER;
    if (state.idle) this.autonomous(dt);
    else this.auto = null;

    // магнетизм: пятно не остаётся под курсором, а садится на точку и успокаивается
    // Цель автономного дрейфа задана в UV канваса и обязана пройти тот же
    // пересчёт, что и точки: иначе пятно гуляет мимо огней.
    const [ax, ay] = this.auto ? screenOf(this.auto) : [this.targetX, this.targetY];
    let tx = ax;
    let ty = ay;
    let calmTarget = 0;
    let rTarget = R_BASE;
    if (hovered) {
      const [sx, sy] = screenOf(hovered.canvas);
      tx = sx;
      ty = sy;
      calmTarget = 0.75;
      rTarget = R_HOVER;
    }

    const k = 1 - Math.pow(1 - LERP, dt * 60);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    this.r += (rTarget - this.r) * k * 2.4;   // раскрытие быстрее, чем ход пятна
    this.calm += (calmTarget - this.calm) * k * 1.4;

    let px = this.x;
    let py = this.y;
    for (const s of this.sats) {
      const sk = 1 - Math.pow(1 - s.lag, dt * 60);
      s.x += (px - s.x) * sk;
      s.y += (py - s.y) * sk;
      px = s.x;
      py = s.y;
    }
  }

  /** Радиус для фазы раскрытия: пятно перестаёт слушать курсор и растёт на экран. */
  revealRadius(reveal: number) {
    return this.r + reveal * 2.4;
  }
}
