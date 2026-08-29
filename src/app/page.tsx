import { getCatalog } from '@/lib/catalog';
import { OrderProvider } from '@/lib/order';
import { SmoothScroll } from '@/lib/motion';
import { Nav } from '@/components/Nav';
import { Hero } from '@/components/Hero';
import { Shop } from '@/components/Shop';

export default function Home() {
  const catalog = getCatalog();

  return (
    <OrderProvider>
      <SmoothScroll />
      <Nav subscribers={catalog.subscribers} />
      <div className="layout page">
        <main className="layout__main">
          <Hero />
          <Shop />
        </main>
      </div>
    </OrderProvider>
  );
}
