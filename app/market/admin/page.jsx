import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import ModerationList from './moderation-list';
import { SESSION_COOKIE, verifySession, isAdminEmail } from '../../../lib/market-auth';

export const metadata = { title: 'Модерация — Frankenplatz Market' };
export const dynamic = 'force-dynamic';

/**
 * Экран организатора: очередь вещей на проверку.
 *
 * Права даёт адрес из MARKET_ADMIN_EMAILS (решение 17.08 — доступ по email, а
 * не по ключу). Постороннему отвечаем 404, а не «нет прав»: о существовании
 * раздела ему знать незачем.
 */
export default async function ModerationPage({ searchParams }) {
  const params = (await searchParams) || {};
  const status = typeof params.status === 'string' ? params.status : 'pending';

  const jar = await cookies();
  const email = verifySession(jar.get(SESSION_COOKIE)?.value, process.env.MARKET_SESSION_SECRET);
  if (!email || !isAdminEmail(email, process.env.MARKET_ADMIN_EMAILS)) notFound();

  const items = await loadItems(status);

  return (
    <main style={S.page}>
      <div style={S.inner}>
        <div style={S.top}>
          <div>
            <p style={S.eyebrow}>Модерация</p>
            <h1 style={S.h1}>
              {TAB_LABEL[status] || status}
              <span style={S.count}> · {items.length}</span>
            </h1>
          </div>
          <a href="/market" style={S.link}>
            В кабинет →
          </a>
        </div>

        <nav style={S.tabs}>
          {Object.entries(TAB_LABEL).map(([key, label]) => (
            <a
              key={key}
              href={`/market/admin?status=${key}`}
              style={{ ...S.tab, ...(key === status ? S.tabActive : null) }}
            >
              {label}
            </a>
          ))}
        </nav>

        <ModerationList items={items} status={status} supabaseUrl={process.env.SUPABASE_URL} />
      </div>
    </main>
  );
}

const TAB_LABEL = {
  pending: 'На проверке',
  approved_market: 'В каталоге и на маркете',
  approved_online: 'Только в каталоге',
  rejected: 'Не приняли',
  all: 'Все',
};

async function loadItems(status) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  try {
    const { supabaseAdmin } = await import('../../../lib/supabase');
    let query = supabaseAdmin
      .from('market_items')
      .select(
        'id, item_no, brand, title, category, condition, size, price_rappen, recommended_price_rappen, has_docs, description_ru, photos, status, moderation_note, seller_id, created_at'
      )
      .order('created_at', { ascending: true });
    if (status !== 'all') query = query.eq('status', status);

    const { data: items } = await query;
    const rows = items || [];

    const ids = [...new Set(rows.map((i) => i.seller_id).filter(Boolean))];
    if (!ids.length) return rows;

    const { data: sellers } = await supabaseAdmin
      .from('market_sellers')
      .select('id, email, name, package')
      .in('id', ids);
    const byId = Object.fromEntries((sellers || []).map((s) => [s.id, s]));
    return rows.map((i) => ({ ...i, seller: byId[i.seller_id] || null }));
  } catch (e) {
    console.error('[market/admin] load failed', e);
    return [];
  }
}

const S = {
  page: {
    minHeight: '100vh',
    background: '#0D0715',
    color: '#F3EEF9',
    fontFamily: "'Manrope', system-ui, -apple-system, sans-serif",
    padding: '32px 18px 60px',
  },
  inner: { maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  eyebrow: { margin: 0, fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#B98BFF' },
  h1: { margin: '6px 0 0', fontSize: 24 },
  count: { color: '#7A6C93', fontWeight: 500 },
  link: { fontSize: 14, color: '#F5C969', whiteSpace: 'nowrap' },
  tabs: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  tab: {
    padding: '8px 14px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,.14)',
    color: '#C3B7D4',
    fontSize: 13.5,
    textDecoration: 'none',
  },
  tabActive: { borderColor: '#E6B450', color: '#F5C969', background: 'rgba(230,180,80,.12)' },
};
