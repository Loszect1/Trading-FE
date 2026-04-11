import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { UI_TEXT } from "@/constants/ui-text";

export default function Home() {
  return (
    <div className="min-h-screen">
      <SiteNav />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
        <section className="glass-panel rounded-2xl p-8">
          <p className="inline-flex rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-xs font-medium tracking-[0.12em] text-cyan-100">
            {UI_TEXT.home.badge}
          </p>
          <h1 className="mt-4 text-4xl font-semibold text-slate-100">{UI_TEXT.home.title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
            {UI_TEXT.home.description}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/market"
              className="accent-ring rounded-md bg-cyan-300/20 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/30"
            >
              {UI_TEXT.home.openMarket}
            </Link>
            <Link
              href="/trade"
              className="rounded-md border border-white/20 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/8"
            >
              {UI_TEXT.home.openTrade}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
