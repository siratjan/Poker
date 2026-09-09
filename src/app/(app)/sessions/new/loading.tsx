import { Skeleton, SkeletonScreen } from '@/components/ui/Skeleton';

/** Loading state of „Neue Session“ (WP9, step 3): date, name, button. */
export default function Loading() {
  return (
    <SkeletonScreen label="Formular wird geladen …">
      <Skeleton className="h-6 w-36" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-13 w-full rounded-xl" />
    </SkeletonScreen>
  );
}
