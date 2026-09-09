import { z } from 'zod';

/**
 * Central, validated access to the public environment variables.
 *
 * Every Supabase helper goes through here instead of using non-null
 * assertions on `process.env` (WP0 review finding F6): a missing or
 * mistyped `.env.local` then fails with one readable German message
 * instead of an obscure crash inside the Supabase client on every request.
 *
 * Only `NEXT_PUBLIC_*` variables are read. Next.js inlines those at build
 * time, which requires a literal `process.env.NEXT_PUBLIC_...` expression —
 * that is why `readPublicEnv()` spells both names out.
 */

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({
    message: 'muss eine vollständige URL sein, z. B. https://<projekt>.supabase.co',
  }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .trim()
    .min(1, { message: 'darf nicht leer sein' }),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/** Thrown when the environment is unusable. Message is German and actionable. */
export class EnvError extends Error {
  readonly code = 'ENV_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

/**
 * Validates an environment-like object. Pure, so it can be unit tested
 * without touching `process.env`.
 */
export function parseEnv(source: Record<string, string | undefined>): PublicEnv {
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  if (parsed.success) {
    return parsed.data;
  }

  const details = parsed.error.issues
    .map((issue) => {
      const name = String(issue.path[0] ?? '(unbekannt)');
      const value = source[name];
      const reason =
        value === undefined || value === ''
          ? 'fehlt oder ist leer'
          : issue.message;
      return `- ${name}: ${reason}`;
    })
    .sort()
    .join('\n');

  throw new EnvError(
    `Die Konfiguration ist unvollständig:\n${details}\n` +
      'Lege eine .env.local nach dem Muster von .env.example an ' +
      '(Werte im Supabase-Dashboard unter Project Settings → API) ' +
      'und starte den Server neu.',
  );
}

let cached: PublicEnv | null = null;

/**
 * The validated public environment. Validated once per process; the result is
 * reused afterwards. Throws {@link EnvError} when the configuration is broken.
 */
export function publicEnv(): PublicEnv {
  if (cached === null) {
    cached = parseEnv({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
  }
  return cached;
}

/** Test seam: forget the memoized value. */
export function resetPublicEnvCache(): void {
  cached = null;
}

/**
 * True while `next dev` runs, false in every deployed environment.
 *
 * Lives here because this module is the only place that reads `process.env`
 * (Gaby WP2 test „liest process.env nur in src/lib/env.ts"). Used by the OAuth
 * callback to decide whether the `x-forwarded-*` headers come from a real proxy
 * (WP10; see src/lib/auth/origin.ts).
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}
