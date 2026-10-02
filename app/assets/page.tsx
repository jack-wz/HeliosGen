"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { previewImageUrl, videoPosterUrl } from "@/lib/mediaPreview";
import { useWorkflowStore } from "@/lib/store";
import { useTranslations, useLocale } from "next-intl";
import { useApiError } from "@/lib/useApiError";
import {
  Box, Clapperboard, Copy, FolderPlus, Image as ImageIcon, Library,
  Mountain, Palette, Plus, Search, Sparkles, UserRound,
} from "lucide-react";

type Category = "Characters" | "Props" | "Environments" | "Styles" | "Scenes";
type Asset = {
  id: string; name: string; url: string; relative_path: string; category: Category | null;
  manual_category_id: string | null; asset_tags: string[];
  mime_type: string; source: string; prompt: string | null; model: string | null; description: string | null;
  poster_url?: string | null;
};
type Collection = { id: string; name: string; kind: "manual" | "smart"; asset_count: number };
type Payload = { assets: Asset[]; total: number; hasMore?: boolean; allTotal: number; counts: Record<Category, number>; categoryIds?: string[]; collections: Collection[] };

const PAGE_SIZE = 48;

const CATEGORIES: { name: Category; icon: typeof UserRound }[] = [
  { name: "Characters", icon: UserRound }, { name: "Props", icon: Box },
  { name: "Environments", icon: Mountain }, { name: "Styles", icon: Palette },
  { name: "Scenes", icon: Clapperboard },
];

/** Stable-ID to display-label mapping (Phase 4). */
const CATEGORY_ID_TO_LABEL: Record<string, Category> = {
  "character": "Characters", "prop": "Props", "environment": "Environments",
  "visual_style": "Styles", "scene": "Scenes",
};

/** Display-label to i18n key mapping. */
const CATEGORY_KEY_BY_LABEL: Record<Category, string> = {
  "Characters": "characters", "Props": "props", "Environments": "environments",
  "Styles": "styles", "Scenes": "scenes",
};

export default function AssetsPage() {
  const apiError = useApiError();
  const t = useTranslations("assets");
  const locale = useLocale();
  const tCat = useTranslations("assets.categories");
  const [data, setData] = useState<Payload>({ assets: [], total: 0, allTotal: 0, counts: { Characters: 0, Props: 0, Environments: 0, Styles: 0, Scenes: 0 }, collections: [] });
  const [category, setCategory] = useState<Category | null>(null);
  const [collection, setCollection] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [classifying, setClassifying] = useState<Set<string>>(new Set());
  const [bulkClassifying, setBulkClassifying] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const buildQuery = useCallback((offset: number) => {
    const qs = new URLSearchParams();
    if (category) qs.set("category", category);
    if (collection) qs.set("collection", collection);
    if (query.trim()) qs.set("q", query.trim());
    qs.set("limit", String(PAGE_SIZE));
    qs.set("offset", String(offset));
    return qs;
  }, [category, collection, query]);

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
        const next = await res.json() as Payload;
        setData((prev) => {
          const seen = new Set(prev.assets.map((asset) => asset.id));
          return { ...next, assets: [...prev.assets, ...next.assets.filter((asset) => !seen.has(asset.id))] };
        });
      }
    } finally {
      setLoadingMore(false);
    }
  }, [buildQuery, data.assets.length, data.hasMore, loadingMore]);

  // Fetch the next page when the sentinel below the grid scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !data.hasMore) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void loadMore(); }, { rootMargin: "600px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [data.hasMore, loadMore]);

  useEffect(() => { void fetch("/api/assets/reconcile", { method: "POST" }); }, []);
  // Fetch response updates are asynchronous; this is not a render-loop state write.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const title = useMemo(() => {
    if (collection) return data.collections.find((item) => item.id === collection)?.name ?? "Collection";
    return category ?? t("title");
  }, [category, collection, data.collections, t]);

  async function updateCategory(asset: Asset, next: string) {
    const catId = Object.entries(CATEGORY_ID_TO_LABEL).find(([, label]) => label === next)?.[0] ?? null;
    await fetch(`/api/assets/${asset.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: next || null, manualCategoryId: catId }) });
  }

  async function batchCategory(next: string) {
    const catId = Object.entries(CATEGORY_ID_TO_LABEL).find(([, label]) => label === next)?.[0] ?? null;
    await Promise.all([...selectedIds].map(id =>
      fetch(`/api/assets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: next || null, manualCategoryId: catId }) }),
    ));
    setSelectedIds(new Set());
    await load();
  }

  /** Ask the vision model about one asset. `apply` writes the answer back. */
  async function classifyAsset(asset: Asset, apply = true) {
    const res = await fetch(`/api/assets/${asset.id}/classify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply, language: locale.startsWith("zh") ? "zh" : "en" }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      const err = new Error(data.error ?? t("aiFailed")) as Error & { code?: string };
      err.code = data.code;
      throw err;
    }
    return (await res.json()) as { suggestion: { category: string; description: string; tags: string[] } };
  }

  async function classifyOne(asset: Asset) {
    if (classifying.has(asset.id)) return;
    setClassifying(prev => new Set(prev).add(asset.id));
    try {
      await classifyAsset(asset);
      await load();
    } catch (e) {
      const err = e as Error & { code?: string };
      useWorkflowStore.getState().addToast(
        err.code === "vision_not_configured" ? t("aiNotConfigured") : (err.message || t("aiFailed")),
        "error",
      );
    } finally {
      setClassifying(prev => { const n = new Set(prev); n.delete(asset.id); return n; });
    }
  }

  async function classifySelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkClassifying(true);
    let done = 0, failed = 0, unconfigured = false;
    // Sequential: one request at a time keeps us inside the provider's rate
    // limit and lets the user see progress rather than a frozen button.
    for (const id of ids) {
      const asset = data.assets.find(a => a.id === id);
      if (!asset) continue;
      setClassifying(prev => new Set(prev).add(id));
      try { await classifyAsset(asset); done += 1; }
      catch (e) {
        const err = e as Error & { code?: string };
        if (err.code === "vision_not_configured") { unconfigured = true; break; }
        failed += 1;
      } finally {
        setClassifying(prev => { const n = new Set(prev); n.delete(id); return n; });
      }
    }
    setBulkClassifying(false);
    setSelectedIds(new Set());
    await load();
    if (unconfigured) useWorkflowStore.getState().addToast(t("aiNotConfigured"), "error");
    else useWorkflowStore.getState().addToast(`${t("aiDone")} ${done}${failed ? ` / ${failed} ${t("aiFailed")}` : ""}`, failed ? "error" : "success");
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function createCollection(kind: "manual" | "smart") {
    setMenuOpen(false);
    const name = window.prompt(kind === "smart" ? "Smart collection name" : "Collection name");
    if (!name?.trim()) return;
    const rule = kind === "smart" ? { category: category ?? "Characters" } : null;
    const res = await fetch("/api/assets/collections", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), kind, rule }),
    });
    if (!res.ok) window.alert(apiError(await res.json(), "Unable to create collection"));
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

  const activeCollection = data.collections.find((item) => item.id === collection);

  return (
    <main className="flex min-h-0 flex-1 bg-[#0c0f14] text-white">
      <aside className="w-[272px] shrink-0 border-r border-white/10 bg-[#11151b] p-4 overflow-y-auto">
        <button onClick={() => { setCategory(null); setCollection(null); }} className={`mb-3 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${!category && !collection ? "bg-white/10" : "text-white/65 hover:bg-white/5"}`}>
          <Library size={19} /> <span className="flex-1">{t("title")}</span><span className="text-xs text-white/35">{data.allTotal}</span>
        </button>
        <div className="space-y-1">
          {CATEGORIES.map(({ name, icon: Icon }) => (
            <button key={name} onClick={() => { setCategory(name); setCollection(null); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${category === name && !collection ? "bg-white/10" : "text-white/65 hover:bg-white/5"}`}>
              <Icon size={19} /><span className="flex-1">{tCat(CATEGORY_KEY_BY_LABEL[name])}</span><span className="rounded bg-white/5 px-1.5 text-xs text-white/40">{data.counts[name] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="mt-8 flex items-center justify-between px-2">
          <span className="text-sm font-medium text-white/70">{t("collections")}</span>
          <div className="relative">
            <button onClick={() => setMenuOpen(!menuOpen)} className="flex size-8 items-center justify-center rounded-lg bg-white/5 text-white/65 hover:bg-white/10"><Plus size={18} /></button>
            {menuOpen && <div className="absolute right-0 top-10 z-20 w-52 rounded-xl border border-white/10 bg-[#1a1f27] p-1.5 shadow-2xl">
              <button onClick={() => createCollection("manual")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/8"><FolderPlus size={17} />{t("newCollection")}</button>
              <button onClick={() => createCollection("smart")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/8"><Sparkles size={17} />{t("newSmartCollection")}</button>
            </div>}
          </div>
        </div>
        <div className="mt-2 space-y-1">
          {data.collections.map((item) => <button key={item.id} onClick={() => { setCollection(item.id); setCategory(null); }} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${collection === item.id ? "bg-white/10" : "text-white/55 hover:bg-white/5"}`}>
            {item.kind === "smart" ? <Sparkles size={15} /> : <ImageIcon size={15} />}<span className="flex-1 truncate">{item.name}</span><span className="text-xs text-white/35">{item.asset_count}</span>
          </button>)}
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex items-center gap-4">
          <div className="min-w-0 flex-1"><h1 className="text-2xl font-semibold">{title}</h1><p className="mt-1 text-sm text-white/40">{t("sharedWith")} · {data.total} {t("indexed")}</p></div>
          <label className="flex w-72 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3"><Search size={16} className="text-white/35" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchPlaceholder")} className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/25" /></label>
        </div>
        {loading ? <div className="py-20 text-center text-white/35">Indexing shared media…</div> : data.assets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 py-24 text-center text-white/40">Drop files into <code className="text-white/65">assets/{category ?? "Characters"}</code> in Seek, then they appear here automatically.</div>
        ) : <>
          {selectedIds.size > 0 && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5">
              <span className="text-sm text-white/70">{selectedIds.size} {t("selected")}</span>
              <div className="flex gap-2">
                {CATEGORIES.map(({ name }) => (
                  <button key={name} onClick={() => void batchCategory(name)} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/70 hover:bg-white/10">{tCat(CATEGORY_KEY_BY_LABEL[name])}</button>
                ))}
                <button onClick={() => void batchCategory("")} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/45 hover:bg-white/10">{t("clear")}</button>
                <button onClick={() => void classifySelected()} disabled={bulkClassifying} className="rounded-lg border border-[var(--primary)]/40 bg-[var(--primary)]/10 px-2.5 py-1 text-xs text-[var(--primary)] hover:bg-[var(--primary)]/20 disabled:opacity-40">{bulkClassifying ? t("aiClassifying") : t("aiClassifySelected")}</button>
              </div>
              <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-white/35 hover:text-white/70">{t("deselectAll")}</button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-4">
          {data.assets.map((asset) => <article key={asset.id} className={`overflow-hidden rounded-2xl border bg-white/[0.035] ${selectedIds.has(asset.id) ? "border-teal-500/60" : "border-white/10"}`}>
            <div className="relative aspect-video bg-black/35">
              <button onClick={() => toggleSelect(asset.id)} className="absolute left-2 top-2 z-10 flex size-6 items-center justify-center rounded-md border bg-black/50 text-xs" style={selectedIds.has(asset.id) ? {background: "rgba(20,184,166,0.8)", borderColor: "rgba(20,184,166,0.8)", color: "var(--neutral-12)"} : {borderColor: "rgba(255,255,255,0.2)", color: "transparent"}}>✓</button>
              {asset.mime_type.startsWith("video/")
                ? <video src={asset.url} poster={videoPosterUrl(asset.url, asset.poster_url, 360)} preload="none" controls playsInline className="h-full w-full object-cover" />
                : asset.mime_type.startsWith("audio/")
                  ? <div className="flex h-full items-center justify-center"><audio src={asset.url} controls preload="none" /></div>
                  // eslint-disable-next-line @next/next/no-img-element
                  : <img src={previewImageUrl(asset.url, 320)} alt={asset.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />}
            </div>
            <div className="space-y-3 p-3">
              <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{asset.name}</div><div className="mt-0.5 truncate text-xs text-white/35">{asset.model || asset.source} · {asset.relative_path}</div></div><button title={t("aiClassify")} aria-label={t("aiClassify")} disabled={classifying.has(asset.id)} onClick={() => void classifyOne(asset)} className="rounded-lg p-1.5 text-white/35 hover:bg-white/10 hover:text-white disabled:opacity-40"><Sparkles size={15} /></button>
                <button title="Copy reference URL" onClick={() => { void copyText(asset.url).catch(() => useWorkflowStore.getState().addToast("Could not copy to clipboard.", "error")); }} className="rounded-lg p-1.5 text-white/35 hover:bg-white/10 hover:text-white"><Copy size={15} /></button></div>
              {asset.prompt && <p className="line-clamp-2 text-xs leading-5 text-white/45">{asset.prompt}</p>}
              <div className="flex gap-2">
                <select value={asset.category ?? ""} onChange={(e) => updateCategory(asset, e.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#171b22] px-2 py-1.5 text-xs text-white/70 outline-none"><option value="">{t("uncategorized")}</option>{CATEGORIES.map(({ name }) => <option key={name}>{name}</option>)}</select>
                {activeCollection?.kind === "manual" && <button onClick={() => toggleMembership(asset.id, false)} className="rounded-lg border border-white/10 px-2 text-xs text-white/55 hover:bg-white/10">{t("remove")}</button>}
              </div>
              {asset.asset_tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {asset.asset_tags.map(tag => <span key={tag} className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/55">{tag}</span>)}
                </div>
              )}
              {!activeCollection && data.collections.some((item) => item.kind === "manual") && <select defaultValue="" onChange={(e) => { const collectionId = e.target.value; if (collectionId) void toggleMembership(asset.id, true, collectionId).then(() => { e.target.value = ""; }); }} className="w-full rounded-lg border border-white/10 bg-[#171b22] px-2 py-1.5 text-xs text-white/55 outline-none"><option value="">{t("addToCollection")}</option>{data.collections.filter((item) => item.kind === "manual").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            </div>
          </article>)}
          </div>
          {data.hasMore && (
            <div ref={sentinelRef} className="flex justify-center py-8">
              <button onClick={() => void loadMore()} disabled={loadingMore} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/55 hover:bg-white/5 disabled:opacity-50">
                {loadingMore ? "…" : `${data.assets.length} / ${data.total}`}
              </button>
            </div>
          )}
        </>}
      </section>
    </main>
  );
}
