/**
 * Единственный источник каталога.
 *
 * Сейчас данные лежат здесь же, но компоненты обращаются к каталогу
 * ТОЛЬКО через getCatalog(). Когда каталог начнёт приходить из бота,
 * достаточно заменить тело getCatalog() на запрос к API — типы и все
 * вызывающие компоненты остаются нетронутыми.
 *
 * Цены неполные: месяц стоит 1990 ₽, а всё, чего в прайсе ещё нет,
 * стоит 1 ₽ — так по всему проекту помечено «цены пока нет».
 */

/** Способ оплаты. Сайт его не обрабатывает — значение уезжает в бот. */
export type PaymentMethod = {
  id: 'card' | 'sbp' | 'usdt';
  title: string;
  caption: string;
};

/** Один тариф — срок подписки. */
export type Plan = {
  id: string;
  /** Короткая подпись на кнопке тарифа: «1 месяц», «1 год». */
  short: string;
  /** Полное название для панели заказа: «Claude Pro, 1 год». */
  title: string;
  /** Строка под названием: что именно человек получает. */
  note: string;
  /** Цена в рублях. Там, где прайса ещё нет, стоит 1. */
  priceRub: number;
  /** Срок подписки в месяцах. */
  months: number;
};

export type Product = {
  id: 'claude' | 'chatgpt' | 'seedance';
  /** Имя продукта. Латиница здесь допустима: это имя бренда. */
  name: string;
  /** Одна строка о том, что это и кому. */
  tagline: string;
  /** Что человек получает — одной строкой на карточке. */
  note: string;
  /** Тарифы. У Seedance годового нет вообще, и выдумывать его нельзя. */
  plans: Plan[];
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
  /** true, пока отзывы демонстрационные. Влияет на подпись у блока. */
  reviewsArePlaceholders: boolean;
};

/** Цена, которой ещё нет. По всему проекту такие стоят рублём. */
const NET_CENY = 1;
const MESYAC = 1990;

const plans = (id: string, name: string, year: boolean): Plan[] => {
  const list: Plan[] = [
    {
      id: `${id}-1m`,
      short: '1 месяц',
      title: `${name}, 1 месяц`,
      note: 'Продлевать самому',
      priceRub: MESYAC,
      months: 1,
    },
  ];
  if (year) {
    list.push({
      id: `${id}-1y`,
      short: '1 год',
      title: `${name}, 1 год`,
      note: 'Сразу на год, без продлений',
      priceRub: NET_CENY,
      months: 12,
    });
  }
  return list;
};

const REVIEWS: Review[] = [
  {
    id: 'r1',
    author: 'Артём',
    bought: 'Claude Pro, 6 месяцев',
    text: 'Брал на полгода, чтобы не возвращаться к этому вопросу. Доступ пришёл в боте минут через пять, зашёл со своей почты, всё на месте.',
  },
  {
    id: 'r2',
    author: 'Нина',
    bought: 'Claude Pro, 1 месяц',
    text: 'Сначала взяла на месяц — проверить, что это не развод. Проверила, продлила. Оплатила через СБП, никаких данных карты никуда не вводила.',
  },
  {
    id: 'r3',
    author: 'Дмитрий',
    bought: 'Пакет 20 млн токенов',
    text: 'Нужен был ключ к API под рабочий скрипт. Выдали ключ, лимит совпал с заявленным. Отдельно порадовало, что цена сразу видна и не меняется на последнем шаге.',
  },
  {
    id: 'r4',
    author: 'Соня',
    bought: 'Claude Pro, 12 месяцев',
    text: 'Год вышел заметно дешевле помесячной оплаты. Написала в бот с вопросом про продление — ответили в тот же вечер.',
  },
  {
    id: 'r5',
    author: 'Павел',
    bought: 'Пакет 5 млн токенов',
    text: 'Платил в USDT, сеть TON. Зачлось быстрее, чем я успел закрыть кошелёк.',
  },
  {
    id: 'r6',
    author: 'Марина',
    bought: 'Claude Pro, 3 месяца',
    text: 'До этого покупала у перекупа в личке и потеряла деньги. Тут хотя бы понятно, за что платишь и что будет дальше.',
  },
];

const CATALOG: Catalog = {
  botUrl: 'https://t.me/neirolavka_ai_bot',
  botStartPayload: false,
  referralReady: false,
  subscribers: 2417,
  reviews: REVIEWS,
  reviewsArePlaceholders: true,
  payments: [
    { id: 'card', title: 'Карта РФ', caption: 'Любой российский банк' },
    { id: 'sbp', title: 'СБП', caption: 'Перевод по номеру телефона' },
    { id: 'usdt', title: 'USDT', caption: 'Сети TRC-20 и TON' },
  ],
  products: [
    {
      id: 'claude',
      name: 'Claude Pro',
      tagline: 'Полноценный ИИ-ассистент',
      note: 'Sonnet и Opus, проекты, загрузка файлов',
      plans: plans('claude-pro', 'Claude Pro', true),
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT Plus',
      tagline: 'Голос, картинки и привычный интерфейс',
      note: 'Старшие модели, голосовой режим, работа с изображениями',
      plans: plans('chatgpt-plus', 'ChatGPT Plus', true),
    },
    {
      id: 'seedance',
      name: 'Seedance 2.5',
      tagline: 'Видео по тексту и по картинке',
      note: 'Генерация роликов, продление сцен, свои референсы',
      plans: plans('seedance-25', 'Seedance 2.5', false),
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

/** Найти тариф по идентификатору во всём каталоге. */
export function findPlan(planId: string): { product: Product; plan: Plan } | null {
  for (const product of getCatalog().products) {
    const plan = product.plans.find((p) => p.id === planId);
    if (plan) return { product, plan };
  }
  return null;
}

/**
 * Дата, до которой будет открыт доступ, если оплатить сегодня.
 *
 * Считается только на клиенте: сборка статическая, и вшитая на этапе
 * сборки дата протухла бы через неделю.
 */
export function accessUntil(months: number, from: Date): string {
  const till = new Date(from);
  till.setMonth(till.getMonth() + months);
  return till.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** «1 ₽», «1 234 ₽» — с неразрывным пробелом перед знаком. */
export function formatPrice(rub: number): string {
  return `${rub.toLocaleString('ru-RU')} ₽`;
}
