import { SiteNav } from "@/components/site-nav";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <SiteNav />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
        <Skeleton className="h-7 w-40" />
        <div className="rounded-xl border border-black/10 bg-white p-6">
          <Skeleton className="h-5 w-80" />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
        <Skeleton className="h-72 w-full" />
      </main>
    </div>
  );
}
