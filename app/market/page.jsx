import { cookies } from 'next/headers';
import LoginForm from './login-form';
import LogoutButton from './logout-button';
import ItemList from './item-list';
import { SESSION_COOKIE, verifySession, isAdminEmail } from '../../lib/market-auth';
import { describePackage } from '../../lib/market-packages';

export const metadata = { title: 'Кабинет продавца — Frankenplatz Market' };
export const dynamic = 'force-dynamic'; // страница зависит от cookie, кэшировать нечего

/** Что показать после неудачного перехода по ссылке из письма. */
const LOGIN_PROBLEMS = {
  expired: 'Ссылка устарела — она живёт 30 минут. Запроси новую, это быстро.',
  used: 'По этой ссылке уже входили. Запроси новую — старая гасится после первого входа.',
  invalid: 'Ссылка не подошла. Скорее всего, она склеилась при пересылке — запроси новую.',
  unavailable: 'Кабинет пока не настроен. Напиши нам — разберёмся.',
  error: 'Что-то пошло не так на нашей стороне. Попробуй ещё раз.',
};

/**
 * Кабинет продавца бренд-маркета.
 *
 * Шаг 2 ТЗ docs/TZ-market-cabinet.md: вход работает, вещей ещё нет — форма
 * загрузки появится на шаге 3. Пустой кабинет показываем честно, а не прячем
 * за «скоро»: продавец должен видеть, что попал куда надо.
 */
export default async function MarketCabinetPage({ searchParams }) {
  const params = (await searchParams) || {};
  const problem = LOGIN_PROBLEMS[params.login] || null;

  const jar = await cookies();
  const email = verifySession(
    jar.get(SESSION_COOKIE)?.value,
    process.env.MARKET_SESSION_SECRET
  );

  if (!email) {
    return (
      <Shell>
        <h1 style={S.h1}>Кабинет продавца</h1>
        <p style={S.lead}>
          Здесь ты загружаешь вещи, следишь за спросом и видишь свои продажи. Вход — по
          ссылке на почту.
        </p>
        {problem && <p style={S.problem}>{problem}</p>}
        <LoginForm initialEmail={typeof params.email === 'string' ? params.email : ''} />
      </Shell>
    );
  }

  const moderator = isAdminEmail(email, process.env.MARKET_ADMIN_EMAILS);
  const seller = await loadSeller(email);
  const packageLabel = seller && seller.package ? describePackage(seller.package, false) : null;
  const items = await loadItems(seller && seller.id);

  return (
    <Shell>
      <div style={S.topRow}>
        <div>
          <p style={S.eyebrow}>Кабинет продавца</p>
          <h1 style={{ ...S.h1, marginTop: 6 }}>{seller && seller.name ? seller.name : email}</h1>
          {packageLabel && <p style={S.package}>Пакет: {packageLabel}</p>}
        </div>
        <LogoutButton />
      </div>

      {moderator && (
        <p style={S.badge}>
          Ты модератор. <a href="/market/admin" style={S.badgeLink}>Очередь на проверку →</a>
        </p>
      )}

      <section style={S.card}>
        <div style={S.sectionHead}>
          <h2 style={{ ...S.h2, margin: 0 }}>Твои вещи</h2>
          <a href="/market/items/new" style={S.addLink}>
            + Добавить вещь
          </a>
        </div>
        <ItemList items={items} />
      </section>

      <section style={S.card}>
        <h2 style={S.h2}>Что дальше</h2>
        <ul style={S.list}>
          <li>Мы проверяем описание и ставим карточку в каталог.</li>
          <li>Люди бронируют вещь или спрашивают о ней — ты видишь спрос здесь.</li>
          <li>
            На маркете 27 сентября вещь получает QR-этикетку; после продажи отмечаешь её
            проданной, и мы считаем комиссию.
          </li>
        </ul>
        <p style={S.hint}>
          Деньги за вещь покупатель отдаёт тебе напрямую — мы платежи не принимаем. Комиссия
          12% выставляется счётом после маркета.
        </p>
      </section>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <main style={S.page}>
      <div style={S.inner}>{children}</div>
    </main>
  );
}

/**
 * Карточка продавца — только чтобы поздороваться по имени и показать пакет.
 * Ошибку глотаем намеренно: человек уже прошёл проверку подписи, и падать
 * из-за недоступной базы страница не должна — кабинет останется рабочим,
 * просто без имени.
 */
async function loadSeller(email) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const { supabaseAdmin } = await import('../../lib/supabase');
    const { data } = await supabaseAdmin
      .from('market_sellers')
      .select('id, name, package')
      .eq('email', email)
      .maybeSingle();
    return data || null;
  } catch (e) {
    console.error('[market] seller lookup failed', e);
    return null;
  }
}

/** Вещи продавца. Ошибку тоже глотаем: пустой список лучше сломанной страницы. */
async function loadItems(sellerId) {
  if (!sellerId) return [];
  try {
    const { supabaseAdmin } = await import('../../lib/supabase');
    const { data } = await supabaseAdmin
      .from('market_items')
      .select(
        'id, item_no, brand, title, category, condition, size, price_rappen, status, photos, moderation_note'
      )
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });
    return data || [];
  } catch (e) {
    console.error('[market] items lookup failed', e);
    return [];
  }
}

/* Тёмная палитра Frankenplatz: кабинет — продолжение сайта маркета, а не стенда SoiLüDi. */
const S = {
  page: {
    minHeight: '100vh',
    background: '#0D0715',
    color: '#F3EEF9',
    fontFamily: "'Manrope', system-ui, -apple-system, sans-serif",
    padding: '40px 18px 60px',
  },
  inner: { maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  topRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  eyebrow: {
    margin: 0,
    fontSize: 12,
    letterSpacing: '.14em',
    textTransform: 'uppercase',
    color: '#B98BFF',
  },
  h1: { margin: 0, fontSize: 26, lineHeight: 1.25, wordBreak: 'break-word' },
  h2: { margin: '0 0 10px', fontSize: 18 },
  lead: { margin: 0, fontSize: 15.5, lineHeight: 1.65, color: '#C3B7D4' },
  text: { margin: '0 0 10px', fontSize: 15, lineHeight: 1.6, color: '#E6DEF2' },
  hint: { margin: 0, fontSize: 13, lineHeight: 1.55, color: '#7A6C93' },
  list: { margin: '0 0 10px', paddingLeft: 20, fontSize: 15, lineHeight: 1.7, color: '#E6DEF2' },
  card: {
    background: 'rgba(255,255,255,.04)',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 18,
    padding: '22px 24px',
  },
  badge: {
    margin: 0,
    padding: '12px 16px',
    borderRadius: 12,
    fontSize: 13.5,
    background: 'rgba(185,139,255,.12)',
    border: '1px solid rgba(185,139,255,.35)',
    color: '#D9C9FF',
  },
  problem: {
    margin: 0,
    padding: '14px 18px',
    borderRadius: 12,
    fontSize: 14,
    lineHeight: 1.55,
    background: 'rgba(230,180,80,.12)',
    border: '1px solid rgba(230,180,80,.4)',
    color: '#F5D9A0',
  },
  package: { margin: '6px 0 0', fontSize: 13.5, color: '#9A8BB3' },
  sectionHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  addLink: { fontSize: 14, color: '#F5C969', whiteSpace: 'nowrap' },
  badgeLink: { color: '#F5C969', fontWeight: 700 },
};
