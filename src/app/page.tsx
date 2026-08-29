import { getCatalog } from '@/lib/catalog';
import { SmoothScroll } from '@/lib/motion';
import { Nav } from '@/components/Nav';
import { Hero } from '@/components/Hero';

export default function Home() {
  const catalog = getCatalog();

  return (
    <>
      <SmoothScroll />
      <Nav subscribers={catalog.subscribers} />
      <div className="layout page">
        <main className="layout__main">
          <Hero />
        </main>
      </div>
    </>
  );
}
