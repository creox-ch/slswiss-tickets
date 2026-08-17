import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import ItemForm from '../../../item-form';
import PhotoUploader from '../../../photo-uploader';
import { SESSION_COOKIE, verifySession } from '../../../../../lib/market-auth';

export const metadata = { title: 'Правка вещи — кабинет продавца' };
export const dynamic = 'force-dynamic';

/**
 * Правка заведённой вещи. Чужую не отдаём: ищем строго среди вещей продавца
 * из сессии, а не по одному id — id угадать несложно.
 */
export default async function EditItemPage({ params }) {
  const { id } = await params;
  const jar = await cookies();
  const email = verifySession(jar.get(SESSION_COOKIE)?.value, process.env.MARKET_SESSION_SECRET);
  if (!email) redirect('/market');

  const item = await loadOwnItem(email, id);
  if (!item) notFound();

  return (
    <main style={S.page}>
      <div style={S.inner}>
        <a href="/market" style={S.back}>
          ← В кабинет
        </a>
        <h1 style={S.h1}>{item.title || 'Правка вещи'}</h1>
        {item.status === 'rejected' && item.moderation_note && (
          <p style={S.note}>Причина отказа: {item.moderation_note}</p>
        )}

        <section style={S.block}>
          <PhotoUploader
            itemId={item.id}
            initialPhotos={Array.isArray(item.photos) ? item.photos : []}
            supabaseUrl={process.env.SUPABASE_URL}
          />
        </section>

        <ItemForm item={item} />
      </div>
    </main>
  );
}

async function loadOwnItem(email, id) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const { supabaseAdmin } = await import('../../../../../lib/supabase');
    const { data: seller } = await supabaseAdmin
      .from('market_sellers')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (!seller) return null;

    const { data } = await supabaseAdmin
      .from('market_items')
      .select('*')
      .eq('id', id)
      .eq('seller_id', seller.id)
      .maybeSingle();
    return data || null;
  } catch (e) {
    console.error('[market] item lookup failed', e);
    return null;
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
  inner: { maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 },
  back: { fontSize: 14, color: '#B98BFF', textDecoration: 'none' },
  h1: { margin: 0, fontSize: 26 },
  block: {
    background: 'rgba(255,255,255,.04)',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 16,
    padding: '18px 20px',
  },
  note: {
    margin: 0,
    padding: '12px 16px',
    borderRadius: 12,
    background: 'rgba(255,120,120,.1)',
    border: '1px solid rgba(255,120,120,.35)',
    color: '#FF9B9B',
    fontSize: 14,
  },
};
