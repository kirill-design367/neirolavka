import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * Шапка второстепенной страницы: назад в лавку и переключатель темы.
 *
 * Счётчика и якорей здесь нет намеренно. На главной шапка ведёт
 * по разделам той же страницы; отсюда дорога ровно одна — обратно,
 * и предлагать вторую значило бы делать вид, что человек тут живёт.
 *
 * Компонент общий для оферты и инструкции. Вторая копия той же
 * разметки разъехалась бы с первой на первой же правке — и разъехалась
 * бы молча: второстепенные страницы рядом никто не открывает.
 */
export function ShapkaStranicy() {
  return (
    <header className="shapka">
      <div className="page shapka__in">
        <Link className="shapka__nazad" href="/">
          {/* Стрелка — не текст, её читать незачем. */}
          <span aria-hidden="true">←</span> Нейролавка
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
