export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800 ${className}`} />;
}

/** Standard page-loading block: a card + a few rows. */
export function PageSkeleton() {
  return (
    <div className="px-4 pt-6 flex flex-col gap-4">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-36 w-full rounded-2xl" />
      <Skeleton className="h-5 w-24 mt-2" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
