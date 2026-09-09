import { Skeleton, SkeletonCard, SkeletonScreen } from '@/components/ui/Skeleton';

/** Loading state of the admin area (WP9, step 3): the three sections. */
export default function Loading() {
  return (
    <SkeletonScreen label="Admin-Bereich wird geladen …">
      <Skeleton className="h-6 w-16" />
      <SkeletonCard lines={4} />
      <SkeletonCard lines={4} />
      <SkeletonCard lines={3} />
    </SkeletonScreen>
  );
}
