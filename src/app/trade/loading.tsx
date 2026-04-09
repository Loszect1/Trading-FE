import { SiteNav } from "@/components/site-nav";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <Skeleton className="h-7 w-40" />
        <div className="mt-6 rounded-xl border border-black/10 bg-white p-4">
          <Skeleton className="h-10 w-64" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      </main>
    </div>
  );
}
