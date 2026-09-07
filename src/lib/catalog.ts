/**
 * Единственный источник каталога.
 *
 * Сейчас данные лежат здесь же, но компоненты обращаются к каталогу
 * ТОЛЬКО через getCatalog(). Когда каталог начнёт приходить из бота,
 * достаточно заменить тело getCatalog() на запрос к API — типы и все
 * вызывающие компоненты остаются нетронутыми.
 *
 * ЦЕН ПОКА НЕТ, и это записано явным `null`, а не рублём-заглушкой.
 * Прежде «цены ещё нет» изображалось значением 1 ₽: на экране это
 * выглядело настоящей ценой, и отличить «стоит рубль» от «мы не знаем»
 * было нельзя ни человеку, ни коду. Теперь `null` — это `null`, а
 * вписать цену значит поменять ОДНО слово в этом файле: разметка,
 * чек и вся логика выбора уже умеют и то и другое состояние.
 */

/** Способ оплаты. Сайт его не обрабатывает — значение уезжает в бот. */
export type PaymentMethod = {
  id: 'card' | 'sbp' | 'usdt';
  title: string;
  caption: string;
};

/**
 * Уровень подписки — «Pro», «Premier», «Standard».
 *
 * Это НЕ срок. Прежде тарифом был срок («1 месяц», «1 год»), и от той
 * поры остались бы поля `months` и расчёт даты доступа; их больше нет.
 * Срок подписки владелец не объявлял, а выдумывать его нельзя.
 */
export type Plan = {
  id: string;
  /** Короткая подпись на кнопке уровня: «Pro». */
  short: string;
  /** Полное название для панели заказа: «Kling AI, Pro». */
  title: string;
  /** Строка под названием: что даёт уровень. Пока не объявлена. */
  note?: string;
  /** Цена в рублях. `null` — цены ещё нет. */
  priceRub: number | null;
};

export type Product = {
  id: string;
  /** Имя продукта. Латиница здесь допустима: это имя бренда. */
  name: string;
  /** Одна строка о том, что это и кому. */
  tagline: string;
  /** Что человек получает — одной строкой на карточке. */
  note: string;
  /**
   * Уровни подписки. ПУСТО — значит уровней нет вовсе и подписка
   * одна: у Claude Pro и Seedance это так, и дорисовывать им уровень
   * ради симметрии карточек запрещено. Такой продукт покупается
   * нажатием по самой карточке.
   */
  plans: Plan[];
  /**
   * Цена самой подписки — только для продуктов БЕЗ уровней.
   * У продукта с уровнями цена лежит на уровне и это поле не читается.
   * `null` — цены ещё нет.
   */
  priceRub: number | null;
};

/** Отзыв. Пока это примеры оформления: настоящие приедут из бота. */
export type Review = {
  id: string;
  author: string;
  /** Что человек купил — короткой строкой. */
  bought: string;
  text: string;
};

export type Catalog = {
  products: Product[];
  payments: PaymentMethod[];
  /** Счётчик оформленных подписок для навигации. */
  subscribers: number;
  /**
   * Ссылка на бота. Кнопки и переходы включаются сами, когда она
   * не пуста: отдельных правок в компонентах не требуется.
   */
  botUrl: string;
  /**
   * Класть ли выбранный заказ в параметр `start` ссылки.
   *
   * СЕЙЧАС НЕТ, и это не забывчивость. Telegram передаёт боту всё,
   * что лежит в `start`, одной строкой — но обработчик `/start`
   * в боте её не читает: он здоровается и показывает список товаров.
   * То есть параметр сегодня ничего не даёт.
   *
   * Хуже того, он может навредить: пока человек вводит что-то боту
   * (незаконченный разговор разбирается РАНЬШЕ команд), текст
   * «/start tovar_…» уйдёт в этот ввод как ответ. Простое `/start`
   * бот из диалога распознаёт и отпускает человека, а `/start`
   * с довеском — уже нет.
   *
   * Включать вместе с правкой бота, не раньше. Что именно нужно
   * от бота — в CLAUDE.md, раздел про подключение бота к сайту.
   */
  botStartPayload: boolean;
  /**
   * Работает ли реферальная программа. Её в боте пока нет вовсе,
   * поэтому звать «забрать свою ссылку» некуда: это была бы не
   * заглушка, а обещание того, чего не существует.
   */
  referralReady: boolean;
  reviews: Review[];
};

/**
 * Цены, которой ещё нет. Отдельное имя, а не голый `null` по тексту:
 * так видно, что пустота здесь намеренная, и так её легче заменить.
 */
const NET_CENY = null;

/** Собрать уровни подписки одного продукта из коротких подписей. */
const urovni = (id: string, name: string, urovniSpisok: string[]): Plan[] =>
  urovniSpisok.map((short) => ({
    id: `${id}-${short.toLowerCase()}`,
    short,
    title: `${name}, ${short}`,
    priceRub: NET_CENY,
  }));

const REVIEWS: Review[] = [
  {
    id: 'r1',
    author: 'Артём',
    bought: 'Claude Pro',
    text: 'Брал, чтобы не возвращаться к этому вопросу. Доступ пришёл в боте минут через пять, зашёл со своей почты, всё на месте.',
  },
  {
    id: 'r2',
    author: 'Нина',
    bought: 'ChatGPT, Plus',
    text: 'Сначала взяла попробовать — проверить, что это не развод. Проверила, продлила. Оплатила через СБП, никаких данных карты никуда не вводила.',
  },
  {
    id: 'r3',
    author: 'Дмитрий',
    bought: 'Gemini AI, Pro',
    text: 'Нужен был доступ под рабочие задачи. Аккаунт выдали в тот же час, всё открылось с первого раза. Отдельно порадовало, что цена сразу видна и не меняется на последнем шаге.',
  },
  {
    id: 'r4',
    author: 'Соня',
    bought: 'Kling AI, Premier',
    text: 'Старший уровень вышел заметно выгоднее младшего. Написала в бот с вопросом про продление — ответили в тот же вечер.',
  },
  {
    id: 'r5',
    author: 'Павел',
    bought: 'Suno AI, Pro',
    text: 'Платил в USDT, сеть TON. Зачлось быстрее, чем я успел закрыть кошелёк.',
  },
  {
    id: 'r6',
    author: 'Марина',
    bought: 'Seedance',
    text: 'До этого покупала у перекупа в личке и потеряла деньги. Тут хотя бы понятно, за что платишь и что будет дальше.',
  },
];

const CATALOG: Catalog = {
  botUrl: 'https://t.me/neirolavka_ai_bot',
  botStartPayload: false,
  referralReady: false,
  subscribers: 2417,
  reviews: REVIEWS,
  payments: [
    { id: 'card', title: 'Карта РФ', caption: 'Любой российский банк' },
    { id: 'sbp', title: 'СБП', caption: 'Перевод по номеру телефона' },
    { id: 'usdt', title: 'USDT', caption: 'Сети TRC-20 и TON' },
  ],
  products: [
    {
      id: 'kling',
      name: 'Kling AI',
      tagline: 'Генератор видео',
      note: 'Ролики по описанию и по кадру',
      plans: urovni('kling', 'Kling AI', ['Pro', 'Premier', 'Standard']),
      priceRub: NET_CENY,
    },
    {
      id: 'suno',
      name: 'Suno AI',
      tagline: 'Генератор музыки',
      note: 'Треки по описанию, со словами и без',
      plans: urovni('suno', 'Suno AI', ['Pro', 'Premier']),
      priceRub: NET_CENY,
    },
    {
      id: 'gemini',
      name: 'Gemini AI',
      tagline: 'Ассистент Google',
      note: 'Текст, картинки и работа с документами',
      plans: urovni('gemini', 'Gemini AI', ['Plus', 'Pro', 'Ultra']),
      priceRub: NET_CENY,
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      tagline: 'Голос, картинки и привычный интерфейс',
      note: 'Старшие модели, голосовой режим, работа с изображениями',
      plans: urovni('chatgpt', 'ChatGPT', ['Plus', 'Go']),
      priceRub: NET_CENY,
    },
    {
      // Уровней нет — и это не пустое место в прайсе, а свойство
      // продукта: подписка одна. Карточка покупается нажатием
      // по ней самой.
      id: 'claude',
      name: 'Claude Pro',
      tagline: 'Полноценный ИИ-ассистент',
      note: 'Sonnet и Opus, проекты, загрузка файлов',
      plans: [],
      priceRub: NET_CENY,
    },
    {
      id: 'seedance',
      name: 'Seedance',
      tagline: 'Видео по тексту и по картинке',
      note: 'Генерация роликов, продление сцен, свои референсы',
      plans: [],
      priceRub: NET_CENY,
    },
  ],
};

/**
 * Точка подмены. Сейчас возвращает локальные данные синхронно.
 * Когда каталог поедет из бота — здесь появится fetch, сигнатура
 * станет асинхронной, а компоненты продолжат работать с теми же типами.
 */
export function getCatalog(): Catalog {
  return CATALOG;
}

/** Найти уровень подписки по идентификатору во всём каталоге. */
export function findPlan(planId: string): { product: Product; plan: Plan } | null {
  for (const product of getCatalog().products) {
    const plan = product.plans.find((p) => p.id === planId);
    if (plan) return { product, plan };
  }
  return null;
}

/** Найти продукт по идентификатору. */
export function findProduct(productId: string): Product | null {
  return getCatalog().products.find((p) => p.id === productId) ?? null;
}

/**
 * Цена выбранного: у продукта с уровнями она на уровне, у продукта
 * без уровней — на самом продукте. `null` там, где цены ещё нет.
 */
export function priceOf(product: Product, plan: Plan | null): number | null {
  return plan ? plan.priceRub : product.priceRub;
}

/**
 * Наименьшая известная цена продукта — та, что показывается строкой
 * «от N ₽» на свёрнутой карточке. `null`, пока ни одной цены нет.
 */
export function priceFrom(product: Product): number | null {
  const known = (product.plans.length ? product.plans.map((p) => p.priceRub) : [product.priceRub])
    .filter((v): v is number => typeof v === 'number');
  return known.length ? Math.min(...known) : null;
}

/** «1 ₽», «1 234 ₽» — с неразрывным пробелом перед знаком. */
export function formatPrice(rub: number): string {
  return `${rub.toLocaleString('ru-RU')} ₽`;
}
