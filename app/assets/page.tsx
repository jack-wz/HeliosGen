"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Box, Clapperboard, Copy, FolderPlus, ImageIcon, Library, Mountain, Palette, Plus,
  Search, Sparkles, UserRound, X, Check, AlertCircle, ChevronDown,
} from "lucide-react";
import { previewImageUrl, videoPosterUrl } from "@/lib/mediaPreview";
import { useWorkflowStore } from "@/lib/store";
import { copyText } from "@/lib/clipboard";
import { useApiError } from "@/lib/useApiError";
import { ASSET_CATEGORIES, normalizeCategory, type AssetCategory } from "@/lib/assetCategories";

type Category = AssetCategory;

type Asset = {
  id: string; name: string; url: string; mime_type: string; category: Category | null;
  description?: string | null; prompt?: string | null; model?: string | null; source: string;
  relative_path: string; asset_tags?: string[]; poster_url?: string | null;
};
type Collection = { id: string; name: string; kind: "manual" | "smart"; asset_count: number };
type Payload = {
  assets: Asset[]; total: number; hasMore?: boolean; allTotal: number; uncategorized?: number;
  counts: Record<Category, number>; collections: Collection[];
};

type SortKey = "recent" | "name" | "category";
const SORTS: SortKey[] = ["recent", "name", "category"];
const PAGE_SIZE = 48;

const CATEGORY_ICONS: Record<Category, typeof UserRound> = {
  Characters: UserRound, Props: Box, Environments: Mountain, Styles: Palette, Scenes: Clapperboard,
};
const CATEGORY_KEYS: Record<Category, string> = {
  Characters: "characters", Props: "props", Environments: "environments", Styles: "styles", Scenes: "scenes",
};
const CATEGORY_ID: Record<string, Category> = {
  character: "Characters", prop: "Props", environment: "Environments", visual_style: "Styles", scene: "Scenes",
};

const EMPTY: Payload = {
  assets: [], total: 0, allTotal: 0, counts: { Characters: 0, Props: 0, Environments: 0, Styles: 0, Scenes: 0 }, collections: [],
};

/** Filter state lives in the URL so a filtered view survives a refresh and can be shared. */
function useFilterState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const category = normalizeCategory(params.get("category"));
  const collection = params.get("collection");
  const uncategorized = params.get("uncategorized") === "1";
  const query = params.get("q") ?? "";
  const rawSort = params.get("sort");
  const sort: SortKey = SORTS.includes(rawSort as SortKey) ? (rawSort as SortKey) : "recent";

  const update = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  return { category, collection, uncategorized, query, sort, update };
}

export default function AssetsPage() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense fallback={<div className="flex min-h-0 flex-1 bg-[#0c0f14]" />}>
      <AssetsInner />
    </Suspense>
  );
}

function AssetsInner() {
  const apiError = useApiError();
  const t = useTranslations("assets");
  const tCat = useTranslations("assets.categories");
  const locale = useLocale();
  const { category, collection, uncategorized, query, sort, update } = useFilterState();

  const [data, setData] = useState<Payload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newCollection, setNewCollection] = useState<null | "manual" | "smart">(null);
  const [rawSelected, setRawSelected] = useState<Set<string>>(new Set());
  const [classifying, setClassifying] = useState<Set<string>>(new Set());
  const [bulkClassifying, setBulkClassifying] = useState(false);
  // The lightbox tracks an id rather than an index: if the asset stops being in
  // the current page the index would silently point at a different one.
  const [openId, setOpenId] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Uncontrolled search box: the URL is the source of truth and the DOM input
  // echoes it. Debounced into the URL rather than fetched per keystroke, and no
  // React state to keep in step — writing to the input directly also avoids a
  // re-render on every character.
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const el = searchRef.current;
    if (el && el.value !== query) el.value = query;
  }, [query]);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const buildQuery = useCallback((offset: number) => {
    const qs = new URLSearchParams();
    if (category) qs.set("category", category);
    if (collection) qs.set("collection", collection);
    if (uncategorized) qs.set("uncategorized", "1");
    if (query.trim()) qs.set("q", query.trim());
    if (sort !== "recent") qs.set("sort", sort);
    qs.set("limit", String(PAGE_SIZE));
    qs.set("offset", String(offset));
    return qs;
  }, [category, collection, uncategorized, query, sort]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/assets?${buildQuery(0)}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [buildQuery]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !data.hasMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/assets?${buildQuery(data.assets.length)}`);
      if (res.ok) {
        const next = (await res.json()) as Payload;
        setData((prev) => {
          const seen = new Set(prev.assets.map((a) => a.id));
          return { ...next, assets: [...prev.assets, ...next.assets.filter((a) => !seen.has(a.id))] };
        });
      }
    } finally {
      setLoadingMore(false);
    }
  }, [buildQuery, data.assets.length, data.hasMore, loadingMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !data.hasMore) return;
    const observer = new IntersectionObserver(([e]) => { if (e.isIntersecting) void loadMore(); }, { rootMargin: "600px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [data.hasMore, loadMore]);

  useEffect(() => { void fetch("/api/assets/reconcile", { method: "POST" }); }, []);
  // Fetch response updates are asynchronous; this is not a render-loop state write.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  // Derived, not cleared in an effect: a selection can only ever refer to an
  // asset currently on screen, so switching filters drops stale ids for free and
  // there is no window where a hidden asset is still actionable.
  const selectedIds = useMemo(() => {
    const visible = new Set(data.assets.map((a) => a.id));
    return new Set([...rawSelected].filter((id) => visible.has(id)));
  }, [rawSelected, data.assets]);
  const setSelectedIds = setRawSelected;
  const openIndex = openId ? data.assets.findIndex((a) => a.id === openId) : -1;

  const title = useMemo(() => {
    if (collection) return data.collections.find((c) => c.id === collection)?.name ?? t("collections");
    if (uncategorized) return t("uncategorizedFilter");
    return category ?? t("title");
  }, [category, collection, uncategorized, data.collections, t]);

  async function updateCategory(asset: Asset, next: string) {
    const catId = next ? Object.entries(CATEGORY_ID).find(([, label]) => label === next)?.[0] ?? null : null;
    await fetch(`/api/assets/${asset.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: next || null, manualCategoryId: catId }),
    });
    await load();
  }

  async function batchCategory(next: string) {
    const catId = next ? Object.entries(CATEGORY_ID).find(([, label]) => label === next)?.[0] ?? null : null;
    await Promise.all([...selectedIds].map((id) =>
      fetch(`/api/assets/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: next || null, manualCategoryId: catId }),
      }),
    ));
    setSelectedIds(new Set());
    await load();
  }

  async function classifyAsset(asset: Asset, apply = true) {
    const res = await fetch(`/api/assets/${asset.id}/classify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply, language: locale.startsWith("zh") ? "zh" : "en" }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      const err = new Error(body.error ?? t("aiFailed")) as Error & { code?: string };
      err.code = body.code;
      throw err;
    }
    return (await res.json()) as { suggestion: { category: string; description: string; tags: string[] } };
  }

  function reportClassifyError(e: unknown) {
    const err = e as Error & { code?: string };
    useWorkflowStore.getState().addToast(
      err.code === "vision_not_configured" ? t("aiNotConfigured") : (err.message || t("aiFailed")),
      "error",
    );
  }

  async function classifyOne(asset: Asset) {
    if (classifying.has(asset.id)) return;
    setClassifying((prev) => new Set(prev).add(asset.id));
    try {
      await classifyAsset(asset);
      await load();
    } catch (e) { reportClassifyError(e); }
    finally { setClassifying((prev) => { const n = new Set(prev); n.delete(asset.id); return n; }); }
  }

  /** Classify everything currently uncategorised, which is the usual intent. */
  async function classifyAllUncategorized() {
    const ids = data.assets.filter((a) => !a.category).map((a) => a.id);
    await runBatch(ids);
  }

  async function classifySelected() { await runBatch([...selectedIds]); }

  async function runBatch(ids: string[]) {
    if (ids.length === 0 || bulkClassifying) return;
    setBulkClassifying(true);
    let done = 0, failed = 0, unconfigured = false;
    // Sequential: one request at a time keeps us inside the provider's rate
    // limit and lets the user see progress rather than a frozen button.
    for (const id of ids) {
      const asset = data.assets.find((a) => a.id === id);
      if (!asset) continue;
      setClassifying((prev) => new Set(prev).add(id));
      try { await classifyAsset(asset); done += 1; }
      catch (e) {
        const err = e as Error & { code?: string };
        if (err.code === "vision_not_configured") { unconfigured = true; break; }
        failed += 1;
      } finally { setClassifying((prev) => { const n = new Set(prev); n.delete(id); return n; }); }
    }
    setBulkClassifying(false);
    setSelectedIds(new Set());
    await load();
    if (unconfigured) useWorkflowStore.getState().addToast(t("aiNotConfigured"), "error");
    else useWorkflowStore.getState().addToast(`${t("aiDone")} ${done}${failed ? ` · ${failed} ${t("aiFailed")}` : ""}`, failed ? "error" : "success");
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function createCollection(kind: "manual" | "smart", name: string) {
    const rule = kind === "smart" ? { category: category ?? "Characters" } : null;
    const res = await fetch("/api/assets/collections", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind, rule }),
    });
    if (!res.ok) useWorkflowStore.getState().addToast(apiError(await res.json(), t("create")), "error");
    setNewCollection(null);
    await load();
  }

  async function toggleMembership(assetId: string, included: boolean, collectionId = collection) {
    if (!collectionId) return;
    await fetch("/api/assets/collections", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collectionId, assetId, included }),
    });
    await load();
  }

  const activeCollection = data.collections.find((c) => c.id === collection);
  const pendingCount = data.uncategorized ?? 0;
  const selectedCount = selectedIds.size;

  return (
    <main className="flex min-h-0 flex-1 bg-[#0c0f14] text-white">
      <aside className="w-[248px] shrink-0 overflow-y-auto border-r border-white/10 bg-[#11151b] p-3">
        <NavItem icon={Library} label={t("title")} count={data.allTotal}
          active={!category && !collection && !uncategorized}
          onClick={() => update({ category: null, collection: null, uncategorized: null })} />

        <div className="mt-1 space-y-0.5">
          {ASSET_CATEGORIES.map((name) => (
            <NavItem key={name} icon={CATEGORY_ICONS[name]} label={tCat(CATEGORY_KEYS[name])} count={data.counts[name] ?? 0}
              active={category === name && !collection && !uncategorized}
              onClick={() => update({ category: name, collection: null, uncategorized: null })} />
          ))}
        </div>

        {/* The one bucket that needs the user's attention, kept visually apart
            from the browse categories. */}
        <div className="mt-3 border-t border-white/8 pt-3">
          <NavItem icon={AlertCircle} label={t("uncategorizedFilter")} count={pendingCount}
            active={uncategorized} tone="warn"
            onClick={() => update({ uncategorized: uncategorized ? null : "1", category: null, collection: null })} />
        </div>

        <div className="mt-6 flex items-center justify-between px-2">
          <span className="text-xs font-medium uppercase tracking-wide text-white/40">{t("collections")}</span>
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen(!menuOpen)}
              aria-label={t("newCollection")} aria-expanded={menuOpen}
              className="flex size-7 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
              <Plus size={16} />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-9 z-20 w-52 rounded-xl border border-white/10 bg-[#1a1f27] p-1.5 shadow-2xl">
                <button type="button" role="menuitem" onClick={() => { setNewCollection("manual"); setMenuOpen(false); }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/8">
                  <FolderPlus size={16} />{t("newCollection")}
                </button>
                <button type="button" role="menuitem" onClick={() => { setNewCollection("smart"); setMenuOpen(false); }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/8">
                  <Sparkles size={16} />{t("newSmartCollection")}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="mt-1 space-y-0.5">
          {data.collections.map((item) => (
            <NavItem key={item.id} icon={item.kind === "smart" ? Sparkles : ImageIcon} label={item.name} count={item.asset_count}
              active={collection === item.id}
              onClick={() => update({ collection: item.id, category: null, uncategorized: null })} />
          ))}
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 border-b border-white/8 bg-[#0c0f14]/95 px-6 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-semibold">{title}</h1>
              <p className="mt-0.5 text-xs text-white/35">
                {t("sharedWith")} · {t("totalCount", { n: data.total })}
              </p>
            </div>

            <label className="flex h-9 w-64 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 focus-within:border-white/25">
              <Search size={15} className="shrink-0 text-white/35" aria-hidden />
              <span className="sr-only">{t("searchPlaceholder")}</span>
              <input ref={searchRef} defaultValue={query}
                onChange={(e) => {
                  const value = e.target.value;
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  debounceRef.current = setTimeout(() => update({ q: value.trim() || null }), 250);
                }}
                type="search" autoComplete="off" spellCheck={false}
                placeholder={t("searchPlaceholder")}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/25" />
            </label>

            <label className="flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 focus-within:border-white/25">
              <span className="sr-only">{t("sortLabel")}</span>
              <select value={sort} onChange={(e) => update({ sort: e.target.value === "recent" ? null : e.target.value })}
                className="bg-transparent text-xs text-white/70 outline-none [color-scheme:dark]">
                {SORTS.map((s) => <option key={s} value={s}>{t(s === "recent" ? "sortRecent" : s === "name" ? "sortName" : "sortCategory")}</option>)}
              </select>
            </label>

            {pendingCount > 0 && (
              <button type="button" onClick={() => void classifyAllUncategorized()} disabled={bulkClassifying}
                className="flex h-9 items-center gap-1.5 rounded-xl border border-[var(--primary)]/40 bg-[var(--primary)]/10 px-3 text-xs font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-40">
                <Sparkles size={14} aria-hidden />
                {bulkClassifying ? t("aiClassifying") : `${t("aiClassify")} ${pendingCount}`}
              </button>
            )}
          </div>
        </header>

        <div className="p-6">
          {selectedCount > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5">
              <span className="text-sm text-white/70" aria-live="polite">{selectedCount} {t("selected")}</span>
              <div className="flex flex-wrap gap-1.5">
                {ASSET_CATEGORIES.map((name) => (
                  <button key={name} type="button" onClick={() => void batchCategory(name)}
                    className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/70 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
                    {tCat(CATEGORY_KEYS[name])}
                  </button>
                ))}
                <button type="button" onClick={() => void batchCategory("")}
                  className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/45 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
                  {t("clear")}
                </button>
                <button type="button" onClick={() => void classifySelected()} disabled={bulkClassifying}
                  className="rounded-lg border border-[var(--primary)]/40 bg-[var(--primary)]/10 px-2.5 py-1 text-xs text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-40">
                  {bulkClassifying ? t("aiClassifying") : t("aiClassifySelected")}
                </button>
              </div>
              <button type="button" onClick={() => setSelectedIds(new Set())}
                className="ml-auto text-xs text-white/35 transition-colors hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
                {t("deselectAll")}
              </button>
            </div>
          )}

          {loading ? (
            <p className="py-20 text-center text-sm text-white/35">{t("indexing")}</p>
          ) : data.assets.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 px-6 py-24 text-center">
              <p className="text-sm text-white/45">{t("emptyHint")}</p>
            </div>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {data.assets.map((asset, index) => (
                  <AssetCard key={asset.id} asset={asset} index={index}
                    selected={selectedIds.has(asset.id)} classifying={classifying.has(asset.id)}
                    inCollection={activeCollection?.kind === "manual"}
                    onOpen={() => setOpenId(asset.id)} onToggleSelect={() => toggleSelect(asset.id)}
                    onClassify={() => void classifyOne(asset)}
                    onRemove={() => void toggleMembership(asset.id, false)}
                    onCopy={() => { void copyText(asset.url).catch(() => useWorkflowStore.getState().addToast(t("copyUrl"), "error")); }} />
                ))}
              </ul>
              {data.hasMore && (
                <div ref={sentinelRef} className="flex justify-center py-8">
                  <button type="button" onClick={() => void loadMore()} disabled={loadingMore}
                    className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/55 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-50">
                    {loadingMore ? t("loadingMore") : `${data.assets.length} / ${data.total}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {openIndex >= 0 && data.assets[openIndex] && (
        <AssetLightbox assets={data.assets} index={openIndex} tCat={tCat}
          inCollection={activeCollection?.kind === "manual"}
          onIndex={(i) => setOpenId(data.assets[i].id)} onClose={() => setOpenId(null)}
          onCategory={(next) => void updateCategory(data.assets[openIndex], next)}
          onClassify={() => void classifyOne(data.assets[openIndex])}
          onRemove={() => void toggleMembership(data.assets[openIndex].id, false)}
          onCopy={() => { void copyText(data.assets[openIndex].url).catch(() => useWorkflowStore.getState().addToast(t("copyUrl"), "error")); }} />
      )}

      {newCollection && (
        <NewCollectionDialog kind={newCollection}
          onCancel={() => setNewCollection(null)}
          onCreate={(name) => void createCollection(newCollection, name)} />
      )}
    </main>
  );
}

/** A sidebar row: icon, label, count, active state. */
function NavItem({ icon: Icon, label, count, active, tone, onClick }: {
  icon: typeof UserRound; label: string; count: number; active: boolean;
  tone?: "warn"; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "true" : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
        active ? "bg-white/10 text-white" : tone === "warn" ? "text-amber-200/70 hover:bg-white/5" : "text-white/60 hover:bg-white/5"
      }`}>
      <Icon size={17} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && <span className="shrink-0 text-xs tabular-nums text-white/35">{count}</span>}
    </button>
  );
}

/**
 * Browse-state card: image, name, category. Everything else — selection,
 * classification, copy, collection membership — is behind hover/focus, or lives
 * in the lightbox. The previous version put eleven controls on every card, which
 * made a wall of 170 of them unreadable.
 */
function AssetCard({ asset, selected, classifying, inCollection, onOpen, onToggleSelect, onClassify, onRemove, onCopy }: {
  asset: Asset; index: number; selected: boolean; classifying: boolean; inCollection: boolean;
  onOpen: () => void; onToggleSelect: () => void; onClassify: () => void; onRemove: () => void; onCopy: () => void;
}) {
  const t = useTranslations("assets");
  const isVideo = asset.mime_type.startsWith("video/");
  const isAudio = asset.mime_type.startsWith("audio/");
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <li className={`group relative overflow-hidden rounded-xl border bg-white/[0.03] transition-colors ${
      selected ? "border-[var(--primary)]" : "border-white/10 hover:border-white/25"
    }`}>
      <button type="button" onClick={onOpen} aria-label={`${t("preview")}: ${asset.name}`}
        className="relative block aspect-square w-full overflow-hidden bg-black/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]">
        {isVideo ? (
          <video src={asset.url} poster={videoPosterUrl(asset.url, asset.poster_url, 360)} preload="none" muted playsInline
            className="h-full w-full object-cover" />
        ) : isAudio ? (
          <span className="flex h-full items-center justify-center text-white/30"><Clapperboard size={24} aria-hidden /></span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewImageUrl(asset.url, 320)} alt="" loading="lazy" decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        )}
        {isVideo && (
          <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/85">▶</span>
        )}
      </button>

      {/* Actions appear on hover or keyboard focus, not by default. */}
      <div className="pointer-events-none absolute left-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <button type="button" onClick={onToggleSelect} aria-pressed={selected} aria-label={t("selectItem")}
          className={`flex size-6 items-center justify-center rounded-md border backdrop-blur transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
            selected ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]" : "border-white/25 bg-black/50 text-transparent hover:text-white/60"
          }`}>
          <Check size={13} aria-hidden />
        </button>
        <button type="button" onClick={onClassify} disabled={classifying} aria-label={t("aiClassify")}
          className="flex size-6 items-center justify-center rounded-md border border-white/25 bg-black/50 text-white/70 backdrop-blur transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-40">
          <Sparkles size={13} aria-hidden className={classifying ? "animate-pulse" : undefined} />
        </button>
        <div className="relative">
          <button type="button" onClick={() => setMoreOpen(!moreOpen)} aria-label={t("moreActions")} aria-expanded={moreOpen}
            className="flex size-6 items-center justify-center rounded-md border border-white/25 bg-black/50 text-white/70 backdrop-blur transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
            <ChevronDown size={13} aria-hidden />
          </button>
          {moreOpen && (
            <div role="menu" className="absolute left-0 top-7 z-20 w-44 rounded-lg border border-white/10 bg-[#1a1f27] p-1 shadow-2xl">
              <button type="button" role="menuitem" onClick={() => { onCopy(); setMoreOpen(false); }}
                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs hover:bg-white/8">
                <Copy size={13} aria-hidden />{t("copyUrl")}
              </button>
              {inCollection && (
                <button type="button" role="menuitem" onClick={() => { onRemove(); setMoreOpen(false); }}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-red-300/80 hover:bg-white/8">
                  <X size={13} aria-hidden />{t("removeFromCollection")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-white/75" title={asset.name}>{asset.name}</span>
        {asset.category
          ? <span className="shrink-0 rounded-full bg-white/8 px-1.5 py-0.5 text-[10px] text-white/55">{asset.category}</span>
          : <span className="shrink-0 rounded-full border border-amber-400/30 px-1.5 py-0.5 text-[10px] text-amber-200/70">{t("needsReview")}</span>}
      </div>
    </li>
  );
}

/** Full-size view. Browse-state detail lives here instead of on every card. */
function AssetLightbox({ assets, index, inCollection, tCat, onIndex, onClose, onCategory, onClassify, onRemove, onCopy }: {
  assets: Asset[]; index: number; inCollection: boolean; tCat: (k: string) => string;
  onIndex: (i: number) => void; onClose: () => void; onCategory: (next: string) => void;
  onClassify: () => void; onRemove: () => void; onCopy: () => void;
}) {
  const t = useTranslations("assets");
  const asset = assets[index];
  const isVideo = asset.mime_type.startsWith("video/");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (e.key === "ArrowRight" && index < assets.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    // Stop the grid behind from scrolling while the overlay is up.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [index, assets.length, onClose, onIndex]);

  return (
    <div role="dialog" aria-modal="true" aria-label={asset.name}
      className="fixed inset-0 z-[100000] flex bg-black/85 backdrop-blur-sm" style={{ overscrollBehavior: "contain" }}>
      <button type="button" aria-label={t("close")} onClick={onClose} className="absolute inset-0 cursor-default" tabIndex={-1} />

      <div className="relative z-10 m-auto flex max-h-[92vh] w-full max-w-6xl flex-col gap-4 p-4 md:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
          {isVideo ? (
            <video src={asset.url} poster={videoPosterUrl(asset.url, asset.poster_url, 720)} controls autoPlay playsInline
              className="max-h-[80vh] max-w-full rounded-xl" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset.url} alt={asset.name} className="max-h-[80vh] max-w-full rounded-xl object-contain" />
          )}
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto rounded-xl border border-white/10 bg-[#11151b] p-4 md:w-80">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 break-words text-sm font-medium">{asset.name}</h2>
            <button ref={closeRef} type="button" onClick={onClose} aria-label={t("close")}
              className="shrink-0 rounded-lg p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
              <X size={16} aria-hidden />
            </button>
          </div>

          {asset.description && <p className="text-xs leading-5 text-white/55">{asset.description}</p>}
          {asset.prompt && <p className="line-clamp-4 text-xs leading-5 text-white/35">{asset.prompt}</p>}

          {asset.asset_tags && asset.asset_tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {asset.asset_tags.map((tag) => (
                <span key={tag} className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/55">{tag}</span>
              ))}
            </div>
          )}

          {/* Provenance lives here rather than on the card: it is detail-view
              information, and a wall of 170 cards should not carry it. */}
          <dl className="space-y-1.5 text-[11px]">
            {(asset.model || asset.source) && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-white/30">{t("model")}</dt>
                <dd className="min-w-0 break-words text-white/55">{asset.model || asset.source}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="shrink-0 text-white/30">{t("path")}</dt>
              <dd className="min-w-0 break-all font-mono text-white/40">{asset.relative_path}</dd>
            </div>
          </dl>

          <div className="mt-auto space-y-2 border-t border-white/8 pt-3">
            <label className="block">
              <span className="sr-only">{t("categories")}</span>
              <select value={asset.category ?? ""} onChange={(e) => onCategory(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#171b22] px-2 py-1.5 text-xs text-white/70 outline-none [color-scheme:dark] focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
                <option value="">{t("uncategorized")}</option>
                {ASSET_CATEGORIES.map((name) => <option key={name} value={name}>{tCat(CATEGORY_KEYS[name])}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={onClassify}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--primary)]/40 bg-[var(--primary)]/10 px-2 py-1.5 text-xs text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
                <Sparkles size={13} aria-hidden />{t("aiClassify")}
              </button>
              <button type="button" onClick={onCopy} aria-label={t("copyUrl")}
                className="rounded-lg border border-white/10 px-2 py-1.5 text-white/55 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
                <Copy size={13} aria-hidden />
              </button>
              {inCollection && (
                <button type="button" onClick={onRemove}
                  className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-white/55 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
                  {t("remove")}
                </button>
              )}
            </div>
            <p className="text-center text-[10px] tabular-nums text-white/25">{index + 1} / {assets.length}</p>
          </div>
        </aside>
      </div>

      {index > 0 && (
        <button type="button" aria-label={t("prevItem")} onClick={() => onIndex(index - 1)}
          className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white/70 transition-colors hover:bg-black/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
          <ChevronDown size={20} className="rotate-90" aria-hidden />
        </button>
      )}
      {index < assets.length - 1 && (
        <button type="button" aria-label={t("nextItem")} onClick={() => onIndex(index + 1)}
          className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white/70 transition-colors hover:bg-black/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
          <ChevronDown size={20} className="-rotate-90" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Replaces window.prompt: a real dialog, focus-managed and dismissible. */
function NewCollectionDialog({ kind, onCancel, onCreate }: {
  kind: "manual" | "smart"; onCancel: () => void; onCreate: (name: string) => void;
}) {
  const t = useTranslations("assets");
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div role="dialog" aria-modal="true" aria-label={t(kind === "smart" ? "newSmartCollection" : "newCollection")}
      className="fixed inset-0 z-[100001] flex items-center justify-center bg-black/70 p-4">
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim()); }}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#11151b] p-5">
        <h2 className="text-sm font-medium">{t(kind === "smart" ? "newSmartCollection" : "newCollection")}</h2>
        <label className="mt-4 block">
          <span className="sr-only">{t("newCollectionName")}</span>
          <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t("newCollectionName")} autoComplete="off"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/25 focus-visible:ring-2 focus-visible:ring-[var(--primary)]" />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
            {t("cancel")}
          </button>
          <button type="submit" disabled={!name.trim()}
            className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-40">
            {t("create")}
          </button>
        </div>
      </form>
    </div>
  );
}
