"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { normalizeError } from "@/services/http-client";
import {
  fetchMailNewsArticles,
  fetchMailNewsToday,
  fetchMailNewsTopImpact,
  fetchMorningBrief,
  fetchNewsBySymbol,
  refreshMailNewsFromGmail,
  fetchWatchlistAlerts,
} from "@/services/news.api";
import type {
  MorningBriefResponse,
  NewsBySymbolResponse,
  NewsMailArticle,
  NewsMailArticlesResponse,
  NewsMailImpact,
  NewsMailTodayResponse,
  NewsMailTopImpactResponse,
  WatchlistAlertsResponse,
} from "@/types/news";

const NEWS_PAGE_SIZE = 10;
const CATEGORY_FILTERS = [
  { label: "All", value: "all" },
  { label: "General", value: "general" },
  { label: "World", value: "world" },
  { label: "Dầu khí", value: "dau_khi" },
  { label: "Tài nguyên Cơ bản", value: "tai_nguyen_co_ban" },
  { label: "Hàng & Dịch vụ Công nghiệp", value: "hang_dich_vu_cong_nghiep" },
  { label: "Thực phẩm và đồ uống", value: "thuc_pham_va_do_uong" },
  { label: "Y tế", value: "y_te" },
  { label: "Truyền thông", value: "truyen_thong" },
  { label: "Viễn thông", value: "vien_thong" },
  { label: "Ngân hàng", value: "ngan_hang" },
  { label: "Bất động sản", value: "bat_dong_san" },
  { label: "Công nghệ Thông tin", value: "cong_nghe_thong_tin" },
  { label: "Hóa chất", value: "hoa_chat" },
  { label: "Xây dựng và Vật liệu", value: "xay_dung_va_vat_lieu" },
  { label: "Ô tô và phụ tùng", value: "o_to_va_phu_tung" },
  { label: "Hàng cá nhân & Gia dụng", value: "hang_ca_nhan_gia_dung" },
  { label: "Bán lẻ", value: "ban_le" },
  { label: "Du lịch và Giải trí", value: "du_lich_va_giai_tri" },
  { label: "Điện, nước & xăng dầu khí đốt", value: "dien_nuoc_xang_dau_khi_dot" },
  { label: "Bảo hiểm", value: "bao_hiem" },
  { label: "Dịch vụ tài chính", value: "dich_vu_tai_chinh" },
];

function formatScore(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(0);
}

function formatPageRange(offset: number, count: number, total: number): string {
  if (total <= 0 || count <= 0) return "0 of 0";
  const start = offset + 1;
  const end = Math.min(offset + count, total);
  return `${start}-${end} of ${total}`;
}

function sentimentClass(label?: string): string {
  if (label === "positive") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
  if (label === "negative") return "border-rose-300/30 bg-rose-300/10 text-rose-100";
  if (label === "mixed") return "border-amber-300/30 bg-amber-300/10 text-amber-100";
  return "border-slate-300/20 bg-white/5 text-slate-200";
}

function readLocalWatchlist(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("vnstock.watchlist");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item).trim().toUpperCase()).filter(Boolean);
  } catch {
    return [];
  }
}

function ImpactBadge({ impact }: { impact: NewsMailImpact }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold ${sentimentClass(
        impact.sentiment_label,
      )}`}
    >
      {impact.symbol}
      <span className="text-slate-400">I</span>
      {formatScore(impact.impact_score)}
      <span className="text-slate-400">S</span>
      {formatScore(impact.sentiment_score)}
    </span>
  );
}

function ImpactList({ items, empty }: { items: NewsMailImpact[]; empty: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-400">{empty}</p>;
  }
  return (
    <ul className="space-y-3">
      {items.map((item, index) => (
        <li
          key={`${item.impact_id ?? item.article_id ?? item.symbol}-${index}`}
          className="rounded-lg border border-white/10 bg-white/[0.03] p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <ImpactBadge impact={item} />
            {item.impact_horizon ? (
              <span className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-slate-400">
                {item.impact_horizon}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm font-medium text-slate-100">
            {item.title ?? item.article_title ?? item.symbol}
          </p>
          {item.rationale ? <p className="mt-1 text-xs leading-5 text-slate-400">{item.rationale}</p> : null}
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex text-xs font-medium text-cyan-200 hover:text-cyan-100"
            >
              Open source
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ArticleRow({ article }: { article: NewsMailArticle }) {
  const impacts = article.impacts ?? [];
  const tags = [...(article.sector_tags ?? []), ...(article.market_tags ?? [])]
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 5);
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <header className="min-w-0">
        <p className="text-xs font-medium uppercase text-slate-500">
          {article.run_date ? `${article.run_date} | ` : ""}
          {article.source_host || "mail"} | {article.fetch_status || "unknown"}
        </p>
        <h2 className="mt-1 text-base font-semibold leading-6 text-slate-100">
          {article.title || article.section_title || "Untitled news section"}
        </h2>
      </header>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {article.category ? (
          <span className="inline-flex items-center rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[11px] font-semibold text-cyan-100">
            {article.category}
          </span>
        ) : null}
        {impacts.slice(0, 4).map((impact) => (
          <ImpactBadge key={`${article.article_id}-${impact.symbol}`} impact={impact} />
        ))}
      </div>
      {article.codex_summary ? (
        <p className="mt-3 text-sm leading-6 text-slate-300">{article.codex_summary}</p>
      ) : article.article_excerpt ? (
        <p className="mt-3 text-sm leading-6 text-slate-400">{article.article_excerpt}</p>
      ) : article.fetch_error ? (
        <p className="mt-3 text-sm text-rose-300">{article.fetch_error}</p>
      ) : null}
      {article.key_points && article.key_points.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-400">
          {article.key_points.slice(0, 4).map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : null}
      {tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={`${article.article_id}-${tag}`} className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-slate-400">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex text-xs font-semibold text-cyan-200 hover:text-cyan-100"
      >
        Read article
      </a>
    </article>
  );
}

export function NewsMailDashboardClient() {
  const [today, setToday] = useState<NewsMailTodayResponse | null>(null);
  const [mailPage, setMailPage] = useState<NewsMailArticlesResponse | null>(null);
  const [topImpact, setTopImpact] = useState<NewsMailTopImpactResponse | null>(null);
  const [brief, setBrief] = useState<MorningBriefResponse | null>(null);
  const [watchlistAlerts, setWatchlistAlerts] = useState<WatchlistAlertsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [symbolFilterInput, setSymbolFilterInput] = useState("");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [symbolQuery, setSymbolQuery] = useState("");
  const [symbolResult, setSymbolResult] = useState<NewsBySymbolResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [symbolLoading, setSymbolLoading] = useState(false);
  const [error, setError] = useState("");

  const articles = mailPage?.items ?? [];
  const run = today?.run ?? null;
  const totalNews = mailPage?.total_count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalNews / NEWS_PAGE_SIZE));
  const pageOffset = Math.max(0, page - 1) * NEWS_PAGE_SIZE;
  const fetchedCount = run?.fetched_count ?? today?.articles?.filter((item) => item.fetch_status === "fetched").length;
  const failedCount =
    run?.failed_count ?? today?.articles?.filter((item) => item.fetch_status !== "fetched").length;
  const watchedSymbols = useMemo(() => readLocalWatchlist(), []);

  const load = useCallback(async (opts?: { forceRefresh?: boolean }) => {
    const forceRefresh = opts?.forceRefresh ?? false;
    setLoading(true);
    if (forceRefresh) {
      setRefreshing(true);
    }
    setError("");
    try {
      if (forceRefresh) {
        await refreshMailNewsFromGmail();
      }
      const [todayData, pageData, topData, briefData] = await Promise.all([
        fetchMailNewsToday({ forceRefresh }),
        fetchMailNewsArticles(
          {
            limit: NEWS_PAGE_SIZE,
            offset: pageOffset,
            category: categoryFilter,
            symbol: symbolFilter,
          },
          { forceRefresh },
        ),
        fetchMailNewsTopImpact(20, { forceRefresh }),
        fetchMorningBrief({ forceRefresh }),
      ]);
      setToday(todayData);
      setMailPage(pageData);
      setTopImpact(topData);
      setBrief(briefData);
      if (watchedSymbols.length > 0) {
        const alerts = await fetchWatchlistAlerts(watchedSymbols, { forceRefresh });
        setWatchlistAlerts(alerts);
      } else {
        setWatchlistAlerts({ watchlist_id: "local", symbols: [], items: [], count: 0 });
      }
    } catch (err) {
      setError(normalizeError(err).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [categoryFilter, pageOffset, symbolFilter, watchedSymbols]);

  useEffect(() => {
    void load();
  }, [load]);

  async function searchSymbol() {
    const normalized = symbolQuery.trim().toUpperCase();
    if (!normalized) return;
    setSymbolLoading(true);
    try {
      setSymbolResult(await fetchNewsBySymbol(normalized, 50));
    } catch (err) {
      setSymbolResult({ symbol: normalized, items: [], count: 0 });
      setError(normalizeError(err).message);
    } finally {
      setSymbolLoading(false);
    }
  }

  function handleCategoryChange(event: ChangeEvent<HTMLSelectElement>) {
    setCategoryFilter(event.target.value);
    setPage(1);
  }

  function applySymbolFilter() {
    setSymbolFilter(symbolFilterInput.trim().toUpperCase());
    setPage(1);
  }

  function clearSymbolFilter() {
    setSymbolFilterInput("");
    setSymbolFilter("");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-xl p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-cyan-200">Mail news intelligence</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-100">News</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Saved market news with translated summaries, symbol mapping, sentiment, impact scoring, and T+ horizon research.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load({ forceRefresh: true })}
            disabled={loading}
            aria-busy={refreshing}
            className="rounded-md border border-white/20 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? "Running workflow" : loading ? "Loading" : "Refresh"}
          </button>
        </div>
        {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          {[
            ["Latest run", run?.status ?? "none"],
            ["News", String(totalNews)],
            ["Fetched", String(fetchedCount ?? 0)],
            ["Failed", String(failedCount ?? 0)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <section className="glass-panel rounded-xl p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">News</h2>
              <p className="mt-1 text-xs text-slate-500">
                {formatPageRange(mailPage?.offset ?? pageOffset, articles.length, totalNews)}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
              <label className="min-w-0">
                <span className="mb-1 block text-xs font-medium text-slate-500">Category</span>
                <select
                  value={categoryFilter}
                  onChange={handleCategoryChange}
                  disabled={loading}
                  className="h-10 w-full rounded-md border border-white/15 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {CATEGORY_FILTERS.map((filter) => (
                    <option key={filter.value} value={filter.value}>
                      {filter.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0">
                <span className="mb-1 block text-xs font-medium text-slate-500">Symbol</span>
                <input
                  value={symbolFilterInput}
                  onChange={(event) => setSymbolFilterInput(event.target.value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applySymbolFilter();
                  }}
                  placeholder="FPT"
                  className="h-10 w-full rounded-md border border-white/15 bg-black/20 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60"
                />
              </label>
              <button
                type="button"
                onClick={applySymbolFilter}
                disabled={loading}
                className="h-10 self-end rounded-md border border-white/20 px-3 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={clearSymbolFilter}
                disabled={loading || (!symbolFilter && !symbolFilterInput)}
                className="h-10 self-end rounded-md border border-white/15 px-3 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {loading ? (
              <p className="text-sm text-slate-400">Loading news...</p>
            ) : articles.length === 0 ? (
              <p className="text-sm text-slate-400">No news matched the current filters.</p>
            ) : (
              articles.map((article) => <ArticleRow key={article.article_id} article={article} />)
            )}
          </div>
          <div className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Page {Math.min(page, pageCount)} of {pageCount}
              {symbolFilter ? ` | Symbol ${symbolFilter}` : ""}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={loading || !(mailPage?.has_previous ?? false)}
                className="rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => current + 1)}
                disabled={loading || !(mailPage?.has_next ?? false)}
                className="rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="glass-panel rounded-xl p-5">
            <h2 className="text-lg font-semibold text-slate-100">Morning brief</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-3">
                <p className="text-xs text-emerald-100/70">Positive</p>
                <p className="mt-1 text-xl font-semibold text-emerald-100">{brief?.positive_count ?? 0}</p>
              </div>
              <div className="rounded-lg border border-rose-300/20 bg-rose-300/10 p-3">
                <p className="text-xs text-rose-100/70">Negative</p>
                <p className="mt-1 text-xl font-semibold text-rose-100">{brief?.negative_count ?? 0}</p>
              </div>
            </div>
            <div className="mt-4">
              <ImpactList items={brief?.top_impacts?.slice(0, 5) ?? []} empty="No brief yet." />
            </div>
          </section>

          <section className="glass-panel rounded-xl p-5">
            <h2 className="text-lg font-semibold text-slate-100">Top impact</h2>
            <div className="mt-4">
              <ImpactList items={topImpact?.items?.slice(0, 8) ?? []} empty="No scored impacts yet." />
            </div>
          </section>

          <section className="glass-panel rounded-xl p-5">
            <h2 className="text-lg font-semibold text-slate-100">Symbol search</h2>
            <div className="mt-4 flex gap-2">
              <input
                value={symbolQuery}
                onChange={(event) => setSymbolQuery(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void searchSymbol();
                }}
                placeholder="FPT"
                className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60"
              />
              <button
                type="button"
                onClick={() => void searchSymbol()}
                disabled={symbolLoading || !symbolQuery.trim()}
                className="rounded-md border border-white/20 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {symbolLoading ? "..." : "Go"}
              </button>
            </div>
            <div className="mt-4">
              <ImpactList items={symbolResult?.items?.slice(0, 8) ?? []} empty="Search a symbol." />
            </div>
          </section>

          <section className="glass-panel rounded-xl p-5">
            <h2 className="text-lg font-semibold text-slate-100">Watchlist alerts</h2>
            <p className="mt-1 text-xs text-slate-500">
              {watchedSymbols.length ? watchedSymbols.join(", ") : "No local watchlist symbols."}
            </p>
            <div className="mt-4">
              <ImpactList items={watchlistAlerts?.items?.slice(0, 8) ?? []} empty="No watchlist alerts." />
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
