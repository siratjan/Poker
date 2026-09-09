import { Skeleton, SkeletonList, SkeletonScreen } from '@/components/ui/Skeleton';

/**
 * Loading state of the session list (docs/ARBEITSPAKETE.md WP9, step 3), and
 * the fallback for every segment of the app group that has no closer one.
 */
export default function Loading() {
  return (
    <SkeletonScreen label="Sessions werden geladen …">
      <Skeleton className="h-6 w-28" />
      <SkeletonList count={4} lines={3} />
    </SkeletonScreen>
  );
}
