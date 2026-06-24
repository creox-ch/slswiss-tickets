import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client с service_role ключом.
 * НИКОГДА не импортируй это в клиентский компонент — ключ обходит RLS.
 * Используется только в API routes (они выполняются на сервере).
 *
 * ВАЖНО: клиент создаётся ЛЕНИВО — при первом обращении в рантайме, а не при
 * импорте модуля. Иначе сборка на Vercel падает («Failed to collect page data»),
 * потому что во время build env-переменных может не быть, а createClient требует URL+key.
 */

let _client = null;

function client() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        'Supabase не сконфигурирован: задай SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в env.'
      );
    }
    _client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

// Ленивый прокси: call-site'ы продолжают писать supabaseAdmin.from(...),
// но реальный клиент создаётся только при первом вызове (в рантайме).
export const supabaseAdmin = new Proxy(
  {},
  {
    get(_target, prop) {
      const c = client();
      const value = c[prop];
      return typeof value === 'function' ? value.bind(c) : value;
    },
  }
);
