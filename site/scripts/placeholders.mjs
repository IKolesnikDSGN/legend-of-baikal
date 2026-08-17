/**
 * ВРЕМЕННО: фотографии-заглушки для контентных блоков.
 *
 * На странице до сих пор стояли рендеры легенд из пайплайна — единственные
 * картинки, которые в проекте есть. Пока идёт вёрстка блоков, на их месте нужны
 * обычные фотографии: рендер читается графикой, и по нему не видно ни кропа, ни
 * параллакса, ни того, как блок будет выглядеть с настоящей съёмкой.
 *
 * Файлы **не кладутся руками**: их пишет этот скрипт, и он же единственное
 * место, где записано, какая фотография куда идёт. Придёт съёмка территории —
 * скрипт и папка `public/placeholder/` удаляются целиком, а компоненты
 * возвращаются к пайплайну флагом `PHOTOS` в `src/lib/photos.ts`.
 *
 * Источник — Lorem Picsum (фотографии Unsplash, лицензия Unsplash). Кадры
 * выбраны глазами по контактному листу: ландшафты и природные объекты в
 * прохладной гамме, чтобы не спорить с темой страницы. Размер каждого запрошен
 * под своё место: портретной плашке нужен портретный кроп, иначе `object-fit`
 * срежет по краям половину кадра.
 *
 *   cd site && node scripts/placeholders.mjs         # чего нет — докачает
 *   cd site && node scripts/placeholders.mjs --force # перекачать всё
 */

import { mkdir, writeFile, access } from 'node:fs/promises';

/** name — имя файла и ключ в `src/lib/photos.ts`; id — кадр в Lorem Picsum. */
const PHOTOS = [
  // Панорама блока «О территории»: широкий кадр во всю колонку, бокс 16:9.
  // Берег с камнями и дальней грядой — единственный кадр набора, который сам
  // читается панорамой; тёплые кадры сюда не годятся, бокс идёт во всю колонку
  // и спорил бы гаммой с прохладной страницей.
  { name: 'panorama', id: 16, w: 2400, h: 1350 },

  // Ключевые объекты: пять кадров 3:2 в одной ячейке, показан один.
  { name: 'railway-shore', id: 155, w: 1400, h: 933 },
  { name: 'pier-mist', id: 172, w: 1400, h: 933 },
  { name: 'boat-water', id: 124, w: 1400, h: 933 },
  { name: 'wood-facade', id: 76, w: 1400, h: 933 },
  { name: 'reeds-lake', id: 128, w: 1400, h: 933 },

  // Закрывающая мысль: единственный портретный кадр страницы, 2:3.
  { name: 'gorge', id: 121, w: 1200, h: 1800 },

  // Голосование: два портретных кадра по бокам от текста и широкий под ним.
  // Боковые взяты разными по тону намеренно — светлый туман против тёмной воды:
  // они стоят по обе стороны одного набора, и на одинаковых пара читалась бы
  // повтором. Оба без людей и без узнаваемых мест: заглушка не должна выдавать
  // себя за конкретный берег.
  { name: 'misty-ridge', id: 1018, w: 900, h: 1350 },
  { name: 'storm-shore', id: 1019, w: 900, h: 1350 },
  { name: 'lake-pier', id: 1051, w: 1600, h: 1067 },

  // «О проекте»: маленький портретный кадр в шапке, треть колонки.
  { name: 'rock-bay', id: 1050, w: 900, h: 1200 },

  // Коллаж сцены «О территории»: шесть плашек разных пропорций, кроп по центру.
  { name: 'surf-rock', id: 179, w: 1200, h: 1200 },
  { name: 'forest-railway', id: 197, w: 1200, h: 1200 },
  { name: 'cliff-forest', id: 136, w: 1200, h: 1200 },
  { name: 'waves', id: 147, w: 1200, h: 1200 },
  { name: 'fog-alley', id: 70, w: 1200, h: 1200 },
  { name: 'snow-mountains', id: 29, w: 1200, h: 1200 },
];

const dir = new URL('../public/placeholder/', import.meta.url);
const force = process.argv.includes('--force');

await mkdir(dir, { recursive: true });

const exists = async (url) => {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
};

let saved = 0;
let kept = 0;

await Promise.all(
  PHOTOS.map(async ({ name, id, w, h }) => {
    const file = new URL(`${name}.jpg`, dir);
    if (!force && (await exists(file))) {
      kept += 1;
      return;
    }
    const src = `https://picsum.photos/id/${id}/${w}/${h}`;
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${src}: ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    saved += 1;
  }),
);

console.log(`заглушки: скачано ${saved}, уже было ${kept}, всего ${PHOTOS.length}`);
