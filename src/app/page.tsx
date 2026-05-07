import Link from "next/link";
import { HomeNewsSection } from "@/components/home-news-section";
import { SiteNav } from "@/components/site-nav";
import { UI_TEXT } from "@/constants/ui-text";

export default function Home() {
  const quickActions = [
    {
      href: "/market",
      label: UI_TEXT.home.openMarket,
      title: UI_TEXT.nav.market,
      description: "Scanner, bộ lọc sàn và danh sách mã.",
    },
    {
      href: "/trade",
      label: UI_TEXT.home.openTrade,
      title: UI_TEXT.nav.trade,
      description: "Đặt lệnh, phiên DNSE và trạng thái tài khoản.",
    },
    {
      href: "/auto-trading",
      label: UI_TEXT.home.openAutoTrading,
      title: UI_TEXT.nav.autoTrading,
      description: "Demo, tín hiệu, scheduler và thực thi tự động.",
    },
  ];

  return (
    <div className="min-h-screen">
      <SiteNav />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
        <section className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <div className="py-2">
            <p className="text-xs font-semibold uppercase text-cyan-200">{UI_TEXT.home.badge}</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold text-slate-50">
              {UI_TEXT.home.title}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">{UI_TEXT.home.description}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 lg:grid-cols-1">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-[11px] uppercase text-slate-500">Phạm vi</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">VNStock + DNSE</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-[11px] uppercase text-slate-500">Luồng chính</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">Market, Trade, Auto</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-[11px] uppercase text-slate-500">Giám sát</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">Risk + Runtime</p>
            </div>
          </div>
        </section>
        <section className="grid gap-3 lg:grid-cols-3">
          {quickActions.map((action, index) => (
            <Link
              key={action.href}
              href={action.href}
              className={`group rounded-xl border p-4 transition ${
                index === 0
                  ? "border-cyan-300/40 bg-cyan-300/10 hover:bg-cyan-300/[0.14]"
                  : "border-white/10 bg-white/[0.03] hover:border-cyan-300/30 hover:bg-white/[0.05]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-50">{action.title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{action.description}</p>
                </div>
                <span className="rounded-md border border-white/10 px-2 py-1 text-xs font-semibold text-cyan-100 transition group-hover:border-cyan-300/40">
                  {action.label}
                </span>
              </div>
            </Link>
          ))}
        </section>
        <HomeNewsSection />
      </main>
    </div>
  );
}
