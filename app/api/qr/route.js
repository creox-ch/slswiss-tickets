import { NextResponse } from 'next/server';
import QRCode from 'qrcode';

export const runtime = 'nodejs';

/**
 * GET /api/qr?t=TOKEN — PNG с QR-кодом для письма.
 * Кодируем ссылку на сканер .../scan?t=TOKEN (как и во вложении).
 * Хостинг картинки по URL надёжнее cid-вложения: открывается во всех почтовиках.
 */
export async function GET(req) {
  const url = new URL(req.url);
  const t = url.searchParams.get('t');
  if (!t) return new NextResponse('missing t', { status: 400 });
  // наши токены — 32 hex-символа; не даём рендерить QR из произвольных строк
  // (открытый генератор = бесплатный CPU + фишинговые QR с нашего домена)
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(t)) return new NextResponse('bad t', { status: 400 });

  const base = process.env.PUBLIC_BASE_URL || 'https://slswiss-tickets.vercel.app';
  const payload = `${base}/scan?t=${encodeURIComponent(t)}`;
  const png = await QRCode.toBuffer(payload, { width: 320, margin: 1 });

  return new NextResponse(png, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
