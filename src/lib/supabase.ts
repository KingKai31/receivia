import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Falls back to inert placeholders so the shell still renders when .env is not filled in yet.
export const supabase = createClient(
  env.supabaseUrl ?? 'http://127.0.0.1:54321',
  env.supabaseAnonKey ?? 'missing-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true } },
);
