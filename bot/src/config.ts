/**
 * Настройки бота.
 *
 * Всё, что секретно, приходит из окружения — то есть из
 * /home/bot/neirolavka-bot/.env на сервере. В репозитории фигурируют
 * ТОЛЬКО имена переменных: ни токена, ни ключа шифрования здесь нет
 * и быть не может.
 *
 * Часы работы и срок обещания — тоже настройки, а не числа в текстах.
 * Тексты берут их отсюда и подставляют, поэтому смена расписания
 * не требует правки ни одной строки сообщения.
 */

/**
 * Как бот получает обновления.
 *
 * `vebhuk` — Telegram стучится к нам. Дёшево и мгновенно, но требует,
 * чтобы Telegram МОГ до нас достучаться.
 *
 * `opros` — бот сам забирает обновления длинным опросом. Работает
 * там, где входящий путь закрыт: наш исходящий путь по IPv6 живой,
 * и этого достаточно.
 *
 * `sam` — начать с вебхука и перейти на опрос, если Telegram
 * доказательно не может доставить (см. `jobs/dostavka.ts`).
 */
export type Rezhim = 'sam' | 'vebhuk' | 'opros';

/** Разобранные настройки. Числа — уже числа, ключ — уже Buffer. */
export type Nastroyki = {
  /** Токен бота. В журнал не попадает никогда: см. lib/zhurnal.ts. */
  token: string;
  /** Секрет в адресе вебхука и в заголовке Telegram. */
  sekretVebhuka: string;
  /** Ключ шифрования доступов, ровно 32 байта. */
  klyuchDostupov: Buffer;
  /** Файл базы. */
  baza: string;
  /** Порт на петле, куда nginx проксирует вебхук. */
  port: number;
  /** Публичный адрес сайта — из него собирается адрес вебхука. */
  adresSayta: string;
  /**
   * Адрес, по которому Telegram должен ходить к нам, вместо того что
   * он получит из DNS. Пусто — пусть решает сам.
   *
   * Существует по одной причине: бот переобъявляет вебхук при КАЖДОМ
   * старте, и заданный руками адрес стёрся бы следующей выкладкой.
   * Значение должно жить рядом с остальными настройками, иначе оно
   * не переживёт обновления.
   */
  adresVebhukaDlyaTelegram: string;
  /** Вебхук, опрос или «решай сам». Подробности у типа `Rezhim`. */
  rezhim: Rezhim;
  /** Владельцы: видят всё. Список из окружения — засев базы при старте. */
  vladelcy: number[];
  /** Помощники: только заказы и выдача. */
  pomoshniki: number[];
  /** Часовой пояс, в котором считаются часы работы. */
  poyas: string;
  /** Час начала работы, включительно. */
  rabotaS: number;
  /** Час конца работы, не включая. */
  rabotaDo: number;
  /** Верхняя граница обещания выдачи, минут. */
  obeshchanieMinut: number;
  /** Через сколько минут после срока напоминать администратору. */
  napominatCherez: number;
  /** Сколько раз повторить напоминание, прежде чем замолчать. */
  napominatRaz: number;
  /**
   * Ключ доступа к хранилищу кода. Им панель кладёт новый прайс
   * в репозиторий, после чего выкладка собирает сайт.
   *
   * Пусто — кнопка «Выложить на сайт» не работает и честно говорит,
   * почему. В журнал не попадает никогда: см. lib/zhurnal.ts.
   */
  klyuchHranilishcha: string;
  /** Хранилище вида «владелец/название». */
  hranilishche: string;
  /** Ветка, в которую пишет панель. */
  vetka: string;
  /** Путь к файлу каталога внутри хранилища. */
  faylKataloga: string;
  /**
   * Адрес API хранилища. Переопределяется только в проверках —
   * ровно затем, чтобы они гоняли БОЕВОЙ код против подставного
   * хранилища, а не копию логики.
   */
  apiHranilishcha: string;
};

class OshibkaNastroyek extends Error {}

function obyazatelno(env: NodeJS.ProcessEnv, imya: string): string {
  const v = (env[imya] ?? '').trim();
  if (!v) throw new OshibkaNastroyek(`не задана переменная окружения ${imya}`);
  return v;
}

function chislo(env: NodeJS.ProcessEnv, imya: string, poumolchaniyu: number): number {
  const v = (env[imya] ?? '').trim();
  if (!v) return poumolchaniyu;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new OshibkaNastroyek(`${imya} должно быть числом, а не «${v}»`);
  return n;
}

/** Список телеграм-идентификаторов через запятую. Пустой — это пустой. */
function spisokId(env: NodeJS.ProcessEnv, imya: string): number[] {
  const v = (env[imya] ?? '').trim();
  if (!v) return [];
  const out: number[] = [];
  for (const kusok of v.split(/[,\s]+/)) {
    if (!kusok) continue;
    const n = Number(kusok);
    if (!Number.isInteger(n) || n <= 0) {
      throw new OshibkaNastroyek(`${imya}: «${kusok}» не похоже на телеграм-идентификатор`);
    }
    out.push(n);
  }
  return out;
}

/**
 * Ключ шифрования: 32 байта в base64 или в hex.
 *
 * Проверяется длина, а не только разбор. Ключ на 16 байт молча
 * превратил бы AES-256 в ошибку на первой же выдаче доступа —
 * лучше упереться в это при старте, пока никто ничего не купил.
 */
export function razobratKlyuch(stroka: string): Buffer {
  const s = stroka.trim();
  let b: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    b = Buffer.from(s, 'hex');
  } else {
    b = Buffer.from(s, 'base64');
  }
  if (b.length !== 32) {
    throw new OshibkaNastroyek(
      `ключ доступов должен быть 32 байта (получилось ${b.length}). ` +
        'Сделать новый: openssl rand -base64 32',
    );
  }
  return b;
}

/**
 * Разбор окружения. Чистая функция: ничего не читает с диска
 * и ничего не запускает, поэтому её можно звать из проверок.
 */
/**
 * Где лежит база, если в окружении не сказано иное.
 *
 * Отдельной константой, а не строкой внутри разбора: тот же путь
 * нужен служебной команде заведения администратора, которая токена
 * бота не требует и настройки целиком не читает.
 */
export const BAZA_PO_UMOLCHANIYU = '/var/lib/neirolavka-bot/baza.sqlite';

export function prochitat(env: NodeJS.ProcessEnv): Nastroyki {
  const rabotaS = chislo(env, 'NEIROLAVKA_RABOTA_S', 8);
  const rabotaDo = chislo(env, 'NEIROLAVKA_RABOTA_DO', 22);
  if (!Number.isInteger(rabotaS) || !Number.isInteger(rabotaDo) || rabotaS < 0 || rabotaDo > 24 || rabotaS >= rabotaDo) {
    throw new OshibkaNastroyek(
      `часы работы заданы неверно: с ${rabotaS} до ${rabotaDo}. Нужны целые часы, начало меньше конца.`,
    );
  }
  // Режим доставки. Неизвестное слово — это отказ, а не умолчание:
  // опечатка в `NEIROLAVKA_REZHIM` не должна молча оставлять бота
  // на вебхуке, которого, может быть, и просили не использовать.
  const rezhimStroka = (env['NEIROLAVKA_REZHIM'] ?? 'sam').trim().toLowerCase();
  if (rezhimStroka !== 'sam' && rezhimStroka !== 'vebhuk' && rezhimStroka !== 'opros') {
    throw new OshibkaNastroyek(
      `NEIROLAVKA_REZHIM должен быть sam, vebhuk или opros, а не «${rezhimStroka}»`,
    );
  }
  const rezhim = rezhimStroka as Rezhim;

  const vladelcy = spisokId(env, 'NEIROLAVKA_VLADELCY');
  if (vladelcy.length === 0) {
    throw new OshibkaNastroyek('не задан NEIROLAVKA_VLADELCY — бот остался бы без администратора');
  }
  return {
    token: obyazatelno(env, 'NEIROLAVKA_TOKEN_BOTA'),
    sekretVebhuka: obyazatelno(env, 'NEIROLAVKA_SEKRET_VEBHUKA'),
    klyuchDostupov: razobratKlyuch(obyazatelno(env, 'NEIROLAVKA_KLYUCH_DOSTUPOV')),
    baza: (env['NEIROLAVKA_BAZA'] ?? BAZA_PO_UMOLCHANIYU).trim(),
    port: chislo(env, 'NEIROLAVKA_PORT', 8080),
    adresSayta: (env['NEIROLAVKA_ADRES'] ?? 'https://neirolavka.ru').trim().replace(/\/+$/, ''),
    adresVebhukaDlyaTelegram: (env['NEIROLAVKA_ADRES_DLYA_TELEGRAM'] ?? '').trim(),
    rezhim,
    vladelcy,
    pomoshniki: spisokId(env, 'NEIROLAVKA_POMOSHNIKI'),
    poyas: (env['NEIROLAVKA_POYAS'] ?? 'Europe/Moscow').trim(),
    rabotaS,
    rabotaDo,
    obeshchanieMinut: chislo(env, 'NEIROLAVKA_OBESHCHANIE_MINUT', 60),
    napominatCherez: chislo(env, 'NEIROLAVKA_NAPOMINAT_CHEREZ', 10),
    napominatRaz: chislo(env, 'NEIROLAVKA_NAPOMINAT_RAZ', 5),
    klyuchHranilishcha: (env['NEIROLAVKA_KLYUCH_HRANILISHCHA'] ?? '').trim(),
    hranilishche: (env['NEIROLAVKA_HRANILISHCHE'] ?? 'kirill-design367/neirolavka').trim(),
    vetka: (env['NEIROLAVKA_VETKA'] ?? 'main').trim(),
    faylKataloga: (env['NEIROLAVKA_FAYL_KATALOGA'] ?? 'src/lib/catalog.ts').trim(),
    apiHranilishcha: (env['NEIROLAVKA_API_HRANILISHCHA'] ?? 'https://api.github.com').trim().replace(/\/+$/, ''),
  };
}

/** Адрес вебхука. Секрет — часть пути, поэтому адрес и есть пароль. */
export function adresVebhuka(n: Nastroyki): string {
  return `${n.adresSayta}/tg/${n.sekretVebhuka}`;
}

/** Путь, который слушает бот на петле. */
export function putVebhuka(n: Nastroyki): string {
  return `/tg/${n.sekretVebhuka}`;
}
