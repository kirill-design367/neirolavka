export default function Home() {
  return (
    <main className="page" style={{ paddingBlock: 'var(--sp-8)' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--t-display)', lineHeight: 1 }}>
        Нейролавка
      </h1>
      <p style={{ color: 'var(--c-muted)', marginTop: 'var(--sp-4)' }}>
        Каркас поднят. Наполнение собирается.
      </p>
    </main>
  );
}
