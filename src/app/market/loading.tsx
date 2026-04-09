import { SiteNav } from "@/components/site-nav";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <Skeleton className="h-7 w-56" />
        <div className="mt-6 rounded-xl border border-black/10 bg-white p-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-10 w-full" />
          <Skeleton className="mt-3 h-10 w-full" />
        </div>
      </main>
    </div>
  );
}
