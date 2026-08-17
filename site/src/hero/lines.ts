/**
 * Разбивка текста на строки — под построчный стаггер входа.
 *
 * Подключена в сцене «О территории» (`TerritoryStory.astro`): там строки уходят
 * и приходят под маской. В карточке легенды построчного хода нет — заказчик его
 * убрал, карточка входит целыми блоками.
 *
 * Строка здесь не абзац и не элемент разметки, а то, что реально сложил
 * переносами браузер: анимировать нужно именно её. Поэтому разбивка идёт
 * измерением — слова оборачиваются, читаются их `top`, и соседи с одним `top`
 * собираются в строку. Из этого следует, что она привязана к ширине: та же
 * карточка на другой ширине ломается на другое число строк, поэтому результат
 * помечается шириной и на ресайзе пересобирается.
 *
 * Узла на строку два, и второй обязателен: маска и то, что под ней едет, — это
 * разные элементы. `.line` держит `overflow`, `.line__in` двигается; один узел
 * не может одновременно обрезать себя и уезжать из себя. Уровень всегда один и
 * тот же, даже когда блок входит целиком, — потребителю нужна одна структура, а
 * не две с проверкой.
 *
 * Исходная разметка блока сохраняется до первой разбивки: пересобирать строки
 * из уже разложенных строк нельзя — переносы предыдущего прохода застынут в
 * тексте и на узком экране дадут строку в одно слово.
 */

/** исходный HTML блока — до того, как его разложили на строки */
const source = new WeakMap<HTMLElement, string>();
/** ширина карточки, на которой строки посчитаны в последний раз */
const doneAt = new WeakMap<HTMLElement, number>();

/** Блоки, которые разбиваются на строки, и элементы, входящие как одно целое. */
const BLOCKS = '[data-lines], [data-lines-group] p';
const WHOLE = '[data-anim]';

/** Строка: маска и уезжающий из неё текст. */
function makeLine(): { line: HTMLElement; inner: HTMLElement } {
  const line = document.createElement('span');
  line.className = 'line';
  const inner = document.createElement('span');
  inner.className = 'line__in';
  line.appendChild(inner);
  return { line, inner };
}

function splitBlock(el: HTMLElement) {
  const html = source.get(el);
  if (html === undefined) source.set(el, el.innerHTML);
  else el.innerHTML = html;

  const text = el.textContent ?? '';
  if (!text.trim()) return;

  // Вложенная разметка (ссылка, выделение) пережила бы перекладывание слов
  // порванной, поэтому такой блок входит целиком, одной «строкой». Своё
  // содержимое он при этом отдаёт внутреннему узлу: структура строки одна на
  // все случаи, иначе маска в одном месте есть, а в другом нет.
  if (el.children.length) {
    const { line, inner } = makeLine();
    inner.append(...el.childNodes);
    el.appendChild(line);
    return;
  }

  const words = text.trim().split(/\s+/);
  el.textContent = '';

  // Первый проход: каждое слово в своём span — только чтобы прочитать его `top`.
  const spans = words.map((w) => {
    const s = document.createElement('span');
    s.textContent = w;
    el.append(s, document.createTextNode(' '));
    return s;
  });

  const rows: string[][] = [];
  let top = NaN;
  spans.forEach((s, i) => {
    const t = s.getBoundingClientRect().top;
    // допуск в пиксель: у слов с разными выносными `top` совпадает не точно
    if (!(Math.abs(t - top) <= 1)) {
      rows.push([]);
      top = t;
    }
    rows[rows.length - 1].push(words[i]);
  });

  el.textContent = '';
  for (const row of rows) {
    const { line, inner } = makeLine();
    inner.textContent = row.join(' ');
    el.appendChild(line);
  }
}

/**
 * Возврат блока к исходной разметке — отмена разбивки.
 *
 * Нужен там, где сцена может выключиться уже после того, как строки посчитаны:
 * на ресайзе в низкий экран сцена «О территории» отдаёт стенд и читается
 * стопкой. Просто снять раскладку нельзя — строки лежат отдельными спанами без
 * пробелов между ними, и в обычном потоке они слиплись бы в одно слово на
 * каждом переносе.
 *
 * Пометка ширины снимается тоже: следующий `prepare` обязан посчитать строки
 * заново, а не решить, что на этой ширине уже всё сделано.
 */
export function restore(card: HTMLElement) {
  card.querySelectorAll<HTMLElement>(BLOCKS).forEach((el) => {
    const html = source.get(el);
    if (html !== undefined) el.innerHTML = html;
  });
  doneAt.delete(card);
}

/**
 * Готовит карточку к показу: строки, порядок стаггера. Повторный вызов на той же
 * ширине не делает ничего — разбивка идёт по измерению и стоит layout.
 */
export function prepare(card: HTMLElement) {
  const width = card.clientWidth;
  if (doneAt.get(card) === width) return;
  doneAt.set(card, width);

  card.querySelectorAll<HTMLElement>(BLOCKS).forEach(splitBlock);

  // Порядок хода — порядок документа: строки, дивайдер и кнопка идут сверху
  // вниз одной очередью, поэтому счётчик один на всю карточку.
  card.querySelectorAll<HTMLElement>(`.line, ${WHOLE}`).forEach((el, i) => {
    el.style.setProperty('--i', String(i));
  });
}
