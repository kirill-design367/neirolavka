/**
 * Единственный источник каталога.
 *
 * Сейчас данные лежат здесь же, но компоненты обращаются к каталогу
 * ТОЛЬКО через getCatalog(). Когда каталог начнёт приходить из бота,
 * достаточно заменить тело getCatalog() на запрос к API — типы и все
 * вызывающие компоненты остаются нетронутыми.
 *
 * Цены временные: везде 1 ₽ до появления настоящего прайса.
 */

/** Способ оплаты. Сайт его не обрабатывает — значение уезжает в бот. */
export type PaymentMethod = {
  id: 'card' | 'sbp' | 'usdt';
  title: string;
  caption: string;
};

/** Один тариф: либо срок подписки, либо пакет токенов. */
export type Plan = {
  id: string;
  /** Короткая подпись на кнопке тарифа: «3 месяца», «5 млн токенов». */
  short: string;
  /** Полное название для панели заказа: «Claude Pro, 3 месяца». */
  title: string;
  /** Строка под названием: что именно человек получает. */
  note: string;
  /** Цена в рублях. Временно 1 у всех тарифов. */
  priceRub: number;
  /** Отметка на карточке: «выгоднее всего» и подобное. */
  badge?: string;
  /** Срок подписки в месяцах. У пакетов токенов срока нет. */
  months?: number;
};

export type PlanGroup = {
  id: 'months' | 'tokens';
  title: string;
  caption: string;
  plans: Plan[];
};

export type Product = {
  id: 'claude' | 'chatgpt';
  /** Имя нейросети. Латиница здесь допустима: это имя бренда. */
  name: string;
  /** Название тарифного плана вендора. */
  plan: string;
  /** Одна строка о том, что это и кому. */
  tagline: string;
  status: 'available' | 'soon';
  /** Подпись у недоступного продукта. */
  soonNote?: string;
  groups: PlanGroup[];
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
  /** Ссылка на бота. */
  botUrl: string;
  /** Тот же бот словами: чтобы найти его поиском в Telegram, не кликая. */
  botHandle: string;
  reviews: Review[];
  /** true, пока отзывы демонстрационные. Влияет на подпись у блока. */
  reviewsArePlaceholders: boolean;
};

const PRICE = 1;

const claudeMonths: Plan[] = [
  {
    id: 'claude-pro-1m',
    short: '1 месяц',
    title: 'Claude Pro, 1 месяц',
    note: 'Полный доступ к Sonnet и Opus, проекты, загрузка файлов',
    priceRub: PRICE,
    months: 1,
  },
  {
    id: 'claude-pro-3m',
    short: '3 месяца',
    title: 'Claude Pro, 3 месяца',
    note: 'То же самое, но продлевать втрое реже',
    priceRub: PRICE,
    months: 3,
  },
  {
    id: 'claude-pro-6m',
    short: '6 месяцев',
    title: 'Claude Pro, 6 месяцев',
    note: 'Полгода без продлений',
    priceRub: PRICE,
    months: 6,
    badge: 'берут чаще всего',
  },
  {
    id: 'claude-pro-12m',
    short: '12 месяцев',
    title: 'Claude Pro, 12 месяцев',
    note: 'Год доступа, самая низкая цена месяца',
    priceRub: PRICE,
    months: 12,
    badge: 'выгоднее всего',
  },
];

const claudeTokens: Plan[] = [
  {
    id: 'claude-tok-1',
    short: '1 млн токенов',
    title: 'Пакет 1 млн токенов',
    note: 'Попробовать API, хватает на пару небольших задач',
    priceRub: PRICE,
  },
  {
    id: 'claude-tok-5',
    short: '5 млн токенов',
    title: 'Пакет 5 млн токенов',
    note: 'Рабочий объём для одного человека на месяц',
    priceRub: PRICE,
  },
  {
    id: 'claude-tok-20',
    short: '20 млн токенов',
    title: 'Пакет 20 млн токенов',
    note: 'Небольшая команда или постоянная автоматизация',
    priceRub: PRICE,
    badge: 'берут чаще всего',
  },
  {
    id: 'claude-tok-60',
    short: '60 млн токенов',
    title: 'Пакет 60 млн токенов',
    note: 'Продакшен: обработка потока запросов без оглядки на лимит',
    priceRub: PRICE,
    badge: 'выгоднее всего',
  },
];

const chatgptMonths: Plan[] = [
  {
    id: 'chatgpt-plus-1m',
    short: '1 месяц',
    title: 'ChatGPT Plus, 1 месяц',
    note: 'Доступ к старшим моделям, продвинутый анализ данных',
    priceRub: PRICE,
    months: 1,
  },
  {
    id: 'chatgpt-plus-3m',
    short: '3 месяца',
    title: 'ChatGPT Plus, 3 месяца',
    note: 'То же самое, но продлевать втрое реже',
    priceRub: PRICE,
    months: 3,
  },
  {
    id: 'chatgpt-plus-6m',
    short: '6 месяцев',
    title: 'ChatGPT Plus, 6 месяцев',
    note: 'Полгода без продлений',
    priceRub: PRICE,
    months: 6,
  },
  {
    id: 'chatgpt-plus-12m',
    short: '12 месяцев',
    title: 'ChatGPT Plus, 12 месяцев',
    note: 'Год доступа, самая низкая цена месяца',
    priceRub: PRICE,
    months: 12,
    badge: 'выгоднее всего',
  },
];

const chatgptTokens: Plan[] = [
  {
    id: 'chatgpt-tok-1',
    short: '1 млн токенов',
    title: 'Пакет 1 млн токенов',
    note: 'Попробовать API, хватает на пару небольших задач',
    priceRub: PRICE,
  },
  {
    id: 'chatgpt-tok-5',
    short: '5 млн токенов',
    title: 'Пакет 5 млн токенов',
    note: 'Рабочий объём для одного человека на месяц',
    priceRub: PRICE,
  },
  {
    id: 'chatgpt-tok-20',
    short: '20 млн токенов',
    title: 'Пакет 20 млн токенов',
    note: 'Небольшая команда или постоянная автоматизация',
    priceRub: PRICE,
  },
  {
    id: 'chatgpt-tok-60',
    short: '60 млн токенов',
    title: 'Пакет 60 млн токенов',
    note: 'Продакшен: обработка потока запросов без оглядки на лимит',
    priceRub: PRICE,
  },
];

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
  botUrl: 'https://t.me/neirolavka_bot',
  botHandle: '@neirolavka_bot',
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
      name: 'Claude',
      plan: 'Claude Pro',
      tagline: 'Полноценный ИИ-ассистент',
      status: 'available',
      groups: [
        {
          id: 'months',
          title: 'По месяцам',
          caption: 'Личный аккаунт, доступ открывается сразу после оплаты',
          plans: claudeMonths,
        },
        {
          id: 'tokens',
          title: 'По токенам',
          caption: 'Ключ к API, платите за объём, а не за время',
          plans: claudeTokens,
        },
      ],
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      plan: 'ChatGPT Plus',
      tagline: 'Голос, картинки и привычный интерфейс',
      status: 'soon',
      soonNote: 'Открываем в ближайшие недели. Тарифы уже собраны',
      groups: [
        {
          id: 'months',
          title: 'По месяцам',
          caption: 'Личный аккаунт, доступ открывается сразу после оплаты',
          plans: chatgptMonths,
        },
        {
          id: 'tokens',
          title: 'По токенам',
          caption: 'Ключ к API, платите за объём, а не за время',
          plans: chatgptTokens,
        },
      ],
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
export function findPlan(planId: string): { product: Product; group: PlanGroup; plan: Plan } | null {
  for (const product of getCatalog().products) {
    for (const group of product.groups) {
      const plan = group.plans.find((p) => p.id === planId);
      if (plan) return { product, group, plan };
    }
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
