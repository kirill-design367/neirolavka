import type { Metadata } from 'next';
import Link from 'next/link';
import { akt, golos, onest } from '@/lib/fonts';
import { formatPrice } from '@/lib/catalog';
import './fonts.css';

export const metadata: Metadata = {
  title: 'Гарнитуры — Нейролавка',
  description: 'Три варианта набора для сайта. Заголовок первого экрана и карточка тарифа каждым.',
};

type Variant = {
  key: string;
  name: string;
  /** Класс, задающий семейства внутри образца. */
  cls: string;
  recommended?: boolean;
  display: string;
  body: string;
  /** Абзац обоснования. */
  why: string;
  /** Что показала проверка бинарника. */
  cmap: { ru: string; ext: string; typo: string; cps: number; pairs: number; probe: string; locl: string };
};

const VARIANTS: Variant[] = [
  {
    key: 'a',
    name: 'Вариант А',
    cls: 'v-a',
    recommended: true,
    display: 'Akt',
    body: 'Golos Text',
    why:
      'Akt в заголовках даёт лавке голос, который не спутать с дефолтным интерфейсным гротеском: у него ниже строчные относительно прописных, чуть суше углы и заметно более узкая «о», отчего «Нейролавка» набирается плотно и звучит как вывеска, а не как шапка SaaS-продукта. Golos Text под ним отвечает за всё, что нужно читать и сверять: у него крупные строчные, спокойный ритм и табличные цифры, поэтому цена в чеке не пляшет при пересчёте. Пара работает на контрасте задач, а не на контрасте стилей — оба гротески, оба нарисованы кириллицей вперёд, и вместе они дают разницу голосов без разнобоя.',
    cmap: { ru: '66/66', ext: '23/23', typo: '13/15', cps: 238, pairs: 10374, probe: '18/36', locl: 'cyrl: BGR, BSH, CHU, MKD, SRB' },
  },
  {
    key: 'b',
    name: 'Вариант Б',
    cls: 'v-b',
    display: 'Golos Text',
    body: 'Golos Text',
    why:
      'Golos Text в одиночку, разница только весом. Гарнитура сделана Александрой Корольковой и Виталием Кузьминым для государственного портала, то есть ровно под задачу «человек должен понять с первого раза и не усомниться». Отсюда предельная утилитарность: ничего не отвлекает, всё читается, знак рубля и кавычки-ёлочки на месте. Это самый тихий из трёх вариантов и самый предсказуемый: он не добавляет лавке характера, зато и не мешает ей. Берите, если считаете, что доверие лучше строить на полном отсутствии выпендрёжа.',
    cmap: { ru: '66/66', ext: '23/23', typo: '15/15', cps: 172, pairs: 5746, probe: '24/36', locl: 'нет отдельных языковых систем cyrl' },
  },
  {
    key: 'v',
    name: 'Вариант В',
    cls: 'v-v',
    display: 'Onest',
    body: 'Onest',
    why:
      'Onest — самый геометричный и самый «сегодняшний» из трёх: широкие овалы, открытые апертуры, ровный ритм. Он делает страницу более технологичной и менее лавочной, и это осознанный сдвиг смысла: не маленькая честная лавка, а аккуратный современный сервис. Кириллица рисовалась как основной алфавит, покрытие полное. Кернинговых пар у него меньше, чем у соседей, но это не небрежность: гарнитура рассчитана на плотную посадку боковых, и в наборе это не мешает. Берите, если хотите, чтобы сайт читался скорее как продукт, чем как лавка.',
    cmap: { ru: '66/66', ext: '23/23', typo: '14/15', cps: 162, pairs: 485, probe: '10/36', locl: 'нет отдельных языковых систем cyrl' },
  },
];

function Specimen({ variant }: { variant: Variant }) {
  return (
    <section className={`spec ${variant.cls}`}>
      <header className="spec__head">
        <h2 className="spec__name">
          {variant.name}
          {variant.recommended && <span className="spec__badge">пока стоит этот</span>}
        </h2>
        <p className="spec__pair">
          Заголовки — {variant.display}. Текст и цифры — {variant.body}.
        </p>
      </header>

      {/* Заголовок первого экрана */}
      <div className="spec__hero">
        <p className="spec__eyebrow">Лавка доступа к нейросетям</p>
        <p className="spec__title">Нейролавка</p>
        <p className="spec__lead">
          Доступ к Claude и ChatGPT без иностранной карты и без возни с зарубежной
          регистрацией. Выбираете тариф здесь, платите привычным способом.
        </p>
      </div>

      {/* Карточка тарифа */}
      <div className="spec__tariff">
        <p className="spec__tariff-name">6 месяцев</p>
        <p className="spec__tariff-note">Полгода без продлений</p>
        <p className="spec__tariff-price tnum">{formatPrice(1)}</p>
        <span className="spec__tariff-badge">берут чаще всего</span>
      </div>

      <p className="spec__why">{variant.why}</p>

      <dl className="spec__cmap">
        <div>
          <dt>Русская азбука с Ё</dt>
          <dd className="tnum">{variant.cmap.ru}</dd>
        </div>
        <div>
          <dt>Украинский, белорусский, сербский</dt>
          <dd className="tnum">{variant.cmap.ext}</dd>
        </div>
        <div>
          <dt>Типографика, ₽, №, тире</dt>
          <dd className="tnum">{variant.cmap.typo}</dd>
        </div>
        <div>
          <dt>Кодовых позиций кириллицы</dt>
          <dd className="tnum">{variant.cmap.cps}</dd>
        </div>
        <div>
          <dt>Кириллических кернинг-пар</dt>
          <dd className="tnum">{variant.cmap.pairs.toLocaleString('ru-RU')}</dd>
        </div>
        <div>
          <dt>Из 36 трудных пар откернено</dt>
          <dd className="tnum">{variant.cmap.probe}</dd>
        </div>
        <div className="spec__cmap-wide">
          <dt>Локализованные формы</dt>
          <dd>{variant.cmap.locl}</dd>
        </div>
      </dl>
    </section>
  );
}

export default function FontsPage() {
  return (
    <div className={`${akt.variable} ${golos.variable} ${onest.variable} fonts`}>
      <div className="page">
        <header className="fonts__head">
          <Link href="/" className="fonts__back">
            ← На главную
          </Link>
          <h1 className="fonts__title">Три набора на выбор</h1>
          <p className="fonts__lead">
            Каждый показан на заголовке первого экрана и на карточке тарифа — на том,
            что на сайте встречается чаще всего. Все три проверены не по описанию,
            а по таблице cmap в самом файле шрифта: скрипты{' '}
            <code>scripts/audit-fonts.py</code> и <code>scripts/audit-kerning.py</code>.
          </p>
          <p className="fonts__note">
            «Трудные пары» — это 36 сочетаний вроде «Гу», «Ту», «Ль», «жд», которых нет
            в латинице: их нельзя откернуть заодно с латинскими, и по ним видно,
            занимался ли автор кириллицей всерьёз. Само по себе число не приговор —
            шрифт с хорошо посаженными боковыми обходится меньшим числом пар.
          </p>
        </header>

        {VARIANTS.map((variant) => (
          <Specimen key={variant.key} variant={variant} />
        ))}
      </div>
    </div>
  );
}
