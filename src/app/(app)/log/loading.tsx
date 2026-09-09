import { Skeleton, SkeletonList, SkeletonScreen } from '@/components/ui/Skeleton';

/** Loading state of the audit log (WP9, step 3): heading, filters, entries. */
export default function Loading() {
  return (
    <SkeletonScreen label="Log wird geladen …">
      <Skeleton className="h-6 w-16" />
      <Skeleton className="h-4 w-3/4" />
      <div className="flex gap-2">
        <Skeleton className="h-11 flex-1 rounded-xl" />
        <Skeleton className="h-11 flex-1 rounded-xl" />
      </div>
      <SkeletonList count={8} lines={2} />
    </SkeletonScreen>
  );
}
