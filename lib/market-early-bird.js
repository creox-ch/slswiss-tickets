/**
 * Early Bird пакета маркета: активна ли ещё сниженная цена.
 *
 * Жил внутри app/api/market/create; вынесен, когда цену понадобилось считать в
 * двух местах — при покупке и при проверке промокода на витрине. Считать по-разному
 * нельзя: человек увидел бы на кнопке одну сумму, а в Payrexx ушла бы другая.
 *
 * Мягкий счётчик: пороги «первым N» маркетинговые, и при одновременных
 * оформлениях EB может достаться чуть большему числу людей — это не вредно.
 * Считаем по ОПЛАЧЕННЫМ строкам: брошенная корзина скидку не жжёт.
 */

import { supabaseAdmin } from './supabase';
import { ebLimitFor, MARKET_EVENT_SLUG } from './market-packages';

export async function marketEarlyBirdActive(pkg) {
  const limit = ebLimitFor(pkg);
  if (!limit) return false;
  const { count, error } = await supabaseAdmin
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('event_slug', MARKET_EVENT_SLUG)
    .eq('payload->>package', pkg)
    .eq('payload->>earlyBird', 'true')
    .in('status', ['paid', 'checked_in']);
  if (error) throw new Error(`supabase count: ${error.message}`);
  return (count || 0) < limit;
}
