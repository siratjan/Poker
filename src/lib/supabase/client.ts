import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for browser / client components.
 * Read-only usage only: every write goes through a server action (see CLAUDE.md).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
