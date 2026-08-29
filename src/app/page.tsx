import { ThemeToggle } from '@/components/ThemeToggle';

export default function Home() {
  return (
    <main className="page" style={{ paddingBlock: 'var(--sp-8)' }}>
      <ThemeToggle />
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--t-display)', lineHeight: 1, color: 'var(--c-brand)' }}>
        Нейролавка
      </h1>
    </main>
  );
}
