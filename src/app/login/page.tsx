import type { Metadata } from 'next';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { HOME_PATH, safeNextPath } from '@/lib/auth/paths';
import { loginErrorMessage } from '@/lib/auth/loginErrors';

export const metadata: Metadata = {
  title: 'Anmelden – Poker-Kasse',
};

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams;
  const next = safeNextPath(firstValue(params.next), HOME_PATH);
  const errorCode = firstValue(params.error);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-black/[0.02] p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
        <h1 className="text-center text-2xl font-semibold tracking-tight">Poker-Kasse</h1>
        <p className="mt-2 mb-6 text-center text-sm opacity-70">
          Melde dich mit deinem Google-Konto an.
        </p>

        {errorCode !== undefined && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
          >
            {loginErrorMessage(errorCode)}
          </p>
        )}

        <GoogleSignInButton next={next} />
      </div>
    </main>
  );
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
