import { OperationalDashboardClient } from "@/components/operational-dashboard-client";
import { SiteNav } from "@/components/site-nav";
import { UI_TEXT } from "@/constants/ui-text";

export const revalidate = 0;

export default function OperationsPage() {
  return (
    <div className="min-h-screen">
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-slate-100">{UI_TEXT.operations.pageTitle}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">{UI_TEXT.operations.pageIntro}</p>
        <div className="mt-8">
          <OperationalDashboardClient />
        </div>
      </main>
    </div>
  );
}
