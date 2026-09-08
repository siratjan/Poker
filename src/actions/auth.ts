'use server';

import { redirect } from 'next/navigation';
import { LOGIN_PATH } from '@/lib/auth/paths';
import { createClient } from '@/lib/supabase/server';

/**
 * Ends the session and sends the visitor to the login page.
 *
 * Used as a `<form action={signOut}>`, so it returns nothing: `redirect()`
 * throws the NEXT_REDIRECT signal, which must not be caught here.
 */
export async function signOut(): Promise<never> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error !== null) {
    // The cookies are cleared either way; the visitor still lands on /login,
    // where a fresh sign-in is possible.
    console.error('[auth] signOut:', error.message);
  }

  redirect(LOGIN_PATH);
}
