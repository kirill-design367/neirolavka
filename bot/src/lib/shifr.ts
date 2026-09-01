/**
 * Шифрование доступов.
 *
 * AES-256-GCM: шифр с проверкой целостности. Подменённый в базе
 * шифротекст не расшифруется в мусор — расшифровка честно упадёт,
 * потому что не сойдётся метка подлинности.
 *
 * Ключ приходит из окружения (.env на сервере) и в базе не лежит.
 * Это и есть смысл затеи: файл базы, унесённый целиком, доступов
 * не открывает.
 *
 * Формат хранения — одна строка: «v1.‹вектор›.‹метка›.‹шифротекст›»,
 * каждая часть в base64. Номер версии стоит первым, чтобы через год
 * можно было сменить схему и уметь читать старые записи.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const SHIFR = 'aes-256-gcm';
const DLINA_VEKTORA = 12; // рекомендованная для GCM
const VERSIYA = 'v1';

/** Ошибка расшифровки. Открытого текста в ней нет и быть не должно. */
export class OshibkaShifra extends Error {}

export function zashifrovat(otkrytoe: string, klyuch: Buffer): string {
  const vektor = randomBytes(DLINA_VEKTORA);
  const sh = createCipheriv(SHIFR, klyuch, vektor);
  const telo = Buffer.concat([sh.update(otkrytoe, 'utf8'), sh.final()]);
  const metka = sh.getAuthTag();
  return [VERSIYA, vektor.toString('base64'), metka.toString('base64'), telo.toString('base64')].join('.');
}

export function rasshifrovat(stroka: string, klyuch: Buffer): string {
  const chasti = stroka.split('.');
  if (chasti.length !== 4 || chasti[0] !== VERSIYA) {
    throw new OshibkaShifra('запись доступа записана в неизвестном формате');
  }
  try {
    const vektor = Buffer.from(chasti[1] as string, 'base64');
    const metka = Buffer.from(chasti[2] as string, 'base64');
    const telo = Buffer.from(chasti[3] as string, 'base64');
    const rash = createDecipheriv(SHIFR, klyuch, vektor);
    rash.setAuthTag(metka);
    return Buffer.concat([rash.update(telo), rash.final()]).toString('utf8');
  } catch {
    // Наружу отдаём одну и ту же короткую ошибку: подробности от
    // криптобиблиотеки иногда содержат куски данных, а нам они
    // ничего не объясняют.
    throw new OshibkaShifra('не удалось расшифровать доступ: ключ не тот или запись повреждена');
  }
}

/**
 * Проверка ключа на живой базе при старте.
 *
 * Шифруем и тут же расшифровываем известную строку. Ловит подменённый
 * или обрезанный ключ до того, как о нём узнает первый покупатель.
 */
export function proveritKlyuch(klyuch: Buffer): void {
  const obrazec = 'нейролавка-проба';
  const tuda = rasshifrovat(zashifrovat(obrazec, klyuch), klyuch);
  const a = Buffer.from(tuda);
  const b = Buffer.from(obrazec);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new OshibkaShifra('ключ шифрования не проходит проверку туда-обратно');
  }
}
