/**
 * Два языка панели.
 *
 * Русский — владельцу, английский — помощнику. Переключатель, а не
 * определение по браузеру: человек, который весь день работает
 * в панели, выбирает язык один раз, и он не должен зависеть
 * от настроек чужого компьютера.
 *
 * Словарь плоский и полный: недостающий ключ здесь — это пустое место
 * на экране у того, кто работает. Поэтому оба языка описаны одним
 * типом, и забытый перевод не компилируется.
 */

export type Yazyk = 'ru' | 'en';

export const YAZYKI: Yazyk[] = ['ru', 'en'];

export type Slova = {
  panel: string;
  vhod: string;
  login: string;
  parol: string;
  voyti: string;
  vyyti: string;
  nevernyyVhod: string;
  zaperto: string;
  ochered: string;
  pokupateli: string;
  katalog: string;
  statistika: string;
  vy: string;
  vladelec: string;
  pomoshnik: string;
  netPrav: string;
  pusto: string;
  zakaz: string;
  chto: string;
  kto: string;
  akkaunt: string;
  novyAkkaunt: string;
  svoyAkkaunt: string;
  status: string;
  zhdet: string;
  sleduyushchiyShag: string;
  otkryt: string;
  nazad: string;
  oformlen: string;
  oplachen: string;
  cena: string;
  utochnyaetsya: string;
  sBalansa: string;
  obeshchano: string;
  ispolnitel: string;
  otmetitOplatu: string;
  vzyat: string;
  vernutVOchered: string;
  dannyeAkkaunta: string;
  pokazatDannye: string;
  pochta: string;
  zaprositKod: string;
  kod: string;
  pokazatKod: string;
  kodZaproshen: string;
  kodPoluchen: string;
  pismoOtpravleno: string;
  otmetitPismo: string;
  vvestiDostup: string;
  parolDostupa: string;
  zametka: string;
  sohranitDostup: string;
  otpravitPokupatelyu: string;
  otmenit: string;
  prichinaOtmeny: string;
  otmenaRuchnaya: string;
  otmenaNetKoda: string;
  otmenaParol: string;
  nuzhnoPismo: string;
  vydan: string;
  otmenen: string;
  sobytiya: string;
  balans: string;
  dvizheniya: string;
  popolnit: string;
  summaRubley: string;
  zakazov: string;
  vydano: string;
  istoriyaZakazov: string;
  produkt: string;
  uroven: string;
  urovni: string;
  dobavitProdukt: string;
  dobavitUroven: string;
  sohranit: string;
  skryt: string;
  pokazat: string;
  spryatan: string;
  imya: string;
  opisanie: string;
  chtoPoluchaesh: string;
  vygruzka: string;
  vygruzkaPoyasnenie: string;
  vsegoZakazov: string;
  vyruchka: string;
  srednyayaVydacha: string;
  poTovaram: string;
  cenaNeObyavlena: string;
  vydachNeBylo: string;
  minut: string;
  sohraneno: string;
  gotovo: string;
  identifikator: string;
  korotko: string;
  polnoeNazvanie: string;
  ochistitCenu: string;
  netZakaza: string;
  nelzyaSeychas: string;
  kodNeNuzhen: string;
  uzheVvoditKod: string;
  sprosiliKod: string;
  neDoshlo: string;
  dostupNeZapisan: string;
  neChitaetsyaDostup: string;
  ostavilNevydannym: string;
  otpravleno: string;
  otmenilDengi: string;
  otmenil: string;
  zakazZakryt: string;
  kodaNet: string;
  dannyhNet: string;
  ustarelaForma: string;
  summaNeverna: string;
  popolnili: string;
  nuzhenLoginParol: string;
  vzyalVRabotu: string;
  otmetilOplatu: string;
  vernulVOchered: string;
  otmetilPismo: string;
  netTakogoCheloveka: string;
  neverniyId: string;
  stZhdetOplaty: string;
  stOplachen: string;
  stVRabote: string;
  stZhdemKod: string;
  stKodPoluchen: string;
  stVydan: string;
  stOtmenen: string;
  gruppaOtpravit: string;
  gruppaDostup: string;
  gruppaKod: string;
  gruppaVzyat: string;
  gruppaOplata: string;
  gruppaZhdemKod: string;
  gruppaPusta: string;
  svernut: string;
  razvernut: string;
  summa: string;
  sortPoOzhidaniyu: string;
  sortPoSumme: string;
  vsegoPokupateley: string;
  zaNedelyu: string;
  zaMesyac: string;
  zaGod: string;
  poisk: string;
  poiskPodskazka: string;
  otborVse: string;
  otborSZakazami: string;
  otborBezZakazov: string;
  otborSBalansom: string;
  primenit: string;
  sbrosit: string;
  nikogoNeNashlos: string;
  naydeno: string;
  period: string;
  segodnya: string;
  vchera: string;
  nedelya: string;
  mesyac: string;
  god: string;
  vseVremya: string;
  oformleno: string;
  vyruchkaZaPeriod: string;
  oknoPoyasnenie: string;
  sVremeni: string;
};

const RU: Slova = {
  panel: 'Нейролавка · панель',
  vhod: 'Вход',
  login: 'Логин',
  parol: 'Пароль',
  voyti: 'Войти',
  vyyti: 'Выйти',
  nevernyyVhod: 'Логин или пароль не подошли',
  zaperto: 'Слишком много попыток. Подождите и попробуйте снова',
  ochered: 'Очередь',
  pokupateli: 'Покупатели',
  katalog: 'Каталог',
  statistika: 'Статистика',
  vy: 'Вы',
  vladelec: 'владелец',
  pomoshnik: 'помощник',
  netPrav: 'Этот раздел только для владельца',
  pusto: 'Пусто',
  zakaz: 'Заказ',
  chto: 'Что',
  kto: 'Покупатель',
  akkaunt: 'Аккаунт',
  novyAkkaunt: 'новый',
  svoyAkkaunt: 'свой',
  status: 'Состояние',
  zhdet: 'Ждёт',
  sleduyushchiyShag: 'Следующий шаг',
  otkryt: 'Открыть',
  nazad: 'К очереди',
  oformlen: 'Оформлен',
  oplachen: 'Оплачен',
  cena: 'Цена',
  utochnyaetsya: 'уточняется',
  sBalansa: 'с баланса',
  obeshchano: 'Обещано',
  ispolnitel: 'Взял',
  otmetitOplatu: 'Оплата пришла',
  vzyat: 'Взять в работу',
  vernutVOchered: 'Вернуть в очередь',
  dannyeAkkaunta: 'Данные аккаунта покупателя',
  pokazatDannye: 'Показать данные аккаунта',
  pochta: 'Почта',
  zaprositKod: 'Запросить код',
  kod: 'Код',
  pokazatKod: 'Показать код',
  kodZaproshen: 'Код запрошен',
  kodPoluchen: 'Код получен',
  pismoOtpravleno: 'Письмо восстановления отправлено',
  otmetitPismo: 'Отметить: письмо отправлено',
  vvestiDostup: 'Ввести доступ',
  parolDostupa: 'Пароль',
  zametka: 'Записка покупателю',
  sohranitDostup: 'Сохранить доступ',
  otpravitPokupatelyu: 'Отправить покупателю',
  otmenit: 'Отменить заказ',
  prichinaOtmeny: 'Причина отмены',
  otmenaRuchnaya: 'Отменён администратором',
  otmenaNetKoda: 'Код не пришёл',
  otmenaParol: 'Пароль не подошёл',
  nuzhnoPismo: 'Сначала отправьте письмо восстановления и отметьте это',
  vydan: 'Выдан',
  otmenen: 'Отменён',
  sobytiya: 'Что происходило',
  balans: 'Баланс',
  dvizheniya: 'Движения денег',
  popolnit: 'Пополнить',
  summaRubley: 'Сумма, ₽',
  zakazov: 'Заказов',
  vydano: 'Выдано',
  istoriyaZakazov: 'Заказы',
  produkt: 'Продукт',
  uroven: 'Уровень',
  urovni: 'Уровни подписки',
  dobavitProdukt: 'Добавить продукт',
  dobavitUroven: 'Добавить уровень',
  sohranit: 'Сохранить',
  skryt: 'Спрятать',
  pokazat: 'Вернуть в продажу',
  spryatan: 'спрятан',
  imya: 'Название',
  opisanie: 'Что это',
  chtoPoluchaesh: 'Что получает покупатель',
  vygruzka: 'Выгрузка для сайта',
  vygruzkaPoyasnenie:
    'Сайт статический и базы не видит: цена, поставленная здесь, работает в боте сразу, ' +
    'а на витрине появится после выкладки. Замените этим куском массив products в src/lib/catalog.ts.',
  vsegoZakazov: 'Заказов всего',
  vyruchka: 'Выручка по выданным',
  srednyayaVydacha: 'Среднее время выдачи',
  poTovaram: 'По товарам',
  cenaNeObyavlena: 'цена не объявлена',
  vydachNeBylo: 'выдач пока не было',
  minut: 'мин',
  sohraneno: 'Сохранено',
  gotovo: 'Готово',
  identifikator: 'Идентификатор',
  korotko: 'Коротко',
  polnoeNazvanie: 'Полное название',
  ochistitCenu: 'Убрать цену',
  netZakaza: 'Такого заказа нет',
  nelzyaSeychas: 'Сейчас это сделать нельзя',
  kodNeNuzhen: 'У этого заказа новый аккаунт — код не нужен',
  uzheVvoditKod: 'Покупатель уже вводит код по заказу',
  sprosiliKod: 'Спросил код у покупателя',
  neDoshlo: 'Покупателю не доставлено',
  dostupNeZapisan: 'Доступ не записан',
  neChitaetsyaDostup: 'Запись доступа не читается',
  ostavilNevydannym: 'Доступ не доставлен — заказ оставил невыданным',
  otpravleno: 'Отправил покупателю',
  otmenilDengi: 'Отменил, деньги вернулись на баланс',
  otmenil: 'Отменил',
  zakazZakryt: 'Заказ уже закрыт',
  kodaNet: 'Кода по этому заказу нет',
  dannyhNet: 'Данных аккаунта нет',
  ustarelaForma: 'Форма устарела. Откройте страницу заново',
  summaNeverna: 'Нужна сумма больше нуля',
  popolnili: 'Баланс пополнен',
  nuzhenLoginParol: 'Нужны логин и пароль',
  vzyalVRabotu: 'Взяли в работу',
  otmetilOplatu: 'Отметил оплаченным',
  vernulVOchered: 'Вернул в очередь',
  otmetilPismo: 'Отметил письмо. Теперь заказ можно отменить по паролю',
  netTakogoCheloveka: 'Такого человека в базе нет',
  neverniyId: 'Такой идентификатор не подходит',
  stZhdetOplaty: 'Ждёт оплаты',
  stOplachen: 'Оплачен',
  stVRabote: 'В работе',
  stZhdemKod: 'Ждём код',
  stKodPoluchen: 'Код получен',
  stVydan: 'Выдан',
  stOtmenen: 'Отменён',
  gruppaOtpravit: 'Готовы к выдаче',
  gruppaDostup: 'Нужно записать доступ',
  gruppaKod: 'Нужно запросить код',
  gruppaVzyat: 'Готовы взять в работу',
  gruppaOplata: 'Ждут оплаты',
  gruppaZhdemKod: 'Ждём код от покупателя',
  gruppaPusta: 'пусто',
  svernut: 'свернуть',
  razvernut: 'развернуть',
  summa: 'Сумма',
  sortPoOzhidaniyu: 'по ожиданию',
  sortPoSumme: 'по сумме',
  vsegoPokupateley: 'Всего покупателей',
  zaNedelyu: 'за неделю',
  zaMesyac: 'за месяц',
  zaGod: 'за год',
  poisk: 'Поиск',
  poiskPodskazka: 'имя, @username или id',
  otborVse: 'Все',
  otborSZakazami: 'С заказами',
  otborBezZakazov: 'Без заказов',
  otborSBalansom: 'С деньгами на балансе',
  primenit: 'Показать',
  sbrosit: 'Сбросить',
  nikogoNeNashlos: 'Никто не подошёл',
  naydeno: 'Найдено',
  period: 'Период',
  segodnya: 'Сегодня',
  vchera: 'Вчера',
  nedelya: 'Неделя',
  mesyac: 'Месяц',
  god: 'Год',
  vseVremya: 'Всё время',
  oformleno: 'Заказов оформлено',
  vyruchkaZaPeriod: 'Выручка по выданным за период',
  oknoPoyasnenie:
    'Заказы считаются по дню оформления, деньги — по дню выдачи: выручка засчитывается тогда, когда доступ ушёл человеку.',
  sVremeni: 'с',
};

const EN: Slova = {
  panel: 'Neirolavka · panel',
  vhod: 'Sign in',
  login: 'Login',
  parol: 'Password',
  voyti: 'Sign in',
  vyyti: 'Sign out',
  nevernyyVhod: 'Login or password did not match',
  zaperto: 'Too many attempts. Wait and try again',
  ochered: 'Queue',
  pokupateli: 'Customers',
  katalog: 'Catalogue',
  statistika: 'Statistics',
  vy: 'You',
  vladelec: 'owner',
  pomoshnik: 'assistant',
  netPrav: 'This section is for the owner only',
  pusto: 'Empty',
  zakaz: 'Order',
  chto: 'Item',
  kto: 'Customer',
  akkaunt: 'Account',
  novyAkkaunt: 'new',
  svoyAkkaunt: 'own',
  status: 'Status',
  zhdet: 'Waiting',
  sleduyushchiyShag: 'Next step',
  otkryt: 'Open',
  nazad: 'Back to queue',
  oformlen: 'Placed',
  oplachen: 'Paid',
  cena: 'Price',
  utochnyaetsya: 'to be set',
  sBalansa: 'from balance',
  obeshchano: 'Promised by',
  ispolnitel: 'Taken by',
  otmetitOplatu: 'Payment received',
  vzyat: 'Take into work',
  vernutVOchered: 'Return to queue',
  dannyeAkkaunta: 'Customer account details',
  pokazatDannye: 'Show account details',
  pochta: 'Email',
  zaprositKod: 'Request code',
  kod: 'Code',
  pokazatKod: 'Show code',
  kodZaproshen: 'Code requested',
  kodPoluchen: 'Code received',
  pismoOtpravleno: 'Password reset email sent',
  otmetitPismo: 'Mark: reset email sent',
  vvestiDostup: 'Enter access',
  parolDostupa: 'Password',
  zametka: 'Note for the customer',
  sohranitDostup: 'Save access',
  otpravitPokupatelyu: 'Send to customer',
  otmenit: 'Cancel order',
  prichinaOtmeny: 'Reason',
  otmenaRuchnaya: 'Cancelled by admin',
  otmenaNetKoda: 'Code never arrived',
  otmenaParol: 'Password did not work',
  nuzhnoPismo: 'Send the password reset email and mark it first',
  vydan: 'Delivered',
  otmenen: 'Cancelled',
  sobytiya: 'History',
  balans: 'Balance',
  dvizheniya: 'Money movements',
  popolnit: 'Top up',
  summaRubley: 'Amount, ₽',
  zakazov: 'Orders',
  vydano: 'Delivered',
  istoriyaZakazov: 'Orders',
  produkt: 'Product',
  uroven: 'Tier',
  urovni: 'Subscription tiers',
  dobavitProdukt: 'Add product',
  dobavitUroven: 'Add tier',
  sohranit: 'Save',
  skryt: 'Hide',
  pokazat: 'Put back on sale',
  spryatan: 'hidden',
  imya: 'Name',
  opisanie: 'What it is',
  chtoPoluchaesh: 'What the customer gets',
  vygruzka: 'Export for the website',
  vygruzkaPoyasnenie:
    'The website is static and cannot read the database: a price set here works in the bot at once, ' +
    'but appears on the site only after a deploy. Replace the products array in src/lib/catalog.ts with this.',
  vsegoZakazov: 'Orders total',
  vyruchka: 'Revenue on delivered',
  srednyayaVydacha: 'Average delivery time',
  poTovaram: 'By product',
  cenaNeObyavlena: 'price not set',
  vydachNeBylo: 'nothing delivered yet',
  minut: 'min',
  sohraneno: 'Saved',
  gotovo: 'Done',
  identifikator: 'Identifier',
  korotko: 'Short',
  polnoeNazvanie: 'Full name',
  ochistitCenu: 'Clear price',
  netZakaza: 'No such order',
  nelzyaSeychas: 'This cannot be done right now',
  kodNeNuzhen: 'This order is on a new account — no code needed',
  uzheVvoditKod: 'The customer is already entering a code for order',
  sprosiliKod: 'Asked the customer for the code',
  neDoshlo: 'Not delivered to the customer',
  dostupNeZapisan: 'No access saved yet',
  neChitaetsyaDostup: 'The saved access cannot be read',
  ostavilNevydannym: 'Access was not delivered — the order stays undelivered',
  otpravleno: 'Sent to the customer',
  otmenilDengi: 'Cancelled, money returned to the balance',
  otmenil: 'Cancelled',
  zakazZakryt: 'The order is already closed',
  kodaNet: 'No code for this order',
  dannyhNet: 'No account details',
  ustarelaForma: 'The form is stale. Reload the page',
  summaNeverna: 'The amount must be greater than zero',
  popolnili: 'Balance topped up',
  nuzhenLoginParol: 'Login and password are required',
  vzyalVRabotu: 'Taken into work',
  otmetilOplatu: 'Marked as paid',
  vernulVOchered: 'Returned to the queue',
  otmetilPismo: 'Marked. The order can now be cancelled for a wrong password',
  netTakogoCheloveka: 'No such customer in the database',
  neverniyId: 'That identifier will not do',
  stZhdetOplaty: 'Awaiting payment',
  stOplachen: 'Paid',
  stVRabote: 'In progress',
  stZhdemKod: 'Waiting for code',
  stKodPoluchen: 'Code received',
  stVydan: 'Delivered',
  stOtmenen: 'Cancelled',
  gruppaOtpravit: 'Ready to send',
  gruppaDostup: 'Access to enter',
  gruppaKod: 'Code to request',
  gruppaVzyat: 'Ready to take',
  gruppaOplata: 'Awaiting payment',
  gruppaZhdemKod: 'Waiting for the customer code',
  gruppaPusta: 'empty',
  svernut: 'collapse',
  razvernut: 'expand',
  summa: 'Amount',
  sortPoOzhidaniyu: 'by waiting time',
  sortPoSumme: 'by amount',
  vsegoPokupateley: 'Customers total',
  zaNedelyu: 'last 7 days',
  zaMesyac: 'last 30 days',
  zaGod: 'last 365 days',
  poisk: 'Search',
  poiskPodskazka: 'name, @username or id',
  otborVse: 'Everyone',
  otborSZakazami: 'With orders',
  otborBezZakazov: 'Without orders',
  otborSBalansom: 'With money on balance',
  primenit: 'Show',
  sbrosit: 'Reset',
  nikogoNeNashlos: 'Nobody matched',
  naydeno: 'Found',
  period: 'Period',
  segodnya: 'Today',
  vchera: 'Yesterday',
  nedelya: '7 days',
  mesyac: '30 days',
  god: '365 days',
  vseVremya: 'All time',
  oformleno: 'Orders placed',
  vyruchkaZaPeriod: 'Revenue on orders delivered in the period',
  oknoPoyasnenie:
    'Orders are counted by the day they were placed, money by the day it was delivered: revenue lands on the day the access reached the customer.',
  sVremeni: 'from',
};

export const SLOVAR: Record<Yazyk, Slova> = { ru: RU, en: EN };

export function razobratYazyk(znachenie: string | undefined): Yazyk {
  return znachenie === 'en' ? 'en' : 'ru';
}
