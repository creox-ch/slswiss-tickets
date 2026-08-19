import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import ItemForm from '../../../../item-form';
import PhotoUploader from '../../../../photo-uploader';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { SESSION_COOKIE, verifySession, isAdminEmail } from '../../../../../../lib/market-auth';
import { formatItemNo } from '../../../../../../lib/market-items';

export const metadata = { title: 'Правка вещи — Frankenplatz Market' };
export const dynamic = 'force-dynamic';

/**
 * Правка вещи модератором.
 *
 * По пакету «Под ключ» продаём мы: описание пишет модератор, и поправить свою
 * же опечатку он должен сам. Описания и по остальным пакетам на нас (ТЗ §2,
 * шаг 02), поэтому экран доступен для любой вещи — кроме проданной и
 * забронированной, где поля заперты правилом статусов.
 */
export default async function AdminEditItemPage({ params }) {
  const jar = await cookies();
  const email = verifySession(jar.get(SESSION_COOKIE)?.value, process.env.MARKET_SESSION_SECRET);
  if (!email || !isAdminEmail(email, process.env.MARKET_ADMIN_EMAILS)) notFound();

  const { id } = await params;
  const { data: item, error } = await supabaseAdmin
    .from('market_items')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  // Ошибку базы не превращаем в «вещь не найдена»: пусть падает заметно,
  // иначе модератор решит, что вещь исчезла, и заведёт её заново.
  if (error) throw new Error(`supabase select item: ${error.message}`);
  if (!item) notFound();

  return (
    <main style={S.page}>
      <div style={S.inner}>
        <div style={S.top}>
          <div>
            <p style={S.eyebrow}>{formatItemNo(item.item_no) || 'Вещь'}</p>
            <h1 style={S.h1}>
              {item.brand} · {item.title}
            </h1>
          </div>
          <a href="/market/admin" style={S.link}>
            В очередь →
          </a>
        </div>

        <PhotoUploader
          itemId={item.id}
          initialPhotos={Array.isArray(item.photos) ? item.photos : []}
          supabaseUrl={process.env.SUPABASE_URL}
        />

        <ItemForm mode="admin" item={item} />
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
  h1: { margin: '6px 0 0', fontSize: 26, color: '#fff', lineHeight: 1.25 },
  link: { fontSize: 14, color: '#B98BFF', textDecoration: 'none', whiteSpace: 'nowrap' },
};
