/**
 * Ландшафтный паттерн фона: изолинии одного поля высот с тремя вершинами.
 * При прокрутке каждый уровень уезжает вверх со своей задержкой — внутренние
 * трогаются первыми, внешние последними, — поэтому линии то расходятся, то
 * сходятся обратно.
 *
 * Поле, а не кольца вокруг центров, — и это главное решение здесь. Нижние
 * уровни обязаны перетекать друг в друга: у настоящей карты общий фундамент
 * охватывает все вершины сразу, а отдельные витки появляются только выше.
 * Замкнутыми кольцами вокруг каждого центра это не выражается вовсе — три
 * семейства пересекались бы, и «слияние» пришлось бы подделывать заливкой, то
 * есть скрывать линии, а не сливать их. Здесь слияние получается само: у суммы
 * трёх спадающих влияний низкая изолиния — одна общая кривая, высокая — три
 * отдельных.
 *
 * Профиль вершины — конус: влияние падает по прямой от единицы в центре до нуля
 * на своём радиусе. Отсюда два свойства, которых не даёт ни гаусс, ни обратный
 * квадрат. Изолинии выходят равномерными по радиусу — у нелинейного профиля они
 * сбиваются в пучки на склоне и в клубок у вершины, это было видно на первых
 * прогонах. И за подошвой поле ровно нулевое, поэтому фундамент чист без всяких
 * порогов: линий там нет, потому что нечего рисовать.
 *
 * Радиусы при этом заведомо перекрываются: сумма конусов между двумя вершинами
 * даёт общий уровень, и низкие линии обходят обе горы одной кривой. Разведи
 * вершины дальше суммы радиусов — и слияние пропадёт, останутся три отдельных
 * массива.
 *
 * Форма — гармоники по углу, которыми делится расстояние: они гнут само поле, а
 * не готовую линию, поэтому все уровни гнутся согласованно и не пересекаются от
 * искажения. Частоты внутри набора взаимно простые (иначе у формы появляется ось
 * симметрии), фазы — из сеяного генератора: случайный при каждом заходе фон
 * нельзя ни сверить скриншотом, ни обсудить с заказчиком.
 *
 * Своего слушателя скролла здесь нет намеренно — рядом с Lenis он был бы вторым
 * и на каждый кадр. Прогресс снимается в кадре rAF из `getBoundingClientRect`, а
 * цикл заведён только пока секция в зоне видимости: `IntersectionObserver` его
 * включает и гасит. Кадр без изменения прогресса не перерисовывается вовсе.
 *
 * Поле считается один раз на размер, а не каждый кадр. Сдвиг уровня — это чистый
 * перенос по вертикали, поэтому марш идёт по той же сетке, а сдвиг прибавляется
 * уже к экранным координатам: пересчитывать поле или интерполировать строки не
 * нужно ни разу.
 *
 * Цвет линии — токен темы (`--muted-tertiary`), снятый с самого канваса:
 * вписанный сюда цвет не переживёт смену `data-theme` и не сообщит об этом
 * ошибкой.
 */

/* Геометрия — art-direction, поэтому числами и в одном месте. Всё в долях
   канваса: рисунок обязан читаться одинаково на 390 и на 1920. */
const PEAKS = [
  // Центр в долях канваса, радиус — в долях полусуммы сторон, вес — вклад в поле.
  // Часть центров за кромкой: у карты линии уходят за край листа, а полностью
  // попавшая в кадр вершина читается мишенью.
  { cx: 0.2, cy: 0.3, r: 0.45, a: 1, harm: [2, 3, 5, 7], amp: 0.3 },
  { cx: 0.76, cy: 0.66, r: 0.4, a: 0.92, harm: [3, 4, 7, 9], amp: 0.26 },
  { cx: 0.46, cy: 1.08, r: 0.355, a: 0.85, harm: [2, 5, 8, 11], amp: 0.34 },
];
/* Веса гармоник: первая гнёт форму крупно, последняя добавляет мелкую рябь.
   Общие для всех вершин — разные у них частоты и общая амплитуда. Нормированы
   суммой (см. `HARM_SUM`): без нормировки амплитуда искажения зависит от числа
   гармоник, и добавленная пятая молча ломала бы форму всех вершин. */
const HARM_W = [1, 0.55, 0.28, 0.14];
const HARM_SUM = HARM_W.reduce((a, b) => a + b, 0);
const SQUASH = 0.86; // сжатие поля по вертикали: линии шире, чем выше

/* Уровни идут равным шагом по значению, и при конусном профиле это и означает
   равные промежутки между линиями на экране.

   Нижний уровень не нулевой намеренно: фундамент — то, чем горы перетекают друг
   в друга, — линиями не рисуется вовсе. Линии живут по склонам, между массивами
   чисто, а слияние видно на самой нижней нарисованной линии: там, где две горы
   близко, она обходит их одной кривой. Опусти уровень к нулю — и канвас затянет
   линиями по всей площади, склоны в них потеряются. */
const LEVELS = 18; // изолиний
const LEVEL_LO = 0.17; // нижняя линия, в долях максимума поля
const LEVEL_HI = 0.99; // верхняя — та, что обводит саму вершину
const GRID = 14; // шаг сетки поля, px — он же грубость линии

/* Параллакс. Все уровни проходят один и тот же путь вверх (LIFT, доля высоты
   канваса), но трогаются в разное время: внутренний первым, фундамент последним —
   это и есть задержка. Ходы расходятся к середине прокрутки и сходятся к концу.

   Разные скорости вместо задержки пробовали: внутренний уровень уезжает от своего
   поля навсегда, к концу блока пересекает внешние, и стопка превращается в кашу,
   которая обратно уже не собирается. */
const LIFT = 0.13;
const DELAY = 0.4; // какую долю хода занимает разброс по времени

const LINE = 1; // px
const INDEX_EVERY = 6; // каждая шестая линия толще — так читаются карты высот
const INDEX_LINE = 1.6;

const DPR_MAX = 2; // выше двух разницы не видно, а пикселей вчетверо больше
const TAU = Math.PI * 2;

/** Сглаженный 0…1: концы хода без рывка, за пределами — держит крайнее. */
function smooth01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Сеяный генератор: рисунок обязан быть одним и тем же при каждой загрузке. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type TopoHandle = { destroy(): void };

export function initTopo(canvas: HTMLCanvasElement): TopoHandle {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { destroy() {} };

  const rand = mulberry32(0x1eb0a1);
  const phases = PEAKS.map((p) => p.harm.map(() => rand() * TAU));

  let w = 0;
  let h = 0;
  let line = '';
  let last = -1;
  let frame = 0;
  let visible = false;

  // Поле: сетка значений и её геометрия. Снизу у сетки запас на весь ход — иначе
  // уехавшему вверх уровню нечем рисоваться у нижней кромки кадра.
  let cols = 0;
  let rows = 0;
  let top = 0;
  let field = new Float32Array(0);
  let levels: number[] = [];

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function buildField(): void {
    // Радиусы считаются от полусуммы сторон, а не от меньшей: на узком высоком
    // канвасе меньшая сторона — ширина, конусы сжимаются вместе с ней и подошва
    // занимает почти весь экран, то есть линий на нём почти нет.
    const scale = (w + h) / 2;
    const lift = h * LIFT;
    // Запас у сетки — вниз, а не вверх, и это не вкус: уровень рисуется сдвинутым
    // вверх, то есть нижней кромке экрана соответствует строка поля на `lift`
    // ниже неё. Запас вверх оставлял внизу блока полосу без линий во всю ширину —
    // рисунок читался откусанным.
    top = -GRID;
    cols = Math.ceil(w / GRID) + 2;
    rows = Math.ceil((h + lift - top) / GRID) + 2;
    field = new Float32Array(cols * rows);

    for (let r = 0; r < rows; r += 1) {
      const y = top + r * GRID;
      for (let c = 0; c < cols; c += 1) {
        const x = c * GRID;
        let v = 0;
        for (let i = 0; i < PEAKS.length; i += 1) {
          const p = PEAKS[i];
          const dx = x - p.cx * w;
          const dy = (y - p.cy * h) / SQUASH;
          const d = Math.sqrt(dx * dx + dy * dy);
          const t = Math.atan2(dy, dx);
          let g = 0;
          for (let j = 0; j < p.harm.length; j += 1) {
            g += HARM_W[j] * Math.sin(p.harm[j] * t + phases[i][j]);
          }
          // Гармоники делят расстояние, то есть гнут само поле: все уровни
          // гнутся согласованно и от искажения не пересекаются.
          const q = d / (p.r * scale * (1 + p.amp * (g / HARM_SUM)));
          if (q < 1) v += p.a * (1 - q);
        }
        field[r * cols + c] = v;
      }
    }

    // Шкала считается от максимума самого поля, а не от суммы весов вершин: в
    // точке, где конусы перекрываются, значение выше веса любой из них, и по
    // сумме верхние линии оказались бы за пределами рисунка.
    let max = 0;
    for (let i = 0; i < field.length; i += 1) if (field[i] > max) max = field[i];
    levels = Array.from({ length: LEVELS }, (_, k) => {
      const t = LEVELS > 1 ? k / (LEVELS - 1) : 0;
      return max * (LEVEL_LO + (LEVEL_HI - LEVEL_LO) * t);
    });
  }

  /** Марш по клеткам: изолиния уровня, сдвинутая по экрану на dy. */
  function contour(level: number, dy: number): void {
    // Видимая полоса поля для этого уровня: считать остальное незачем.
    const r0 = Math.max(0, Math.floor((-dy - top) / GRID) - 1);
    const r1 = Math.min(rows - 2, Math.ceil((h - dy - top) / GRID) + 1);

    for (let r = r0; r <= r1; r += 1) {
      const yA = top + r * GRID + dy;
      const yB = yA + GRID;
      const row = r * cols;
      const next = row + cols;

      for (let c = 0; c < cols - 1; c += 1) {
        const xA = c * GRID;
        const xB = xA + GRID;

        const v00 = field[row + c];
        const v10 = field[row + c + 1];
        const v11 = field[next + c + 1];
        const v01 = field[next + c];

        const m =
          (v00 > level ? 1 : 0) |
          (v10 > level ? 2 : 0) |
          (v11 > level ? 4 : 0) |
          (v01 > level ? 8 : 0);
        if (m === 0 || m === 15) continue;

        // Точки на рёбрах — линейная интерполяция по значению.
        const tp = (level - v00) / (v10 - v00);
        const rt = (level - v10) / (v11 - v10);
        const bt = (level - v01) / (v11 - v01);
        const lf = (level - v00) / (v01 - v00);
        const topX = xA + GRID * tp;
        const rightY = yA + GRID * rt;
        const botX = xA + GRID * bt;
        const leftY = yA + GRID * lf;

        switch (m) {
          case 1:
          case 14:
            ctx!.moveTo(xA, leftY);
            ctx!.lineTo(topX, yA);
            break;
          case 2:
          case 13:
            ctx!.moveTo(topX, yA);
            ctx!.lineTo(xB, rightY);
            break;
          case 3:
          case 12:
            ctx!.moveTo(xA, leftY);
            ctx!.lineTo(xB, rightY);
            break;
          case 4:
          case 11:
            ctx!.moveTo(xB, rightY);
            ctx!.lineTo(botX, yB);
            break;
          case 6:
          case 9:
            ctx!.moveTo(topX, yA);
            ctx!.lineTo(botX, yB);
            break;
          case 7:
          case 8:
            ctx!.moveTo(xA, leftY);
            ctx!.lineTo(botX, yB);
            break;
          // Седло: из двух вариантов соединения берётся один и тот же всегда.
          // Выбор «по значению в центре клетки» дал бы на соседних кадрах
          // разные варианты и линия мигала бы на месте.
          case 5:
            ctx!.moveTo(xA, leftY);
            ctx!.lineTo(botX, yB);
            ctx!.moveTo(topX, yA);
            ctx!.lineTo(xB, rightY);
            break;
          case 10:
            ctx!.moveTo(xA, leftY);
            ctx!.lineTo(topX, yA);
            ctx!.moveTo(botX, yB);
            ctx!.lineTo(xB, rightY);
            break;
        }
      }
    }
  }

  function draw(p: number): void {
    ctx!.clearRect(0, 0, w, h);
    ctx!.lineCap = 'round';
    ctx!.strokeStyle = line;

    for (let k = 0; k < levels.length; k += 1) {
      // k = 0 — фундамент, он трогается последним; внутренние уходят первыми.
      const t = levels.length > 1 ? k / (levels.length - 1) : 0;
      const q = smooth01((p - (1 - t) * DELAY) / (1 - DELAY));
      const dy = -q * h * LIFT;

      ctx!.beginPath();
      contour(levels[k], dy);
      ctx!.lineWidth = k % INDEX_EVERY === 0 ? INDEX_LINE : LINE;
      ctx!.stroke();
    }
  }

  /** Прогресс секции через экран — тот же диапазон, что `cover` у `view()`. */
  function progress(): number {
    const r = canvas.getBoundingClientRect();
    const span = innerHeight + r.height;
    if (span <= 0) return 0;
    return Math.min(1, Math.max(0, (innerHeight - r.top) / span));
  }

  function resize(): void {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(devicePixelRatio || 1, DPR_MAX);
    w = r.width;
    h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

    line = getComputedStyle(canvas).getPropertyValue('--muted-tertiary').trim();
    buildField();

    // Без движения паттерн стоит в середине хода: крайнее положение читалось бы
    // недоехавшим или уехавшим, а середина — законченным рисунком.
    last = reduced ? 0.5 : progress();
    draw(last);
  }

  function tick(): void {
    const p = progress();
    // Кадр без изменения прогресса не перерисовывается: паттерн — функция
    // скролла, и стоящей странице перерисовка не нужна вовсе.
    if (Math.abs(p - last) > 0.0002) {
      last = p;
      draw(p);
    }
    frame = requestAnimationFrame(tick);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // Цикл заведён только пока секция в кадре: фон целого экрана незачем считать
  // на футере. Запас в экран — чтобы паттерн доехал до появления, а не прыгнул
  // на своё место в момент, когда его увидели.
  const io = reduced
    ? null
    : new IntersectionObserver(
        ([e]) => {
          if (e.isIntersecting === visible) return;
          visible = e.isIntersecting;
          if (visible) frame = requestAnimationFrame(tick);
          else cancelAnimationFrame(frame);
        },
        { rootMargin: '100% 0px' },
      );
  io?.observe(canvas);

  return {
    destroy() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io?.disconnect();
    },
  };
}
