import type { Database } from '@cronista/db';
import { createClient } from '@supabase/supabase-js';

/**
 * The app's Supabase client: it signs in, reads through RLS and receives live events.
 *
 * @remarks
 * The implicit flow returns the session in the URL fragment, which never reaches a server, and the
 * client removes it from the address bar. The session lives in `localStorage` so an installed app
 * stays signed in; the strict CSP (`script-src 'self'`) is what keeps other scripts away from it.
 */
export const supabase = createClient<Database>(__SUPABASE_URL__, __SUPABASE_PUBLISHABLE_KEY__, {
  auth: {
    flowType: 'implicit',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
