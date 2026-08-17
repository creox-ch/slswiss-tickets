import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import ItemForm from '../../item-form';
import { SESSION_COOKIE, verifySession } from '../../../../lib/market-auth';

export const metadata = { title: 'Новая вещь — кабинет продавца' };
export const dynamic = 'force-dynamic';

/** Экран «завести вещь». Без сессии сюда не пускаем — уводим на вход. */
export default async function NewItemPage() {
  const jar = await cookies();
  const email = verifySession(jar.get(SESSION_COOKIE)?.value, process.env.MARKET_SESSION_SECRET);
  if (!email) redirect('/market');

  return (
    <main style={S.page}>
      <div style={S.inner}>
        <a href="/market" style={S.back}>
          ← В кабинет
        </a>
        <h1 style={S.h1}>Новая вещь</h1>
        <p style={S.lead}>
          Описание, фильтры и перевод на немецкий с английским — на нас. От тебя: что за вещь,
          в каком состоянии и за сколько отдаёшь.
        </p>
        <ItemForm />
      </div>
    </main>
  );
}

const S = {
  page: {
    minHeight: '100vh',
    background: '#0D0715',
    color: '#F3EEF9',
    fontFamily: "'Manrope', system-ui, -apple-system, sans-serif",
    padding: '32px 18px 60px',
  },
  inner: { maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 },
  back: { fontSize: 14, color: '#B98BFF', textDecoration: 'none' },
  h1: { margin: 0, fontSize: 26 },
  lead: { margin: '0 0 8px', fontSize: 15, lineHeight: 1.6, color: '#C3B7D4' },
};
