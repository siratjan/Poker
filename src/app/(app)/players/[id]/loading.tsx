import { Skeleton, SkeletonCard, SkeletonList, SkeletonScreen } from '@/components/ui/Skeleton';

/** Loading state of the player detail (WP9, step 3): balance card, then evenings. */
export default function Loading() {
  return (
    <SkeletonScreen label="Spieler wird geladen …">
      <Skeleton className="h-4 w-28" />
      <SkeletonCard lines={5} />
      <Skeleton className="h-5 w-20" />
      <SkeletonList count={4} lines={2} />
    </SkeletonScreen>
  );
}
