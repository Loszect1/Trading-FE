"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UI_TEXT } from "@/constants/ui-text";

const items = [
  { href: "/", label: UI_TEXT.nav.home },
  { href: "/market", label: UI_TEXT.nav.market },
  { href: "/watchlist", label: UI_TEXT.nav.watchlist },
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
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#04070d]/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <Link href="/" className="text-sm font-semibold tracking-[0.18em] text-cyan-200">
          {UI_TEXT.appName}
        </Link>
        <nav className="flex items-center gap-4 text-sm text-slate-300">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md border px-2 py-1 font-medium transition ${
                isActive(item.href)
                  ? "border-cyan-300/70 bg-cyan-300/20 text-cyan-100 shadow-[0_0_0_1px_rgba(103,232,249,0.3)]"
                  : "border-transparent hover:border-cyan-300/20 hover:bg-cyan-300/10 hover:text-cyan-100"
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
