import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { sendMarketLoginEmail } from '../../../../../lib/ticket';
import { MARKET_EVENT_SLUG } from '../../../../../lib/market-packages';
import {
  normalizeEmail,
  isValidEmail,
  newLoginToken,
  hashToken,
  isAdminEmail,
  LOGIN_TOKEN_TTL_MS,
  RESEND_COOLDOWN_MS,
} from '../../../../../lib/market-auth';

export const runtime = 'nodejs';

/**
 * POST /api/market/auth/request — «пришлите ссылку для входа в кабинет».
 *
 * body: { email }
 *
 * Ответ ВСЕГДА одинаковый: {ok:true}. Иначе форма превращается в справочник
 * «кто у нас продавец» — по разнице ответов можно было бы перебирать адреса.
 * Всё остальное (есть ли оплата, ушло ли письмо) человек узнаёт из почты.
 *
 * Пускаем троих: у кого оплачен пакет маркета, кто уже заведён в кабинете
 * (например, продавца завели руками до оплаты) и модераторов из
 * MARKET_ADMIN_EMAILS — у них своей оплаты нет и не будет.
 */

/** Один ответ на все случаи — см. комментарий выше. */
function sameAnswer() {
  return NextResponse.json({
    ok: true,
    message: 'Если этот адрес есть у нас, письмо со ссылкой уже в пути.',
  });
}

export async function POST(req) {
  try {
    // Сначала разбираем сам запрос, потом смотрим на состояние сервиса:
    // «проверь e-mail» человеку полезнее, чем «сервис не настроен», а о чужих
    // данных опечатка в собственном адресе ничего не сообщает.
    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      return NextResponse.json({ ok: false, error: 'Проверь e-mail.' }, { status: 400 });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { ok: false, error: 'Кабинет пока недоступен — база не подключена.' },
        { status: 503 }
      );
    }
    if (!process.env.MARKET_SESSION_SECRET) {
      // Без секрета сессию не подписать: не делаем вид, что вход работает.
      return NextResponse.json(
        { ok: false, error: 'Кабинет пока недоступен — вход не настроен.' },
        { status: 503 }
      );
    }

    const known = await isKnownEmail(email);
    if (!known) return sameAnswer();

    // Антиспам: одно письмо в минуту на адрес. Кнопку жмут дважды из
    // нетерпения, и второе письмо гасило бы ссылку из первого.
    const { data: recent, error: recentErr } = await supabaseAdmin
      .from('market_auth_tokens')
      .select('created_at')
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentErr) throw new Error(`supabase select tokens: ${recentErr.message}`);
    if (recent && Date.now() - new Date(recent.created_at).getTime() < RESEND_COOLDOWN_MS) {
      return sameAnswer();
    }

    const token = newLoginToken();
    const { error: insErr } = await supabaseAdmin.from('market_auth_tokens').insert({
      email,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + LOGIN_TOKEN_TTL_MS).toISOString(),
    });
    if (insErr) throw new Error(`supabase insert token: ${insErr.message}`);

    const base = process.env.PUBLIC_BASE_URL || 'https://slswiss-tickets.vercel.app';
    const url = `${base}/api/market/auth/verify?token=${encodeURIComponent(token)}`;

    try {
      await sendMarketLoginEmail({
        to: email,
        url,
        minutes: Math.round(LOGIN_TOKEN_TTL_MS / 60000),
      });
    } catch (mailErr) {
      // Письмо не ушло — токен просто протухнет. Наружу не показываем:
      // разный ответ снова выдал бы, есть адрес в базе или нет.
      console.error('[market/auth/request] email failed', mailErr);
    }

    return sameAnswer();
  } catch (e) {
    console.error('[market/auth/request] error', e);
    return NextResponse.json({ ok: false, error: 'Не получилось. Попробуй ещё раз.' }, { status: 500 });
  }
}

/** Знаем ли мы этот адрес: продавец, оплата пакета или модератор. */
async function isKnownEmail(email) {
  if (isAdminEmail(email, process.env.MARKET_ADMIN_EMAILS)) return true;

  const { data: seller, error: sellerErr } = await supabaseAdmin
    .from('market_sellers')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (sellerErr) throw new Error(`supabase select seller: ${sellerErr.message}`);
  if (seller) return true;

  const { data: paid, error: paidErr } = await supabaseAdmin
    .from('tickets')
    .select('id')
    .eq('event_slug', MARKET_EVENT_SLUG)
    .eq('buyer_email', email)
    .in('status', ['paid', 'checked_in'])
    .limit(1)
    .maybeSingle();
  if (paidErr) throw new Error(`supabase select ticket: ${paidErr.message}`);
  return !!paid;
}
