export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/10 ${className}`} />;
}

export function SkeletonCardList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ui-card relative overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] grid-rows-2 items-start gap-x-3 gap-y-2">
            <Skeleton className="h-3.5 w-[62%]" />
            <Skeleton className="h-5 w-[72px] justify-self-end rounded-full" />
            <Skeleton className="h-2.5 w-[38%]" />
            <Skeleton className="h-2.5 w-[64px] justify-self-end" />
          </div>
          <div className="absolute top-0 bottom-0 left-0 w-1 bg-white/10" />
        </div>
      ))}
    </div>
  );
}
