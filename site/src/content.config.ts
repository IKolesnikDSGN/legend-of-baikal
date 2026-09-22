import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Легенды — контент, а не код (ТЗ 2.9). Правки заказчика идут через git и ребилд.
 *
 * `id` файла обязан совпадать с `id` в `LEGENDS` пайплайна: по нему карточка
 * связывается со своей точкой из `points.json`. Геометрия приходит из пайплайна,
 * текст — отсюда, и пересекаются они только по этому ключу.
 */
const legends = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/legends' }),
  schema: z.object({
    title: z.string(),
    /** одна-две строки для мини-карточки при наведении (ТЗ 1.4) */
    teaser: z.string(),
    /** объект кадра, на котором сидит точка — для aria-label и сверки с конфигом */
    object: z.string(),
    order: z.number(),
  }),
});

export const collections = { legends };
