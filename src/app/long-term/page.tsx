import { LongTermResearchClient } from "@/components/long-term-research-client";
import { SiteNav } from "@/components/site-nav";

export const revalidate = 0;

export default function LongTermResearchPage() {
  return (
    <div className="min-h-screen">
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <LongTermResearchClient />
      </main>
    </div>
  );
}
