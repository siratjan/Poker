import { Skeleton } from '@/components/ui/Skeleton';

/** Loading state of the login screen (WP9, step 3): the card in its final size. */
export default function Loading() {
  return (
    <main className="flex flex-1 items-center justify-center p-6" aria-busy="true">
      <span className="sr-only">Anmeldung wird geladen …</span>
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-black/10 p-6 dark:border-white/10">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-2 h-13 w-full rounded-xl" />
      </div>
    </main>
  );
}
