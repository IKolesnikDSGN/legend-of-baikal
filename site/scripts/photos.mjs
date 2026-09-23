/**
 * Съёмка территории в RAW → кадры для веба.
 *
 * С карты дрона приходят DNG: 6144×4096 и 4088×3064, по 15–35 МБ штука. В
 * репозиторий они не едут (`.gitignore`), в браузер — тем более. Этот скрипт и
 * есть та стадия, которая делает из них веб-версии: руками в `public/media/`
 * не кладётся ничего, как и в остальном проекте.
 *
 *   node scripts/photos.mjs ../фотки
 *
 * Пишет два места сразу:
 *   public/media/photos/<id>-<w>.webp   кадры, по одному файлу на ширину
 *   src/data/photos.json                опись: id и размеры самого большого
 *
 * Опись нужна затем же, зачем сцене `manifest.json`: компонент не знает наизусть
 * ни имён файлов, ни пропорций. Пропорция решает, встанет кадр в сетке обычной
 * ячейкой или высокой на две строки, и брать её на глаз нельзя — половина
 * кадров приходит повёрнутой. Размеры меряются по готовому файлу, а не
 * считаются из исходника: после поворота они другие.
 *
 * Id — номер кадра из имени файла (DJI_20260727060826_0167_D → 0167). Он же имя
 * файла на фронте и ключ подписи в компоненте; второй нумерации здесь заводить
 * незачем, а порядок в сетке — это порядок съёмки.
 *
 * Все числа — здесь: вторая копия в другом месте разъедется с этой молча.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Путь к исходникам берётся от текущей директории, как у `video.mjs`:
// скрипт запускают из `site/`, и `../фотки` там означает папку в корне.
const SRC = resolve(process.cwd(), process.argv[2] ?? '../фотки');

const OUT = new URL('../public/media/photos/', import.meta.url);
const DATA = new URL('../src/data/photos.json', import.meta.url);
mkdirSync(OUT, { recursive: true });
mkdirSync(new URL('../src/data/', import.meta.url), { recursive: true });

/** Ширины вывода — именно ширины, а не длинная сторона. В сетке горизонтальный
    и вертикальный кадр стоят в колонке одной ширины, отличается только высота,
    и `srcset` браузер выбирает тоже по ширине. Длинная сторона дала бы
    вертикальному кадру полторы ширины запаса и лишние мегабайты.
    1600 — двойная плотность на колонку ~700 px при странице 1440. */
const WIDTHS = [800, 1600];

/** Промежуточный PNG: длинная сторона с запасом под самую крупную ширину
    вертикального кадра (1600 × 3/2 = 2400). Меньше — и вертикальный кадр
    пришлось бы растягивать, больше — сипс читал бы RAW вдвое дольше без
    единого лишнего пикселя на выходе. */
const PNG_MAX = 2400;

/** Качество webp. То же, что у постера видео (`video.mjs`). */
const QUALITY = 82;

/** Профиль вывода. `sips` проявляет RAW в Display P3 — замер по готовому PNG:
    `profile: Display P3`. Браузер читает webp без профиля как sRGB, и кадр без
    этой строки уходит в кислотную зелень на всём, что не Apple. */
const SRGB = '/System/Library/ColorSync/Profiles/sRGB Profile.icc';

/**
 * Поворот кадра: тег 0x0112 (orientation) из IFD0 самого DNG.
 *
 * DNG — это TIFF, и тег лежит в первой же директории. Читать его приходится
 * здесь потому, что `sips` при проявке пиксели не поворачивает, а тег переносит
 * в PNG; ffmpeg такой тег не смотрит вовсе, и вертикальный кадр лёг бы в сетку
 * боком. Замер по папке: 0017, 0123, 0156, 0207 — 1 (как снято), 0053 и 0167 —
 * 6 (на 90° по часовой).
 */
const orientation = (file) => {
  const head = readFileSync(file).subarray(0, 1 << 16);
  const le = head.toString('ascii', 0, 2) === 'II';
  const u16 = (o) => (le ? head.readUInt16LE(o) : head.readUInt16BE(o));
  const u32 = (o) => (le ? head.readUInt32LE(o) : head.readUInt32BE(o));
  const ifd = u32(4);
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return 1;
};

/** Поворот тега → фильтр ffmpeg. Дрон отдаёт только 1 и 6, но остальные три
    честных случая стоят одной строки каждый: пропущенный поворот виден не
    ошибкой, а кадром на боку. */
const TRANSPOSE = { 3: 'transpose=1,transpose=1', 6: 'transpose=1', 8: 'transpose=2' };

const run = (bin, args) => execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
const probe = (file) =>
  execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])
    .toString().trim().split(',').map(Number);
const size = (file) => `${(statSync(file).size / 1e3).toFixed(0)} КБ`;

const sources = readdirSync(SRC)
  .filter((name) => /\.dng$/i.test(name))
  .sort();

if (!sources.length) {
  console.error(`в ${SRC} нет ни одного .DNG`);
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'kv-photos-'));
const items = [];

for (const name of sources) {
  const src = join(SRC, name);
  const id = (name.match(/_(\d{4})_/)?.[1] ?? name.replace(/\.[^.]+$/, '')).toLowerCase();
  const flip = TRANSPOSE[orientation(src)];

  // Проявка RAW: единственный шаг, где читается сам DNG. Дальше работают уже с
  // PNG — ffmpeg RAW с дрона не декодирует, а sips не умеет webp.
  const png = join(tmp, `${id}.png`);
  run('sips', ['-s', 'format', 'png', '--matchTo', SRGB,
    '--resampleHeightWidthMax', String(PNG_MAX), src, '--out', png]);

  const out = [];
  for (const w of WIDTHS) {
    const file = new URL(`${id}-${w}.webp`, OUT).pathname;
    const vf = [flip, `scale=${w}:-2:flags=lanczos`].filter(Boolean).join(',');
    run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', png,
      '-vf', vf, '-frames:v', '1', '-c:v', 'libwebp', '-preset', 'photo',
      '-quality', String(QUALITY), file]);
    out.push(file);
  }

  // Размеры — с самого большого файла: после поворота они другие, чем у
  // исходника, и пропорция в описи обязана быть измеренной, а не выведенной.
  const [w, h] = probe(out[out.length - 1]);
  items.push({ id, w, h });
  console.log(`${id}  ${w}×${h}  ${out.map(size).join(' / ')}`);
}

rmSync(tmp, { recursive: true, force: true });

writeFileSync(DATA, JSON.stringify({ widths: WIDTHS, items }, null, 2) + '\n');
console.log(`\nsrc/data/photos.json — ${items.length} кадр(ов)`);
