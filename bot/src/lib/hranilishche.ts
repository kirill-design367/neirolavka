/**
 * Хранилище кода: положить туда новый прайс и посмотреть, собрался ли
 * сайт.
 *
 * Всё общение — четыре запроса к API GitHub. Ни git, ни ssh: у бота
 * их нет и заводить их ему незачем. Ключ доступа приходит из настроек
 * сервера, в базе его нет и быть не может.
 *
 * ОШИБКИ ЗДЕСЬ СРАЗУ ЧЕЛОВЕЧЕСКИЕ. Панелью пользуется владелец лавки,
 * а не программист: «404 Not Found» и «422 Unprocessable Entity» ему
 * не говорят ничего. Технические подробности уходят в журнал (без
 * ключа — он вырезается), наружу идёт фраза, по которой понятно,
 * что делать.
 */

import type { Nastroyki } from '../config.js';
import { zhurnal } from './zhurnal.js';

/** Сколько ждём ответа хранилища. Больше — и обработчик встанет. */
const PREDEL_MS = 15_000;

/** Отказ, который не стыдно показать человеку. */
export class OshibkaHranilishcha extends Error {}

const otkaz = (chto: string): never => {
  throw new OshibkaHranilishcha(chto);
};

async function zapros(
  n: Nastroyki,
  put: string,
  nastroyki: { metod?: string; telo?: unknown } = {},
): Promise<{ kod: number; dannye: Record<string, unknown> }> {
  if (!n.klyuchHranilishcha) {
    otkaz('В настройках сервера нет ключа доступа к хранилищу кода. Без него панель не может отправить цены.');
  }
  let otvet: Response;
  try {
    otvet = await fetch(`${n.apiHranilishcha}${put}`, {
      method: nastroyki.metod ?? 'GET',
      headers: {
        authorization: `Bearer ${n.klyuchHranilishcha}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'neirolavka-panel',
        ...(nastroyki.telo ? { 'content-type': 'application/json' } : {}),
      },
      body: nastroyki.telo ? JSON.stringify(nastroyki.telo) : undefined,
      signal: AbortSignal.timeout(PREDEL_MS),
    });
  } catch (e) {
    zhurnal.oshibka('хранилище недоступно:', e);
    return otkaz('Не удалось связаться с хранилищем кода. Попробуйте ещё раз через минуту.');
  }
  let dannye: Record<string, unknown> = {};
  try {
    dannye = (await otvet.json()) as Record<string, unknown>;
  } catch {
    dannye = {};
  }
  if (otvet.status === 401 || otvet.status === 403) {
    zhurnal.oshibka(`хранилище отказало: ${otvet.status}`, dannye['message']);
    otkaz('Ключ доступа к хранилищу кода не подошёл или у него нет права записи. Ключ нужно перевыпустить.');
  }
  return { kod: otvet.status, dannye };
}

export type Fayl = { text: string; metka: string };

/** Прочитать файл из хранилища. */
export async function vzyatFayl(n: Nastroyki, put: string): Promise<Fayl> {
  const { kod, dannye } = await zapros(
    n,
    `/repos/${n.hranilishche}/contents/${encodeURI(put)}?ref=${encodeURIComponent(n.vetka)}`,
  );
  if (kod === 404) otkaz(`В хранилище кода нет файла ${put}. Похоже, каталог переехал — правку надо внести руками.`);
  if (kod !== 200) otkaz('Хранилище кода ответило непонятно. Попробуйте ещё раз через минуту.');
  const soderzhimoe = dannye['content'];
  const metka = dannye['sha'];
  if (typeof soderzhimoe !== 'string' || typeof metka !== 'string') {
    otkaz('Хранилище кода вернуло файл не в том виде.');
  }
  return { text: Buffer.from(soderzhimoe as string, 'base64').toString('utf8'), metka: metka as string };
}

/** Положить файл обратно. Возвращает метку изменения. */
export async function polozhitFayl(
  n: Nastroyki,
  put: string,
  text: string,
  metkaFayla: string,
  opisanie: string,
): Promise<string> {
  const { kod, dannye } = await zapros(n, `/repos/${n.hranilishche}/contents/${encodeURI(put)}`, {
    metod: 'PUT',
    telo: {
      message: opisanie,
      content: Buffer.from(text, 'utf8').toString('base64'),
      sha: metkaFayla,
      branch: n.vetka,
    },
  });
  // 409 и 422 — это «файл успели изменить, пока панель готовила
  // отправку». Перезаписывать вслепую нельзя: чужая правка пропала бы
  // молча.
  if (kod === 409 || kod === 422) {
    otkaz('Каталог в хранилище кода изменился, пока панель готовила отправку. Нажмите «Выложить» ещё раз.');
  }
  if (kod !== 200 && kod !== 201) {
    zhurnal.oshibka(`не удалось записать файл: ${kod}`, dannye['message']);
    otkaz('Не удалось записать цены в хранилище кода. Попробуйте ещё раз через минуту.');
  }
  const commit = dannye['commit'] as { sha?: string } | undefined;
  if (typeof commit?.sha !== 'string') {
    otkaz('Хранилище кода приняло цены, но не сказало, под какой меткой.');
  }
  return (commit as { sha: string }).sha;
}

export type Sborka =
  | { vid: 'net' }
  | { vid: 'idet' }
  | { vid: 'vyshla' }
  | { vid: 'ne_vyshla'; pochemu: string };

/**
 * Что стало со сборкой сайта по этой метке.
 *
 * Ищем именно ВЫКЛАДКУ САЙТА, а не любой прогон: по пушу их запускается
 * несколько, и «прошло» одного не значит ничего про другой. Отбираем
 * по пути к файлу прогона — он не зависит ни от языка, ни от названия.
 */
export async function sborka(n: Nastroyki, metka: string, put = '.github/workflows/deploy.yml'): Promise<Sborka> {
  const { kod, dannye } = await zapros(
    n,
    `/repos/${n.hranilishche}/actions/runs?head_sha=${encodeURIComponent(metka)}&per_page=20`,
  );
  if (kod !== 200) otkaz('Не удалось спросить хранилище кода, собрался ли сайт.');
  const progony = (dannye['workflow_runs'] as { path?: string; status?: string; conclusion?: string }[]) ?? [];
  const nash = progony.find((p) => p.path === put);
  if (!nash) return { vid: 'net' };
  if (nash.status !== 'completed') return { vid: 'idet' };
  if (nash.conclusion === 'success') return { vid: 'vyshla' };
  if (nash.conclusion === 'cancelled') return { vid: 'ne_vyshla', pochemu: 'Сборку сайта отменили.' };
  return {
    vid: 'ne_vyshla',
    pochemu: 'Сборка сайта не прошла. Цены отправлены, но на витрину не попали.',
  };
}
