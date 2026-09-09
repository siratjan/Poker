import Link from 'next/link';
import { buttonClasses } from '@/components/ui/Button';

/**
 * 404 in German (WP9, step 3). `notFound()` from the session and player detail
 * pages ends up here, and so does every mistyped URL.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 items-center px-4 py-10">
      <div className="flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed border-black/15 px-6 py-12 text-center dark:border-white/15">
        <p className="text-base font-medium">Diese Seite gibt es nicht.</p>
        <p className="max-w-xs text-sm opacity-80">
          Vielleicht wurde die Session gelöscht oder der Link ist alt.
        </p>
        <Link href="/" className={buttonClasses({ size: 'lg' })}>
          Zu den Sessions
        </Link>
      </div>
    </main>
  );
}
