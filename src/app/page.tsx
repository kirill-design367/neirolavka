import { getCatalog } from '@/lib/catalog';
import { OrderProvider } from '@/lib/order';
import { SmoothScroll } from '@/lib/motion';
import { Nav } from '@/components/Nav';
import { Hero } from '@/components/Hero';
import { Shop } from '@/components/Shop';
import { Steps } from '@/components/Steps';
import { Referral } from '@/components/Referral';
import { Footer } from '@/components/Footer';
import { OrderPanel, OrderBar } from '@/components/OrderPanel';

export default function Home() {
  const catalog = getCatalog();

  return (
    <OrderProvider>
      <SmoothScroll />
      <Nav subscribers={catalog.subscribers} />

      {/* Десктоп: слева содержимое, справа липкий чек.
          Телефон: одна колонка, чек уезжает в нижнюю полосу. */}
      <div className="layout page">
        <main className="layout__main">
          <Hero />
          <Shop />
          <Steps />
          <Referral />
        </main>

        <div className="layout__side">
          <OrderPanel />
        </div>
      </div>

      <Footer />
      <OrderBar />
    </OrderProvider>
  );
}
