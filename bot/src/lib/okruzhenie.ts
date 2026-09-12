/**
 * Файл окружения бота: чтение и проверка формата.
 *
 * ЭТОТ ФАЙЛ ЧИТАЕТ SYSTEMD, А НЕ BASH, и это главное, что про него
 * надо знать. У `EnvironmentFile=` свой разбор: строка `ИМЯ=значение`,
 * решётка в начале — примечание, кавычки вокруг значения снимаются.
 * Никакого выполнения там нет.
 *
 * ПОЭТОМУ ЕГО НЕЛЬЗЯ «ПОДКЛЮЧАТЬ» ЧЕРЕЗ `. файл` В ОБОЛОЧКЕ. Для bash
 * это не данные, а ПРОГРАММА: строку, которую он не может прочесть
 * как присваивание, он выполняет как команду — и печатает её обратно
 * словами «command not found». Если такой строкой окажется значение,
 * съехавшее на свою строку при вставке, на экран уедет секрет.
 * Кавычки от этого не спасают: они меняют разбор значения, а строка
 * без знака равенства командой быть не перестаёт.
 *
 * Отсюда устройство: всё, чему нужны настройки без службы (проба
 * оплаты), читает файл ЭТИМ разбором и берёт из него ровно те
 * переменные, которые ему нужны. Токен бота и ключ хранилища в такой
 * процесс не попадают вовсе — не потому, что их не печатают, а потому
 * что их там нет.
 */

import { readFileSync } from 'node:fs';

/** Где лежит файл окружения на боевом сервере. */
export const FAYL_OKRUZHENIYA = '/etc/neirolavka-bot/okruzhenie';

/**
 * Годная строка файла.
 *
 * Без пробелов вокруг знака равенства и без `export`: и то и другое
 * bash понимает, а systemd — нет, и разойтись они обязаны молча.
 */
const STROKA = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Разбор файла: что прочиталось и на каких строках не прочиталось. */
export type Razbor = {
  /** Пары «имя → значение». */
  pary: Record<string, string>;
  /**
   * НОМЕРА строк, которые не разобрались. Именно номера: печатать
   * содержимое негодной строки нельзя — ровно в ней и лежит секрет,
   * из-за которого всё это написано.
   */
  plohie: number[];
};

/** Снять кавычки вокруг значения — ровно так же, как это делает systemd. */
function bezKavychek(v: string): string {
  const s = v.trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Разобрать содержимое файла окружения. Ничего не выполняет. */
export function razobrat(soderzhimoe: string): Razbor {
  const pary: Record<string, string> = {};
  const plohie: number[] = [];
  const stroki = soderzhimoe.replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < stroki.length; i += 1) {
    const s = stroki[i]!;
    if (!s.trim() || /^\s*[#;]/.test(s)) continue;
    const m = STROKA.exec(s);
    if (!m) {
      plohie.push(i + 1);
      continue;
    }
    pary[m[1]!] = bezKavychek(m[2]!);
  }
  return { pary, plohie };
}

/**
 * Прочитать файл окружения с диска.
 *
 * Файла нет — это не поломка: в разработке настройки приходят
 * обычным окружением. Возвращаем пусто и даём вызывающему решить.
 */
export function prochitatFayl(put: string = FAYL_OKRUZHENIYA): Razbor | null {
  let soderzhimoe: string;
  try {
    soderzhimoe = readFileSync(put, 'utf8');
  } catch {
    return null;
  }
  return razobrat(soderzhimoe);
}

/**
 * Взять из файла только переменные с заданной приставкой.
 *
 * Это и есть защита: процесс, которому нужна одна Робокасса,
 * не получает ни токена бота, ни ключа шифрования, ни ключа
 * хранилища. Утечь нечему.
 */
export function tolkoS(pary: Record<string, string>, pristavka: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(pary)) {
    if (k.startsWith(pristavka)) out[k] = v;
  }
  return out;
}
