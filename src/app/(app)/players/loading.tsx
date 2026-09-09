import { Skeleton, SkeletonList, SkeletonScreen } from '@/components/ui/Skeleton';

/** Loading state of the player overview (WP9, step 3): heading, search, rows. */
export default function Loading() {
  return (
    <SkeletonScreen label="Spieler werden geladen …">
      <Skeleton className="h-6 w-20" />
      <Skeleton className="h-11 w-full rounded-xl" />
      <SkeletonList count={6} lines={2} />
    </SkeletonScreen>
  );
}
