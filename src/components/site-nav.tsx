"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UI_TEXT } from "@/constants/ui-text";

const items = [
  { href: "/", label: UI_TEXT.nav.home },
  { href: "/market", label: UI_TEXT.nav.market },
  { href: "/watchlist", label: UI_TEXT.nav.watchlist },
  { href: "/news", label: UI_TEXT.nav.news },
  { href: "/long-term", label: UI_TEXT.nav.longTerm },
  { href: "/trade", label: UI_TEXT.nav.trade },
  { href: "/auto-trading", label: UI_TEXT.nav.autoTrading },
  { href: "/operations", label: UI_TEXT.nav.operations },
];

export function SiteNav() {
  const pathname = usePathname();

  const isActive = (href: string): boolean => {
    if (href === "/") {
      return pathname === "/";
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070809]/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="shrink-0 text-sm font-semibold text-cyan-100">
          {UI_TEXT.appName}
        </Link>
        <nav className="no-scrollbar flex min-w-0 flex-1 items-center justify-start gap-1.5 overflow-x-auto text-sm text-slate-300 sm:justify-end">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 rounded-md border px-2.5 py-1.5 font-medium transition ${
                isActive(item.href)
                  ? "border-cyan-300/60 bg-cyan-300/[0.16] text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                  : "border-white/10 bg-white/[0.02] hover:border-cyan-300/25 hover:bg-cyan-300/10 hover:text-cyan-100"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
