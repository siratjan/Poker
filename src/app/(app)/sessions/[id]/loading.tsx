import { Skeleton, SkeletonCard, SkeletonList, SkeletonScreen } from '@/components/ui/Skeleton';

/**
 * Loading state of the session detail (WP9, step 3): header, the four tiles,
 * the participant list. Same grid as the real screen, so nothing jumps when the
 * data arrives.
 */
export default function Loading() {
  return (
    <SkeletonScreen label="Session wird geladen …">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>

      <Skeleton className="h-5 w-28" />
      <SkeletonList count={4} lines={3} />
    </SkeletonScreen>
  );
}
