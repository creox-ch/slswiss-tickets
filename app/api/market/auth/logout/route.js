import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../../../lib/market-auth';

export const runtime = 'nodejs';

/**
 * POST /api/market/auth/logout — выйти из кабинета.
 *
 * Сессия живёт в подписанной cookie, серверного состояния у неё нет, поэтому
 * выход — это удаление cookie. На чужом или общем компьютере кнопка нужна.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
