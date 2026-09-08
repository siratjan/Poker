import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';
import { publicEnv } from '@/lib/env';

/**
 * Supabase client for browser / client components.
 * Read-only usage only: every write goes through a server action (see CLAUDE.md).
 * The only exception is auth (sign-in), which has to happen in the browser.
 */
export function createClient() {
  const env = publicEnv();

  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
