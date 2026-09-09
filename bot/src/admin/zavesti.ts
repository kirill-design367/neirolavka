/**
 * Завести администратора панели — служебная команда на сервере.
 *
 * Пароль читается СО ВХОДА, а не из аргументов командной строки.
 * Это не педантизм: аргументы видны в `ps` любому пользователю
 * машины и остаются в истории оболочки. Дальше он не хранится нигде:
 * в базу уезжает scrypt-хеш со своей солью.
 *
 *   node dist/admin/zavesti.js <логин> <telegram-id>
 *
 * Роль здесь НЕ задаётся: она берётся из таблицы команды по этому же
 * telegram-id. Одно место — одна правда, и панель не может выдать
 * прав больше, чем есть у человека в боте.
 */

import { createInterface } from 'node:readline';
import { otkrytBazu } from '../db/index.js';
import { BAZA_PO_UMOLCHANIYU } from '../config.js';
import * as adminy from '../db/adminy.js';
import * as komanda from '../db/komanda.js';

/** Короткий пароль на открытом в интернет входе — это его отсутствие. */
const MINIMUM = 12;

function skazat(...ch: unknown[]): void {
  process.stderr.write(ch.join(' ') + '\n');
}

async function sprositParol(): Promise<string> {
  // Если вход не терминал — читаем строку как есть: так работает
  // `printf '%s' "$PAROL" | node …`, где пароль не попадает ни в `ps`,
  // ни в историю.
  if (!process.stdin.isTTY) {
    const kuski: Buffer[] = [];
    for await (const k of process.stdin) kuski.push(k as Buffer);
    return Buffer.concat(kuski).toString('utf8').split('\n')[0] ?? '';
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  process.stderr.write('Пароль: ');
  // Эхо выключаем руками: readline своего скрытого ввода не умеет,
  // а пароль на экране — это пароль, оставшийся в скроллбеке.
  const vyvod = process.stderr as unknown as { write: (s: string) => boolean };
  const tiho = (rl as unknown as { _writeToOutput?: (s: string) => void });
  tiho._writeToOutput = (s: string) => {
    if (s.startsWith('Пароль')) vyvod.write(s);
  };
  const otvet = await new Promise<string>((r) => rl.question('', r));
  rl.close();
  process.stderr.write('\n');
  return otvet;
}

async function glavnoe(): Promise<number> {
  const [login, tgSyroy] = process.argv.slice(2);
  if (!login || !tgSyroy) {
    skazat('Нужно: node dist/admin/zavesti.js <логин> <telegram-id>');
    return 2;
  }
  const tgId = Number(tgSyroy);
  if (!Number.isInteger(tgId) || tgId <= 0) {
    skazat('Второй довод — числовой telegram-id человека из команды.');
    return 2;
  }

  const db = otkrytBazu((process.env['NEIROLAVKA_BAZA'] ?? BAZA_PO_UMOLCHANIYU).trim());
  const rol = komanda.rol(db, tgId);
  if (!rol) {
    // Второй двери к правам быть не должно: роль выдаётся в боте,
    // а владельцы засеваются из окружения при каждом запуске.
    skazat(
      `Человека ${tgId} нет в команде — панель его всё равно не пустит.`,
      '\nДобавьте его владельцем в NEIROLAVKA_VLADELCY (или помощником из бота)',
      'и перезапустите службу, потом повторите.',
    );
    return 3;
  }

  const parol = (await sprositParol()).trim();
  if (parol.length < MINIMUM) {
    skazat(`Пароль короче ${MINIMUM} знаков. Такой пароль подбирают, а не угадывают.`);
    return 4;
  }

  const bylo = adminy.uchetka(db, login) !== null;
  adminy.zavesti(db, login, parol, tgId);
  adminy.zabytNeudachi(db, login);
  skazat(
    `${bylo ? 'Пароль изменён' : 'Администратор заведён'}: ${login} → ${tgId}, роль «${rol}».`,
    '\nВход: https://neirolavka.ru/admin',
  );
  return 0;
}

glavnoe().then(
  (kod) => process.exit(kod),
  (e) => {
    skazat('Не вышло:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
