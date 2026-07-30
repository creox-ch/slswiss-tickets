import { buildEventIcs } from '../../../../lib/forum-tickets';

export const runtime = 'nodejs';

/**
 * GET /api/forum/ics?d=1|2|both — файл календаря (.ics) для кнопки
 * «Добавить в календарь» в письме-билете форума.
 *
 * Событие статично (фиксированные даты Frankenplatz 2026), поэтому файл не
 * зависит от конкретного билета — параметр только выбирает день(и). Держим здесь,
 * в бэкенде платформы, чтобы не тащить генерацию на статический сайт форума.
 */
export function GET(req) {
  const d = new URL(req.url).searchParams.get('d');
  const day = d === '2' ? '2' : d === 'both' ? 'both' : '1'; // дефолт — день 1
  const body = buildEventIcs(day);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="frankenplatz-2026${day === 'both' ? '' : '-day' + day}.ics"`,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
