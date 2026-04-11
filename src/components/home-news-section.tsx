"use client";

import { useCallback, useEffect, useState } from "react";
import { UI_TEXT } from "@/constants/ui-text";
import { fetchAggregatedNews } from "@/services/news.api";
import { normalizeError } from "@/services/http-client";
import type { NewsCategoryParam, NewsFeedItem } from "@/types/news";

const FILTERS: { label: string; value: NewsCategoryParam }[] = [
  { label: UI_TEXT.home.news.filterAll, value: "all" },
  { label: UI_TEXT.home.news.filterDomestic, value: "domestic" },
  { label: UI_TEXT.home.news.filterWorld, value: "world" },
  { label: UI_TEXT.home.news.filterSocial, value: "social" },
];

function pickItems(data: unknown): NewsFeedItem[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const raw = (data as { items?: unknown }).items;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((row): row is NewsFeedItem => {
    if (!row || typeof row !== "object") {
      return false;
    }
    const r = row as Record<string, unknown>;
    return typeof r.title === "string" && typeof r.link === "string";
  });
}

export function HomeNewsSection() {
  const [category, setCategory] = useState<NewsCategoryParam>("domestic");
  const [items, setItems] = useState<NewsFeedItem[]>([]);
  const [metaCount, setMetaCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next: NewsCategoryParam, opts?: { forceRefresh?: boolean }) => {
    const forceRefresh = opts?.forceRefresh ?? false;
    if (forceRefresh) {
      setRefreshing(true);
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAggregatedNews(next, { forceRefresh });
      setItems(pickItems(data));
      const count =
        typeof data.count === "number"
          ? data.count
          : Array.isArray(data.items)
            ? data.items.length
            : 0;
      setMetaCount(count);
    } catch (err) {
      const normalized = normalizeError(err);
      setError(normalized.message);
      setItems([]);
      setMetaCount(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(category);
  }, [category, load]);

  function handleRefresh() {
    void load(category, { forceRefresh: true });
  }

  return (
    <section className="glass-panel rounded-2xl p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inline-flex rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-xs font-medium tracking-[0.12em] text-cyan-100">
            {UI_TEXT.home.news.badge}
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-slate-100">{UI_TEXT.home.news.title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            {UI_TEXT.home.news.description}
          </p>
        </div>
        {metaCount !== null && !loading && !error ? (
          <p className="text-xs font-medium text-slate-500">
            {UI_TEXT.home.news.resultCount(metaCount)}
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label={UI_TEXT.home.news.filtersAria}
        >
          {FILTERS.map((f) => {
            const active = f.value === category;
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={loading}
                onClick={() => setCategory(f.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-50"
                    : "border-white/15 bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          aria-label={UI_TEXT.home.news.refreshAria}
          aria-busy={refreshing}
          className="shrink-0 rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing ? UI_TEXT.home.news.refreshLoading : UI_TEXT.home.news.refresh}
        </button>
      </div>

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-slate-400">{UI_TEXT.home.news.loading}</p>
        ) : error ? (
          <p className="text-sm text-rose-300/90">{error}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-400">{UI_TEXT.home.news.empty}</p>
        ) : (
          <ul className="list-none max-h-[min(28rem,55vh)] space-y-3 overflow-y-auto pr-1">
            {items.map((item, index) => (
              <li key={`${item.link}-${index}`} className="list-none">
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 no-underline transition hover:border-cyan-300/25 hover:bg-white/[0.05]"
                >
                  <span className="block text-sm font-semibold text-slate-100 group-hover:text-cyan-200">
                    {item.title}
                  </span>
                  {item.summary ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{item.summary}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    {item.source_name ? <span>{item.source_name}</span> : null}
                    {item.published_at ? <span>{item.published_at}</span> : null}
                    {item.item_origin ? (
                      <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-slate-500">
                        {item.item_origin}
                      </span>
                    ) : null}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
