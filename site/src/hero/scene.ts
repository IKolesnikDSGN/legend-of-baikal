/**
 * Сцена первого экрана на OGL.
 *
 * Два прохода: фуллскрин-квад с картинкой и аддитивный проход светлячков.
 * Больше ничего в кадре нет — заголовки и карточки живут в DOM поверх.
 *
 * Геометрия кадра считается здесь целиком и в одном месте: `frame()` возвращает
 * прямоугольник канваса, который видно на экране. Через него проходят и выборка
 * текстур в шейдере, и экранные позиции DOM-кнопок, поэтому кнопка не может
 * отклеиться от своего огня.
 */

import { Renderer, Program, Mesh, Triangle, Geometry, Texture, type OGLRenderingContext } from 'ogl';

import type { Field } from './field';
import { FIREFLY_FRAG, FIREFLY_VERT, QUAD_VERT, SCENE_FRAG } from './shaders';
import { state, type Manifest, type Point } from './state';
import type { Caps } from './caps';

// Фоновый рой выключен: шесть смысловых точек в нём терялись, а лишние светлые
// пятна читались как брак кадра. Константа оставлена — включается одним числом.
const SWARM_FULL = 0;
const SWARM_LITE = 0;

// Охват кадра. В тумане — ровно видимый кадр: сильнее поджимать нельзя, при 0.72
// маяк на 0.816 ширины выпадал за экран, а все шесть точек обязаны быть доступны
// с первого экрана. На раскрытии камера уходит ЗА видимый кадр, в поля: только
// так в кадр попадает вся сцена целиком. Поля дорисованы моделью и резкими быть
// не должны — кромку размывает шейдер (uEdge).
const ZOOM_FOG = 1.0;
const ZOOM_FULL = 1.12;
// Доля кадра, уходящая в расфокус по каждой кромке. Шире, чем было: на 0.07
// расфокус успевал прочитаться полосой, а не продолжением картинки.
const EDGE_SOFT = 0.11;

// Во сколько раз изгиб по глубине превышает бюджет TRAVEL.depth_bend. Он же
// задаёт, насколько дальние планы уезжают вниз сильнее ближних: смещение идёт
// по (1 − глубина), у горизонта полное, у нижней кромки нулевое.
// На 2.0 эффекта почти не видно, на 3.2 читался, но просили сильнее. 4.0 — шаг
// вверх, не доходя до 4.5, где здания и насыпь заметно тянуло. Пробовали 5.0:
// заметнее изгиб не стал, а искажение объектов — стало. Это потолок.
const BEND_GAIN = 4.0;

// Параллакс за мышью, с большим запаздыванием. 1.5% ширины было слишком много —
// мешало целиться в светлячок; 0.4% не читались вовсе. 0.9% — середина.
const MOUSE_AMP: [number, number] = [0.009, 0.0035];
const MOUSE_LERP = 0.025;

// Маска. Форму держит порог по двумерному полю, как у наплыва легенд: пятно
// рассыпается на рваные обрывки с чёткими краями, а не растушёвывается. 0.55 —
// разброс порога в долях радиуса: острова отходят примерно на полрадиуса.
// Сателлиты выключены: отстающие мелкие пятна читались как вторая маска,
// тянущаяся за первой, а не как «туман здесь реже».
const MASK_NOISE = 0.35;
const MASK_SATELLITES = false;
// Искажение системы координат в долях радиуса. Оно и делает форму хаотичной:
// без него любое количество шума по краю оставляет узнаваемый круг с бахромой.
// 1.1 — силуэт не читается овалом ни в одном кадре, но дыра остаётся одной
// дырой и не рассыпается на несвязные куски.
const MASK_WARP = 1.1;
/**
 * Границы перехода маски в долях радиуса. Ширина 0.09 — это 15% от исходных
 * 0.60: край режется, но не бритвой, немного мягкости в нём осталось.
 */
const MASK_EDGE: [number, number] = [0.955, 1.045];

// Свет от точки под курсором. Радиус берётся от пятна-маски, а не задаётся сам
// по себе: свет обязан быть шире открытого окна, иначе он в нём и тонет.
const SPOT_R = 1.45;
/** лерп включения света: мгновенное притемнение экрана читается как сбой */
const SPOT_LERP = 0.07;
// Форграунд под маской — двухцветная калька: фон и выворотка тёмной темы.
// Тема названа здесь одним словом, цвета приходят из её токенов.
const FOG_THEME = 'brand';
// Плотность кальки: сквозь неё едва проступает сам кадр, кромка леса и вода
// перестают быть плоской заливкой.
const FOG_ALPHA = 0.75;
// Верх кадра уходит в чистый фон под заголовок: x — докуда, в долях высоты
// экрана (к куполу церкви растворение закончилось), y — сколько плотности форм
// остаётся у самой кромки. В ноль гасить нельзя: дальняя гряда там пропадает
// совсем, и верх кадра становится пустой заливкой.
const FOG_TOP: [number, number] = [0.42, 0.3];
// Докуда сверху калька уходит в расфокус, в долях высоты экрана: до первой
// гряды верхушек. Сам размытый уровень готовит пайплайн — `OUTLINE_SOFT`.
const FOG_BLUR = 0.45;
// Подмес светлого у самой кромки кадра. Кромка — размытое продолжение картинки,
// светлеющее к краю; на 0.85 она обрывалась в белое поле, на нуле низ кадра
// уходил в тёмную воду. Сила идёт по квадрату, так что в середине зоны подмес
// вчетверо меньше этого числа.
const RIM_LIGHT = 0.5;
// Кадр опущен относительно центра канваса: сверху нужно место под хедер и
// заголовок, и линия дальних гряд обязана уйти под них. В долях полувысоты
// окна, чтобы сдвиг не менялся с охватом.
//
// Это пол, а не готовый сдвиг: настроенное заказчиком положение кадра, ниже
// которого его не поднимают. Насколько кадр опускается на самом деле, решает
// свободное поле (`field.ts`) — см. `fogDrop`.
const FRAME_DROP = 0.16;

// Запас между меткой и кромкой текста, в долях высоты экрана. Радиус метки и её
// ход за курсором считаются отдельно и сюда не входят: это именно отбивка, и
// она того же порядка, что отбивки шкалы — 0.01 на 900 даёт 9 px.
const DOT_CLEAR = 0.01;

// Метка легенды: диаметр в долях высоты экрана. По макету 24 px на 944 —
// круг обязан быть мишенью, в которую целятся, а не точкой.
const DOT_SIZE = 0.026;
// Наведение: x — во сколько раз ужимается метка, y — ширина мягкого края в
// долях радиуса. Метка отходит на второй план, вперёд выходит сам огонь.
const DOT_HOVER: [number, number] = [0.62, 0.55];
/** лерп наведения: скачок читается как подмена картинки, а не как отклик */
const DOT_LERP = 0.12;
// Кольцо-радар вокруг метки: x — докуда уходит волна, y — её толщина, оба в
// радиусах метки; z — яркость. 2.6 радиуса — кольцо заметно отходит от кружка,
// но соседние метки своими волнами не пересекаются. Яркость вполнакала: кольцо
// в полный цвет читается второй меткой, а не следом от первой.
const DOT_RING: [number, number, number] = [2.6, 0.45, 0.9];
/**
 * Разброс сборки по времени, в долях её хода. Шесть точек, стартующих разом,
 * летят строем; с разбросом кадр забирает их по одной.
 */
const GATHER_STAGGER = 0.35;

// Тень палитры #004995. Один источник и для фона канваса, и для притемнения:
// два одинаковых числа в разных местах рано или поздно разъезжаются.
const PALETTE_SHADOW: [number, number, number] = [0.0, 0.286, 0.584];

// ── вход ─────────────────────────────────────────────────────────────────────
// Две отсечки на одном ходе `state.enter`: докуда проступает калька и откуда
// начинает расти пятно. Перекрытие оставлено намеренно — окно трогается, пока
// формы ещё доходят, иначе между шагами появляется пауза на ровном месте.
const ENTER_FOG = 0.55;
const ENTER_HOLE = 0.35;

// ── фаза 3, наплыв легенд ────────────────────────────────────────────────────
// Разброс фронта по высоте экрана. Фронт — порог по двумерному полю, а не линия:
// на 0.85 острова проступают примерно на треть экрана выше основной массы, как
// на референсе. Меньше — фронт схлопывается в кромку, больше — рассыпается в
// крапину, и наплыв перестаёт читаться направлением.
const TEAR = 0.85;
// Запас кадра легенды под изгиб и параллакс. За краем текстура тянется последним
// пикселем, и изгиб размазал бы его полосой поперёк экрана.
const LEGEND_INSET = 0.90;
// Нахлёст: недоехавший кадр стоит ниже своего места и поднимается к нулю.
const LEGEND_SLIDE = 0.022;
// Какую долю слота легенды занимает наплыв. Переход рисует скролл: фронт идёт
// ровно настолько, насколько прокручено. Растянуть его на весь слот нельзя —
// кадр тогда не стоит на месте ни мгновения и прочитать его нечем.
const WIPE_SHARE = 0.35;
// Кадр легенды подтягивается снизу вверх за свой слот прокрутки — иначе он
// стоит колом, пока карточка ползёт.
const LEGEND_DRIFT = 0.030;
// Во сколько раз кадр легенды гнётся сильнее бюджета. Мастер держит 3.2 на весь
// ход камеры, легенде хватает меньшего: она живёт один экран.
const LEGEND_BEND = 1.8;
// Насколько уходящий слой уводится в тень палитры к концу наплыва. Работает и
// под первой легендой: мастер-кадр — такой же нижний слой. К единице тянуть
// незачем — на этом конце нижний слой уже накрыт целиком.
const LEGEND_DIM = 0.5;

// ── финальный экран ──────────────────────────────────────────────────────────
// За последней легендой тем же наплывом открывается страница: фронт снимает
// канвас в прозрачность, и в дыру видно секцию «О территории», которая весь
// финальный слот поднимается снизу обычным скроллом. Своего цвета у финала
// поэтому нет — ни токена, ни числа: фон и текст приносит DOM.
//
// Своё зерно поля. Совпади оно с зерном последней легенды (5 × 0.37 = 0.85), и
// финальный фронт пошёл бы по её же рвани — второй раз тем же контуром.
const OUTRO_SEED = 0.53;
// Насколько кадр последней легенды уезжает вверх, пока идёт наплыв, в UV
// канваса. Скролл на финале не прерывается: старый экран уходит вверх, новый
// подтягивается снизу, а маска рисует стык между ними.
//
// Потолок задан запасом самого кадра, а не на глаз: `LEGEND_INSET` оставляет
// под нижней кромкой окна около 0.14 канваса на самой узкой ходовой пропорции,
// и из них 0.015 уже съедает подтяжка слота. За этой границей пойдёт тянущийся
// последний пиксель текстуры. 0.11 — примерно восьмая часть высоты экрана: ход
// читается уходом секции, а не дрожанием кадра.
const OUTRO_LIFT = 0.11;

type Rect = { cx: number; cy: number; hw: number; hh: number; band: number };  // band оставлен на случай кашетирования, сейчас всегда 1

function load(gl: OGLRenderingContext, src: string, opts: Partial<Texture> = {}) {
  const tex = new Texture(gl, {
    generateMipmaps: false,
    wrapS: gl.CLAMP_TO_EDGE,
    wrapT: gl.CLAMP_TO_EDGE,
    ...opts,
  } as any);
  return new Promise<Texture>((res, rej) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      tex.image = img;
      res(tex);
    };
    img.onerror = () => rej(new Error(`не загрузилось: ${src}`));
    img.src = src;
  });
}

/**
 * Цвет токена темы, в 0..1 для шейдера.
 *
 * Читается через `color` на пробнике с нужной темой, а не как значение
 * кастомного свойства: свойство вернуло бы `var(--dark-blue)`, а `color` —
 * уже вычисленный `rgb(...)`. Числа в сцене не живут: калька — это фон и
 * выворотка, и они обязаны меняться вместе с палитрой.
 */
function themeRgb(name: string, theme: string): [number, number, number] {
  const probe = document.createElement('span');
  probe.setAttribute('data-theme', theme);
  probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const parsed = getComputedStyle(probe).color.match(/[\d.]+/g);
  probe.remove();
  if (!parsed || parsed.length < 3) throw new Error(`не читается токен ${name}`);
  return [+parsed[0] / 255, +parsed[1] / 255, +parsed[2] / 255];
}

/** Детерминированный генератор: рой должен быть одинаковым между перезагрузками. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Scene {
  private renderer!: Renderer;
  private gl!: OGLRenderingContext;
  private quad!: Mesh;
  private flies!: Mesh;
  private base: Rect = { cx: 0.5, cy: 0.5, hw: 0.5, hh: 0.5, band: 1 };
  private aspect = 1.6;
  /** к какой точке подъезжает камера в фазе легенд */
  private focus: Point | null = null;
  private focusAmount = 0;
  /** экранные UV точек, пересчитываются каждый кадр */
  private flyPos!: Float32Array;
  private flyDepth!: Float32Array;
  private flySource: [number, number][] = [];
  /** 0..1 наведения по каждой точке, с лерпом: скачок читается как подмена */
  private flyHot!: Float32Array;
  /** курсор с большим запаздыванием: движение должно догонять, а не дёргаться */
  private mouse: [number, number] = [0, 0];
  /**
   * Куда слетаются метки на раскрытии, в UV экрана. Место назначает DOM —
   * плашка счётчика стоит по общей колонке страницы, и её положение сцена
   * читает, а не считает: посчитанное вторым разом разъедется с колонкой.
   */
  private gatherTarget: [number, number] = [0.08, 0.5];
  /**
   * Свободное поле кадра: полоса между текстом первого экрана и подписью к
   * карте. Приходит из DOM по той же причине, что и место плашки счётчика, —
   * высоту текста держат текучие токены, и вторым счётом её не угадать.
   */
  private field: Field | null = null;
  /**
   * Крайние метки по вертикали канваса и разнос между ними. Считаются один раз
   * из тех же `points.json`, по которым стоят сами метки: второй список точек
   * здесь разъехался бы с первым молча.
   */
  private topCv = 0;
  private lowCv = 1;
  private spanCv = 0;
  /** включение света от точки, с лерпом */
  private spot = 0;
  /** кадры легенд: грузятся по мере подхода скролла, до загрузки слот пустой */
  private legendTex: (Texture | null)[] = [];
  private legendLoading: boolean[] = [];
  private legendWidth = 1024;
  /** заглушка в пустой слот: OGL не переживает undefined в сэмплере */
  private blank!: Texture;
  /** легенда, которую показывает наплыв; −1 — ещё мастер-кадр */
  private cur = -1;
  /** что лежит под наплывом; −1 — мастер-кадр */
  private prev = -1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly manifest: Manifest,
    readonly points: Point[],
    readonly caps: Caps,
  ) {}

  async init() {
    this.renderer = new Renderer({
      canvas: this.canvas,
      dpr: this.caps.dpr,
      // Альфа нужна ровно финалу: фронт последнего наплыва снимает кадр в
      // прозрачность, и в дыру видно секцию страницы под сценой. Всё остальное
      // время канвас непрозрачен целиком — шейдер отдаёт альфу 1.
      alpha: true,
      antialias: false,
      // сцена не читает свой предыдущий кадр, буфер можно не сохранять
      premultipliedAlpha: false,
    });
    const gl = (this.gl = this.renderer.gl);
    // поле вокруг кашетированной полосы — тень палитры #004995, не чёрный
    gl.clearColor(...PALETTE_SHADOW, 1);

    const cv = this.points.map((p) => p.canvas[1]);
    this.topCv = Math.min(...cv);
    this.lowCv = Math.max(...cv);
    this.spanCv = this.lowCv - this.topCv;

    const t = this.caps.tier;
    const f = this.caps.format;
    // Форграунд идёт своим форматом: калька лежит в его альфе, а AVIF с альфой
    // поддержан не везде — ту же причину пайплайн держит и для кадров легенд.
    const ff = this.manifest.fogFormat;
    const [p1, p2, p3, fog, depth, noise] = await Promise.all([
      load(gl, `/kv/plates/p1-far-${t}.${f}`),
      load(gl, `/kv/plates/p2-mid-${t}.${f}`),
      load(gl, `/kv/plates/p3-near-${t}.${f}`),
      load(gl, `/kv/plates/fog-${t}.${ff}`),
      load(gl, '/kv/maps/depth-emission.webp'),
      load(gl, '/kv/sprites/noise.png', { wrapS: gl.REPEAT, wrapT: gl.REPEAT }),
    ]);

    // кадры легенд грузятся лениво, но сэмплер обязан быть связан с первого
    // кадра: пустой юнит в WebGL — это ошибка компоновки, а не чёрный пиксель
    this.blank = new Texture(gl, { image: new Uint8Array([0, 0, 0, 128]), width: 1, height: 1 });
    this.legendTex = this.manifest.legends.map(() => null);
    this.legendLoading = this.manifest.legends.map(() => false);
    const lw = [...(this.manifest.legendWidths ?? [1024])].sort((a, b) => a - b);
    this.legendWidth = lw.filter((x) => x <= this.caps.tier).pop() ?? lw[0];

    const pp = this.manifest.planeParallax;
    const program = new Program(gl, {
      vertex: QUAD_VERT,
      fragment: SCENE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uP1: { value: p1 },
        uP2: { value: p2 },
        uP3: { value: p3 },
        uFog: { value: fog },
        uFogBg: { value: themeRgb('--bg', FOG_THEME) },
        uFogInk: { value: themeRgb('--fg-highlights', FOG_THEME) },
        uFogAlpha: { value: FOG_ALPHA },
        uFogTop: { value: FOG_TOP },
        uFogBlur: { value: FOG_BLUR },
        uFogIn: { value: 0 },
        uRim: { value: RIM_LIGHT },
        uDepth: { value: depth },
        uNoise: { value: noise },
        uFrame: { value: [0.5, 0.5, 0.5, 0.5] },
        uAspect: { value: 1.6 },
        uTime: { value: 0 },
        uBlob: { value: [0.5, 0.5] },
        uRadius: { value: 0.18 },
        uNoiseAmp: { value: MASK_NOISE },
        uMaskTime: { value: 0 },
        uWarp: { value: MASK_WARP },
        uSpot: { value: [0.5, 0.5] },
        uSpotOn: { value: 0 },
        uSpotR: { value: 0.26 },
        uShadow: { value: PALETTE_SHADOW },
        uFogMax: { value: 1 },
        uSat0: { value: [0.5, 0.5, 0.06] },
        uSat1: { value: [0.5, 0.5, 0.05] },
        uSat2: { value: [0.5, 0.5, 0.04] },
        uSatOn: { value: MASK_SATELLITES && this.caps.quality === 'full' ? 1 : 0 },
        uMouse: { value: [0, 0] },
        uMouseAmp: { value: [MOUSE_AMP[0], -MOUSE_AMP[1]] },
        uPush: { value: [0, 0] },
        uBend: { value: 0 },
        uParallax: { value: [pp.p1, pp.p2, pp.p3] },
        uReveal: { value: 0 },
        // Подсветка источников сквозь размытие выключена. Канал эмиссии резкий,
        // и добавленный поверх размытой копии он давал светящиеся силуэты
        // фигурок на переднем плане — брак, а не свечение.
        uEmission: { value: 0.0 },
        uEdge: { value: EDGE_SOFT },
        uEdgeSoft: { value: MASK_EDGE },
        uUnder: { value: this.blank },
        uOver: { value: this.blank },
        uUnderOn: { value: 0 },
        uOverOn: { value: 0 },
        uWipe: { value: 0 },
        uWipeSeed: { value: 0 },
        uTear: { value: TEAR },
        uLegendBend: { value: [0, 0] },
        uLegendInset: { value: LEGEND_INSET },
        uLegendDim: { value: LEGEND_DIM },
        uSlide: { value: [0, 0] },
        uDir: { value: 1 },
        uOutro: { value: 0 },
        uOutroSeed: { value: OUTRO_SEED },
      },
    });
    this.quad = new Mesh(gl, { geometry: new Triangle(gl), program });
    this.flies = this.buildFlies(gl);
    this.resize();
  }

  /** Инстансный квад на светлячок: точки-легенды плюс фоновый рой. */
  private buildFlies(gl: OGLRenderingContext) {
    const n = this.caps.quality === 'full' ? SWARM_FULL : SWARM_LITE;
    const [b1, b2] = this.manifest.planeBreaks;
    const pp = this.manifest.planeParallax;
    const coef = (d: number) => (d < b1 ? pp.p1 : d < b2 ? pp.p2 : pp.p3);

    const total = this.points.length + n;
    const pos = new Float32Array(total * 2);
    const seed = new Float32Array(total * 3);
    const dep = new Float32Array(total);
    const kind = new Float32Array(total);
    const par = new Float32Array(total);
    const cold = new Float32Array(total);

    this.points.forEach((p, i) => {
      pos[i * 2] = p.canvas[0];
      pos[i * 2 + 1] = p.canvas[1];
      // фаза у каждой своя: синхронное мигание читается как ошибка (ТЗ 1.3)
      seed[i * 3] = i / this.points.length;
      seed[i * 3 + 1] = 0.35 + 0.2 * ((i * 7) % 5) / 5;
      seed[i * 3 + 2] = 0.0015 + 0.001 * ((i * 3) % 4) / 4;
      dep[i] = p.depth ?? 0.2;
      kind[i] = 1;
      par[i] = coef(dep[i]);
      cold[i] = p.id === 'epishura' ? 1 : 0;
    });

    const rand = rng(20260806);
    // рой держится над водой и берегом, а не по всему канвасу: в поля он не нужен
    const { w: fw, h: fh } = this.manifest.visibleFrame;
    for (let k = 0; k < n; k++) {
      const i = this.points.length + k;
      pos[i * 2] = (1 - fw) / 2 + rand() * fw;
      pos[i * 2 + 1] = (1 - fh) / 2 + 0.25 * fh + rand() * 0.7 * fh;
      seed[i * 3] = rand();
      seed[i * 3 + 1] = 0.2 + rand() * 0.7;
      seed[i * 3 + 2] = 0.002 + rand() * 0.006;
      dep[i] = rand();
      kind[i] = 0;
      par[i] = coef(dep[i]);
      cold[i] = 0;
    }

    const anchors: [number, number][] = [];
    for (let i = 0; i < total; i++) anchors.push([pos[i * 2], pos[i * 2 + 1]]);

    const hot = new Float32Array(total);
    const geometry = new Geometry(gl, {
      position: {
        size: 2,
        data: new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      },
      aPos: { instanced: 1, size: 2, data: pos },
      aSeed: { instanced: 1, size: 3, data: seed },
      aKind: { instanced: 1, size: 1, data: kind },
      aCold: { instanced: 1, size: 1, data: cold },
      aHot: { instanced: 1, size: 1, data: hot },
    });
    this.flyPos = pos;
    this.flyDepth = dep;
    this.flySource = anchors;
    this.flyHot = hot;

    const program = new Program(gl, {
      vertex: FIREFLY_VERT,
      fragment: FIREFLY_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uAspect: { value: 1.6 },
        uTime: { value: 0 },
        uSize: { value: DOT_SIZE },
        uAttract: { value: [0.5, 0.5] },
        uAttractOn: { value: 0 },
        uFade: { value: 1 },
        uHover: { value: DOT_HOVER },
        uDot: { value: themeRgb('--accent', FOG_THEME) },
        uRing: { value: DOT_RING },
        uGather: { value: this.gatherTarget },
        uGatherAmt: { value: [0, GATHER_STAGGER] },
      },
    });
    // Обычное смешивание, не аддитивное: метка — плотный кружок своего цвета,
    // а не свечение. Аддитивный коралл на синем уходил в розовое.
    program.setBlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return new Mesh(gl, { geometry, program });
  }

  /**
   * Прямоугольник канваса, попадающий на экран.
   *
   * Кадр летит от кашетирования 2.8:1 к полному 1.6:1 — раскрытие меняет не
   * только резкость, но и охват: сначала виден узкий срез, потом вся сцена.
   * Внутри вьюпорта кадр вписывается по принципу cover, поля для этого и нужны.
   */
  private frame(reveal: number): Rect {
    const { width: W, height: H } = this.manifest.canvas;
    const { w: fw, h: fh } = this.manifest.visibleFrame;
    const vw = W * fw;
    const vh = H * fh;

    // Кадр всегда во весь экран. Раскрытие — это отъезд камеры: сначала тесный
    // план, потом весь видимый кадр целиком. Полей по бокам не бывает ни в одной
    // фазе, поэтому берём наибольший прямоугольник в пропорции вьюпорта, какой
    // помещается в видимый кадр, и в фазе тумана поджимаем его.
    let sw: number;
    let sh: number;
    if (this.aspect > vw / vh) {
      sw = vw;
      sh = vw / this.aspect;
    } else {
      sh = vh;
      sw = vh * this.aspect;
    }

    const zoom = ZOOM_FOG + (ZOOM_FULL - ZOOM_FOG) * reveal;
    sw *= zoom;
    sh *= zoom;

    let hw = sw / (2 * W);
    let hh = sh / (2 * H);

    // В тумане окно ещё и отъезжает, если метки не помещаются в свободное поле
    // между текстом и подписью к карте. К раскрытию прибавка уходит: там кадр
    // обязан быть ровно тем, что задан охватом.
    const fog = 1 - reveal;
    const widen = 1 + (this.fogWiden(hw, hh) - 1) * fog;
    hw *= widen;
    hh *= widen;

    // камера опускается — кадр целиком уходит вниз, все планы вместе
    // ход камеры ужат вдвое: на полном отъезде кадр и так подходит к краю канваса
    const camY = reveal * this.manifest.travel.camera_y * fh * 0.5;
    // Кадр опущен на экране: окно смотрит выше по канвасу. v растёт вверх
    // (текстуры с flipY), поэтому «выше по канвасу» — это плюс, тот же знак,
    // что и у камеры. На раскрытии сдвиг уходит: сцена обязана поместиться
    // целиком, а опущенный кадр срезал бы ей низ.
    const drop = this.fogDrop(hh) * fog;
    return { cx: 0.5, cy: 0.5 + camY + drop, hw, hh, band: 1 };
  }

  /**
   * Свободное поле кадра назначает разметка. Без него сцена работает по своим
   * числам: без DOM метке не с чем спорить.
   */
  setField(field: Field) {
    this.field = field;
  }

  /**
   * Запас между центром метки и кромкой текста, в долях высоты экрана: сам
   * кружок, отбивка и ход метки за курсором. Ход считается через охват — он
   * задан в UV канваса (`MOUSE_AMP`), а на экране растёт тем сильнее, чем
   * теснее окно.
   */
  private clear(hh: number): number {
    return DOT_SIZE / 2 + DOT_CLEAR + MOUSE_AMP[1] / (2 * hh);
  }

  /**
   * Сдвиг кадра, при котором точка `cv` встаёт на экране ровно в `y`.
   *
   * Обратная к `screenOf`, и обратная намеренно: та же тройка «окно — сдвиг —
   * экран», прочитанная с другого конца. Вторая формула для того же места
   * разъехалась бы с первой на первой же правке охвата.
   */
  private dropFor(cv: number, y: number, hh: number): number {
    return 0.5 - cv - (0.5 - y) * 2 * hh;
  }

  /**
   * Во сколько раз окно шире охвата в тумане.
   *
   * Метки разнесены по кадру на постоянную долю канваса (0.354 между маяком и
   * эпишурой), и на экране эта доля растёт тем сильнее, чем теснее окно: на
   * 1920×900 замер даёт 551 px разноса при свободном поле в 540. Влезть можно
   * только одним способом — отъехать, то есть показать больше канваса. Дальше
   * кромки канваса отъезжать некуда, и на этом запас кончается: поля вокруг
   * видимого кадра дают ровно 22% ширины.
   *
   * На обычных десктопных окнах прибавки нет вовсе — охват и так вмещает поле.
   */
  private fogWiden(hw: number, hh: number): number {
    const field = this.field;
    if (!field) return 1;

    const band = field.bottom - field.top - 2 * this.clear(hh);
    if (band <= 0) return 1;

    // Разнос на экране = spanCv / (2 hh), и он обязан уложиться в поле.
    const want = this.spanCv / (2 * band) / hh;
    // Кромки канваса: по бокам держим ход за курсором, сверху — ещё и сдвиг
    // кадра, иначе прибавка съела бы то самое место, ради которого она нужна.
    const wall = Math.min(
      (0.5 - MOUSE_AMP[0]) / hw,
      (0.5 - MOUSE_AMP[1]) / (1 + FRAME_DROP) / hh,
    );
    return Math.min(Math.max(1, want), Math.max(1, wall));
  }

  /**
   * Насколько кадр опущен в тумане, в UV канваса.
   *
   * Границы ставит поле, а `FRAME_DROP` выбирает место между ними: ниже нельзя,
   * пока верхняя метка не ушла из-под подписей, выше нельзя, пока нижняя не
   * наехала на подпись к карте. Настроенное заказчиком положение остаётся там,
   * где обе границы его пропускают, — а пропускают они его на всех обычных
   * окнах: замер на 1440×900 не двигает кадр вовсе.
   *
   * Замер по сетке разрешений: 1280×720 требует опустить кадр на 29 px,
   * 1366×768 — на 20, 3440×1440, наоборот, поднять на 35 — там настроенное
   * положение сажает нижнюю метку на подпись. Верх важнее низа: если поле не
   * вмещает разнос меток даже после отъезда (`fogWiden`), кадр опускается
   * настолько, насколько нужно верхней метке.
   */
  private fogDrop(hh: number): number {
    const want = FRAME_DROP * hh;
    const field = this.field;
    if (!field) return want;

    const clear = this.clear(hh);
    // за верхнюю кромку канваса окно не выходит: выборка там упирается в край,
    // и верх кадра размазало бы последним рядом пикселей
    const edge = 0.5 - hh - MOUSE_AMP[1];
    const lo = Math.max(this.dropFor(this.topCv, field.top + clear, hh), 0);
    const hi = Math.max(lo, Math.min(this.dropFor(this.lowCv, field.bottom - clear, hh), edge));
    return Math.min(Math.max(want, lo), hi);
  }

  /**
   * Размер берётся у родителя, а не у самого канваса: OGL в конструкторе
   * проставляет канвасу inline-размер 300×150, и клиентская ширина после этого
   * равна не тому, что задал CSS, а этой заглушке.
   */
  resize() {
    const box = this.canvas.parentElement ?? document.documentElement;
    const w = box.clientWidth || window.innerWidth;
    const h = box.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.aspect = w / h;
  }

  /**
   * Экранные UV точки — их читают и DOM-кнопки, и светлячки.
   *
   * Точки приходят в UV канваса с началом сверху, а выборка в шейдере идёт по
   * текстуре с flipY, где v растёт вверх. Пересчёт здесь один на всех: две
   * формулы для одного и того же места неизбежно разъезжаются.
   *
   * Шейдер сдвигает выборку на bend, значит содержимое канваса C оказывается там,
   * где выборка равна C, то есть в точке C − bend.
   */
  screenOf(canvasUv: [number, number], depth = 0.2): [number, number] {
    const r = this.base;
    const u = this.quad.program.uniforms;
    const mouse = u.uMouse.value as number[];
    const far = 1 - depth;
    const bendV = (u.uBend.value as number) * far;

    const x = canvasUv[0] - mouse[0] * MOUSE_AMP[0] * far;
    const v = 1 - canvasUv[1] - bendV - mouse[1] * MOUSE_AMP[1] * far;
    return [(x - r.cx) / (r.hw * 2) + 0.5, 1 - ((v - r.cy) / (r.hh * 2) + 0.5)];
  }

  /**
   * Всё, что нужно, чтобы нарисовать ту же дыру во второй раз, — для снимка
   * маски под тёмную копию текста. Значения берутся из юниформов, а не
   * считаются заново: часть из них ведёт магнетизм пятна, и второй расчёт
   * отстал бы от кадра.
   */
  maskState() {
    const u = this.quad.program.uniforms;
    return {
      aspect: u.uAspect.value as number,
      blob: [...(u.uBlob.value as number[])] as [number, number],
      radius: u.uRadius.value as number,
      noiseAmp: u.uNoiseAmp.value as number,
      maskTime: u.uMaskTime.value as number,
      warp: u.uWarp.value as number,
      edgeSoft: MASK_EDGE,
    };
  }

  /**
   * Диаметр метки в пикселях. Его спрашивает плашка счётчика: собранная точка
   * обязана быть ровно той же, что прилетела, иначе подмена канваса на DOM
   * читается скачком размера.
   */
  get dotPx(): number {
    const box = this.canvas.parentElement ?? document.documentElement;
    return DOT_SIZE * (box.clientHeight || window.innerHeight);
  }

  /** Куда слетаются метки. Место приходит из DOM — см. gatherTarget. */
  setGatherTarget(uv: [number, number]) {
    this.gatherTarget = uv;
  }

  /** Шум сцены: снимок маски обязан идти по той же картинке, а не по своей. */
  get noiseImage(): TexImageSource {
    return (this.quad.program.uniforms.uNoise.value as Texture).image as TexImageSource;
  }

  /** Камера подъезжает к точке легенды. Пока изображений легенд нет — это и есть фаза 3. */
  setFocus(p: Point | null, amount: number) {
    this.focus = p;
    this.focusAmount = amount;
  }

  /**
   * Кадр легенды по требованию.
   *
   * Грузить все шесть заранее — это лишние мегабайты у тех, кто до легенд не
   * доскроллит, а грузить ровно в момент показа поздно: наплыв успеет начаться
   * по пустому слоту. Поэтому слот запрашивается на кадр вперёд, а показывается
   * только когда картинка действительно доехала.
   */
  legendAt(i: number): Texture | null {
    if (i < 0 || i >= this.legendTex.length) return null;
    const ready = this.legendTex[i];
    if (ready) return ready;
    if (!this.legendLoading[i]) {
      this.legendLoading[i] = true;
      const id = this.manifest.legends[i].id;
      // только webp: глубина кадра лежит в его альфе, а AVIF с альфой
      // поддержан не везде — пайплайн его для легенд и не пишет
      load(this.gl, `/kv/legends/${id}-${this.legendWidth}.webp`)
        .then((t) => (this.legendTex[i] = t))
        .catch((e) => console.warn(e));
    }
    return null;
  }

  /**
   * Ход наплыва. Переход рисует скролл: фронт — функция прокрутки внутри слота,
   * а не отдельная анимация со своим временем.
   *
   * Отсюда всё остальное. Слои считать нечего — они выводятся из номера слота:
   * наплывает легенда слота, под ней лежит предыдущая (−1 — мастер-кадр).
   * Наплыв обратим: отмотка вверх уводит тот же фронт обратно вниз, и мастер
   * возвращается из-под первой легенды тем же движением, каким она пришла —
   * обратного перехода как отдельного случая больше нет.
   */
  advanceLegends() {
    const on = state.legendIndex >= 0;
    this.cur = on ? state.legendIndex : -1;
    this.prev = on ? state.legendIndex - 1 : -1;

    // сглаживание концов: линейный фронт стартует и тормозит рывком
    const t = on ? Math.min(1, state.legendLocal / WIPE_SHARE) : 0;
    state.legendWipe = t * t * (3 - 2 * t);
    // −1 в любом из слоёв — это мастер-кадр, а не пустота: наверх от первой
    // легенды он наплывает обратно тем же переходом
    const from = this.prev >= 0 ? 1 : 0;
    const to = this.cur >= 0 ? 1 : 0;
    state.legendCover = from + (to - from) * state.legendWipe;

    // Финальный наплыв занимает слот целиком, а не его `WIPE_SHARE`. У легенды
    // после фронта обязан стоять кадр — его для того и открывали; финалу стоять
    // нечем, за ним сразу идёт страница, и пин отпускает ровно там, где фронт
    // дошёл. Доля слота здесь была бы паузой ни на чём.
    const o = state.outroLocal;
    state.outroWipe = o * o * (3 - 2 * o);

    // Докуда снизу канвас снят гарантированно, в долях высоты экрана: тот же
    // порог, что в шейдере, взятый в худшем случае поля (`TEAR` — весь разброс
    // фронта). Ниже этой отметки кадра не остаётся ни при каком шуме.
    //
    // Своего текста и своей заливки финал больше не несёт: под дырой лежит
    // секция страницы. Число осталось замером — его печатает `check:legends`, и
    // по нему видно, открылся ли экран до верха к концу слота. Считается здесь, рядом с `TEAR`: разброс
    // фронта живёт в одном месте.
    const line = -TEAR * 0.55 + (1 + TEAR * 1.1) * state.outroWipe;
    const floor = line - TEAR * 0.5;
    state.outroRise = Math.max(0, Math.min(1, floor));
  }

  render(blob: {
    x: number; y: number; r: number; calm: number;
    sats: { x: number; y: number; r: number }[];
  }) {
    const reveal = state.reveal;
    let r = this.frame(reveal);

    if (this.focus && this.focusAmount > 0.001) {
      // Подъезд к точке: охват сжимается, точка встаёт в левую треть экрана —
      // правую занимает карточка легенды, и целиться центром прямо в огонь
      // значит спрятать его под текст.
      const a = this.focusAmount;
      const zoom = 1 - 0.28 * a;
      const hw = r.hw * zoom;
      const hh = r.hh * zoom;
      const tx = this.focus.canvas[0] + (0.5 - 0.33) * hw * 2;
      // окно обязано остаться внутри канваса: за краем текстура тянется
      // последним пикселем и даёт полосы поперёк кадра
      // запас поверх полуразмера — под сдвиг планов, который шейдер добавит уже
      // после этой границы
      const guard = Math.max(...Object.values(this.manifest.travel));
      const clamp = (v: number, half: number) =>
        Math.min(Math.max(v, half + guard), 1 - half - guard);
      r = {
        cx: clamp(r.cx + (tx - r.cx) * a, hw),
        cy: clamp(r.cy + (this.focus.canvas[1] - r.cy) * a, hh),
        hw,
        hh,
        band: r.band,
      };
    }
    this.base = r;

    const travel = this.manifest.travel;
    // Плашки друг относительно друга НЕ двигаются. Любой их сдвиг рвёт кадр:
    // граница планов идёт по кромке леса, и по обе стороны от неё лежит одна и
    // та же местность из двух разных файлов — сдвинул один, получил ступеньку.
    // Весь параллакс делает попиксельный изгиб по глубине: он непрерывный.
    const push: [number, number] = [0, 0];
    // Вход идёт двумя шагами по одному ходу: сначала на плоском фоне проступают
    // формы кальки — из расфокуса и из прозрачности, — и только потом в ней
    // открывается окно. Разом это читается одним движением, в котором ничего не
    // разобрать: и картинка, и дыра в ней приходят в один момент.
    const fogIn = Math.min(1, state.enter / ENTER_FOG);
    const open = Math.max(0, (state.enter - ENTER_HOLE) / (1 - ENTER_HOLE));
    // При нулевом радиусе маска смыкается на весь экран — туман без единой
    // дыры, то самое состояние, поверх которого стоит экран входа. Сглаживание
    // концов обязательно: пятно, стартующее линейно, выпрыгивает рывком.
    const grow = open * open * (3 - 2 * open);
    const radius = blob.r * grow + reveal * 2.4;

    const u = this.quad.program.uniforms;
    u.uFrame.value = [r.cx, r.cy, r.hw, r.hh];
    u.uAspect.value = this.aspect;
    u.uTime.value = state.time;
    u.uBlob.value = [blob.x, blob.y];
    u.uRadius.value = radius;
    // у светлячка пятно успокаивается и округляется (ТЗ 1.2)
    u.uNoiseAmp.value = MASK_NOISE * (1 - blob.calm * 0.75);
    // у светлячка гаснет и искажение: пятно обязано собраться в читаемое окно
    u.uWarp.value = MASK_WARP * (1 - blob.calm * 0.75);
    u.uMaskTime.value = state.maskTime;
    u.uFogMax.value = 1 - reveal;
    u.uFogIn.value = fogIn * fogIn * (3 - 2 * fogIn);
    u.uSat0.value = [blob.sats[0].x, blob.sats[0].y, blob.sats[0].r];
    u.uSat1.value = [blob.sats[1].x, blob.sats[1].y, blob.sats[1].r];
    u.uSat2.value = [blob.sats[2].x, blob.sats[2].y, blob.sats[2].r];
    this.mouse[0] += (state.mouse.x - this.mouse[0]) * MOUSE_LERP;
    this.mouse[1] += (state.mouse.y - this.mouse[1]) * MOUSE_LERP;
    u.uMouse.value = this.mouse;
    u.uPush.value = push;
    // Изгиб идёт по своей шкале, длиннее раскрытия: он доигрывает паузу и первый
    // экран легенды, поэтому наплыв застаёт мастер-кадр ещё в движении.
    u.uBend.value = travel.depth_bend * BEND_GAIN * state.bend;
    u.uReveal.value = reveal;

    // ── слои легенд ──────────────────────────────────────────────────────────
    // Их всегда ровно два: наплывающий и уже наплывший. Всё, что глубже, накрыто
    // целиком и в кадр не попадает.
    const wipe = state.legendWipe;
    const local = state.legendLocal;
    const over = this.legendAt(this.cur);
    const under = this.legendAt(this.prev);
    this.legendAt(this.cur + 1);                 // следующая — заранее, к своему наплыву
    u.uOver.value = over ?? this.blank;
    u.uUnder.value = under ?? this.blank;
    u.uOverOn.value = over ? 1 : 0;
    u.uUnderOn.value = under ? 1 : 0;
    u.uWipe.value = wipe;
    // своё поле у каждой легенды: один и тот же контур шесть раз подряд
    // читается как техническая маска, а не как край изображения
    u.uWipeSeed.value = this.cur < 0 ? 0 : (this.cur * 0.37) % 1;
    // Кадр подтягивается снизу вверх весь свой слот прокрутки, а сверх того
    // наплывающий стартует ещё ниже и доезжает к концу перехода. Нижний слой
    // стоит на конце своей подтяжки: к нему пришли с прошлого слота.
    // Сверх того на финале оба слоя уезжают вверх: прокрутка не останавливается
    // на последней легенде, она уходит наверх, как ушла бы любая секция.
    const lift = OUTRO_LIFT * state.outroWipe;
    u.uSlide.value = [-LEGEND_DRIFT * 0.5 - lift,
                      LEGEND_DRIFT * (0.5 - local) + LEGEND_SLIDE * (1 - wipe) - lift];
    // Направление у наплыва всегда одно, снизу вверх: назад его отматывает сам
    // скролл, уводя фронт обратно, а не встречный переход.
    u.uDir.value = 1;
    // Наплывающий кадр приезжает согнутым и распрямляется, нижний продолжает
    // гнуться дальше — так фаза 3 не встаёт колом между легендами.
    const lb = travel.depth_bend * LEGEND_BEND;
    u.uLegendBend.value = [-lb * wipe * 0.6, lb * (1 - wipe)];
    u.uOutro.value = state.outroWipe;

    // экранные позиции точек — та же функция, что ставит DOM-кнопки
    const hoverIdx = state.hover ? this.points.findIndex((p) => p.id === state.hover) : -1;
    for (let i = 0; i < this.flySource.length; i++) {
      const [sx, sy] = this.screenOf(this.flySource[i], this.flyDepth[i]);
      this.flyPos[i * 2] = sx;
      this.flyPos[i * 2 + 1] = sy;
      const want = i === hoverIdx ? 1 : 0;
      this.flyHot[i] += (want - this.flyHot[i]) * DOT_LERP;
    }
    (this.flies.geometry.attributes as any).aPos.needsUpdate = true;
    (this.flies.geometry.attributes as any).aHot.needsUpdate = true;

    const f = this.flies.program.uniforms;
    f.uAspect.value = this.aspect;
    f.uTime.value = state.time;
    // метки живут на мастер-кадре: под наплывом легенды их гасит фронт,
    // иначе они висят поверх чужой картинки точками ниоткуда
    // гасятся быстрее, чем идёт фронт: к середине наплыва их уже быть не должно
    //
    // Сборка кончилась — метки снимаются целиком: на их месте стоит плашка
    // счётчика, тот же круг того же цвета. Подмена мгновенная и без кроссфейда:
    // два полупрозрачных круга друг на друге дают разнобой альфы, то есть
    // мигание ровно там, где движение обязано быть непрерывным.
    // На входе метки проступают вместе с пятном: мишени, стоящие на закрытом
    // тумане, обещают кадр, которого ещё нет.
    f.uFade.value = state.gather >= 1 ? 0 : Math.max(0, 1 - state.legendCover * 1.8) * grow;
    f.uGather.value = this.gatherTarget;
    f.uGatherAmt.value = [state.gather, GATHER_STAGGER];
    const hov = this.points.find((p) => p.id === state.hover);
    f.uAttractOn.value = hov ? 1 : 0;
    if (hov) f.uAttract.value = this.screenOf(hov.canvas, hov.depth);

    // Свет от точки. Позиция обновляется, только пока точка есть: на уводе
    // курсора свет должен гаснуть там, где горел, а не уезжать в центр экрана.
    this.spot += ((hov ? 1 : 0) - this.spot) * SPOT_LERP;
    if (hov) u.uSpot.value = this.screenOf(hov.canvas, hov.depth);
    u.uSpotOn.value = this.spot;
    u.uSpotR.value = radius * SPOT_R;

    this.renderer.render({ scene: this.quad });
    this.renderer.render({ scene: this.flies, clear: false });
  }
}
