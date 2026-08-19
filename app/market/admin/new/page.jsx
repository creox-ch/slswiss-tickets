import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import ItemForm from '../../item-form';
import { SESSION_COOKIE, verifySession, isAdminEmail } from '../../../../lib/market-auth';

export const metadata = { title: 'Завести вещь за продавца — Frankenplatz Market' };
export const dynamic = 'force-dynamic';

/**
 * Пакет «Под ключ» (249 CHF): коробку разбирает и заводит организатор, продавец
 * не делает ничего. До 19.08 этого экрана не было вовсе — роут заведения
 * существовал, но позвать его было неоткуда, и пакет нельзя было исполнить.
 *
 * Права те же, что у очереди: адрес из MARKET_ADMIN_EMAILS, постороннему 404.
 */
export default async function NewItemForSellerPage() {
  const jar = await cookies();
  const email = verifySession(jar.get(SESSION_COOKIE)?.value, process.env.MARKET_SESSION_SECRET);
  if (!email || !isAdminEmail(email, process.env.MARKET_ADMIN_EMAILS)) notFound();

  return (
    <main style={S.page}>
      <div style={S.inner}>
        <div style={S.top}>
          <div>
            <p style={S.eyebrow}>Под ключ</p>
            <h1 style={S.h1}>Завести вещь за продавца</h1>
          </div>
          <a href="/market/admin" style={S.link}>
            В очередь →
          </a>
        </div>
        <p style={S.lead}>
          Вещь встанет в очередь на проверку от имени указанного продавца. Если такого адреса ещё
          нет, продавец заведётся автоматически — поэтому адрес стоит сверить со списком оплативших.
        </p>
        <ItemForm mode="admin" />
      </div>
    </main>
  );
}

const S = {
  page: { minHeight: '100vh', background: '#140F1C', padding: '40px 20px 80px' },
  inner: { maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  top: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    letterSpacing: '.14em',
    textTransform: 'uppercase',
    color: '#B98BFF',
  },
  h1: { margin: '6px 0 0', fontSize: 28, color: '#fff' },
  link: { fontSize: 14, color: '#B98BFF', textDecoration: 'none', whiteSpace: 'nowrap' },
  lead: { margin: 0, fontSize: 14.5, lineHeight: 1.6, color: '#C3B7D4' },
};
