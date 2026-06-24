import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client с service_role ключом.
 * НИКОГДА не импортируй это в клиентский компонент — ключ обходит RLS.
 * Используется только в API routes (они выполняются на сервере).
 */
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
