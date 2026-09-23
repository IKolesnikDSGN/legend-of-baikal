/**
 * Структура сайта — один раз и здесь.
 *
 * Меню приходит из ТЗ «Главная страница + Эпишура + Конкурс»: четыре раздела и
 * основная CTA. Два раздела — будущие страницы со своими разделами внутри, и
 * эти разделы и есть раскрытие пункта по наведению: меню показывает, что будет
 * на странице, до того как на неё уйти.
 *
 * Список живёт один раз, потому что читают его трое: меню первого экрана,
 * фиксированный хедер после скролла и футер. Три копии одной структуры
 * разъехались бы на первой же правке — молча, без единой ошибки сборки.
 *
 * Страниц `/competition`, `/epishura`, `/voting`, `/project` и `/apply` ещё нет:
 * у ссылок тот же статус, что у «Подробнее» в карточке легенды. Якоря внутри них написаны
 * по разделам ТЗ, поэтому разметке страниц останется совпасть с ними id.
 */
export type NavLink = { text: string; href: string };

export type NavItem = {
  text: string;
  href: string;
  /** разделы будущей страницы: они и раскрываются по наведению */
  links?: NavLink[];
};

export const NAV: NavItem[] = [
  {
    text: 'Архитектурный конкурс',
    href: '/competition',
    links: [
      { text: 'О конкурсе', href: '/competition#about' },
      { text: 'Порт Байкал', href: '/competition#place' },
      { text: 'Конкурсная задача', href: '/competition#task' },
      { text: 'Принципы проекта', href: '/competition#principles' },
      { text: 'Участники', href: '/competition#participants' },
      { text: 'Этапы конкурса', href: '/competition#stages' },
      { text: 'Голосование', href: '/competition#voting' },
      { text: 'Что нужно для участия?', href: '/competition#how' },
      { text: 'Что получат участники?', href: '/competition#prizes' },
      { text: 'Жюри', href: '/competition#jury' },
      { text: 'Материалы', href: '/competition#materials' },
    ],
  },
  {
    text: 'Эпишура',
    href: '/epishura',
    links: [
      { text: 'Самый маленький сотрудник', href: '/epishura#employee' },
      { text: 'Знакомство с эпишурой', href: '/epishura#meet' },
      { text: 'Почему эпишура живёт только в Байкале?', href: '/epishura#endemic' },
      { text: 'Как сохранить невидимого стража?', href: '/epishura#care' },
      { text: 'Наша миссия', href: '/epishura#mission' },
      { text: 'Конкурс', href: '/epishura#competition' },
    ],
  },
  /* Голосование — будущая страница, а не блок главной: сам блок заказчик с неё
     снял (лежит в `site/backup/components/`). Раскрывать нечего — структуры
     раздела в ТЗ нет. Пункт «О проекте» снят заказчиком из самого меню; сам
     блок так и лежит в `site/backup/`, ссылка на `/project` осталась только в
     футере. */
  { text: 'Голосование', href: '/voting' },
];

/** Основная CTA хедера. Ведёт на форму, которой ещё нет. */
export const CTA: NavLink = { text: 'Подать заявку', href: '/apply' };

/** Подпись проекта в хедере — тот же леттеринг, что в футере. */
export const WORDMARK = 'Legend of Baikal';
