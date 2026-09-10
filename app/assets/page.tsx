"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Clapperboard, Copy, FolderPlus, Image as ImageIcon, Library,
  Mountain, Palette, Plus, Search, Sparkles, UserRound,
} from "lucide-react";

type Category = "Characters" | "Props" | "Environments" | "Styles" | "Scenes";
type Asset = {
  id: string; name: string; url: string; relative_path: string; category: Category | null;
  mime_type: string; source: string; prompt: string | null; model: string | null; description: string | null;
};
type Collection = { id: string; name: string; kind: "manual" | "smart"; asset_count: number };
type Payload = { assets: Asset[]; total: number; allTotal: number; counts: Record<Category, number>; collections: Collection[] };

const CATEGORIES: { name: Category; icon: typeof UserRound }[] = [
  { name: "Characters", icon: UserRound }, { name: "Props", icon: Box },
  { name: "Environments", icon: Mountain }, { name: "Styles", icon: Palette },
  { name: "Scenes", icon: Clapperboard },
];

export default function AssetsPage() {
  const [data, setData] = useState<Payload>({ assets: [], total: 0, allTotal: 0, counts: { Characters: 0, Props: 0, Environments: 0, Styles: 0, Scenes: 0 }, collections: [] });
  const [category, setCategory] = useState<Category | null>(null);
  const [collection, setCollection] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (category) qs.set("category", category);
    if (collection) qs.set("collection", collection);
    if (query.trim()) qs.set("q", query.trim());
    const res = await fetch(`/api/assets?${qs}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [category, collection, query]);

  useEffect(() => { void fetch("/api/assets/reconcile", { method: "POST" }); }, []);
  // Fetch response updates are asynchronous; this is not a render-loop state write.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const title = useMemo(() => {
    if (collection) return data.collections.find((item) => item.id === collection)?.name ?? "Collection";
    return category ?? "All creative assets";
  }, [category, collection, data.collections]);

  async function updateCategory(asset: Asset, next: string) {
    await fetch(`/api/assets/${asset.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: next || null }) });
    await load();
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
    if (!res.ok) window.alert((await res.json()).error ?? "Unable to create collection");
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
          <Library size={19} /> <span className="flex-1">All assets</span><span className="text-xs text-white/35">{data.allTotal}</span>
        </button>
        <div className="space-y-1">
          {CATEGORIES.map(({ name, icon: Icon }) => (
            <button key={name} onClick={() => { setCategory(name); setCollection(null); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${category === name && !collection ? "bg-white/10" : "text-white/65 hover:bg-white/5"}`}>
              <Icon size={19} /><span className="flex-1">{name}</span><span className="rounded bg-white/5 px-1.5 text-xs text-white/40">{data.counts[name] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="mt-8 flex items-center justify-between px-2">
          <span className="text-sm font-medium text-white/70">Collections</span>
          <div className="relative">
            <button onClick={() => setMenuOpen(!menuOpen)} className="flex size-8 items-center justify-center rounded-lg bg-white/5 text-white/65 hover:bg-white/10"><Plus size={18} /></button>
            {menuOpen && <div className="absolute right-0 top-10 z-20 w-52 rounded-xl border border-white/10 bg-[#1a1f27] p-1.5 shadow-2xl">
              <button onClick={() => createCollection("manual")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/8"><FolderPlus size={17} />New collection</button>
              <button onClick={() => createCollection("smart")} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/8"><Sparkles size={17} />New smart collection</button>
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
          <div className="min-w-0 flex-1"><h1 className="text-2xl font-semibold">{title}</h1><p className="mt-1 text-sm text-white/40">Shared with Seek · one file on disk · {data.assets.length} indexed</p></div>
          <label className="flex w-72 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3"><Search size={16} className="text-white/35" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search assets, prompts, models" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/25" /></label>
        </div>
        {loading ? <div className="py-20 text-center text-white/35">Indexing shared media…</div> : data.assets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 py-24 text-center text-white/40">Drop files into <code className="text-white/65">assets/{category ?? "Characters"}</code> in Seek, then they appear here automatically.</div>
        ) : <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-4">
          {data.assets.map((asset) => <article key={asset.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
            <div className="aspect-video bg-black/35">{asset.mime_type.startsWith("video/") ? <video src={asset.url} controls className="h-full w-full object-cover" /> : asset.mime_type.startsWith("audio/") ? <div className="flex h-full items-center justify-center"><audio src={asset.url} controls /></div> : <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />}</div>
            <div className="space-y-3 p-3">
              <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{asset.name}</div><div className="mt-0.5 truncate text-xs text-white/35">{asset.model || asset.source} · {asset.relative_path}</div></div><button title="Copy reference URL" onClick={() => navigator.clipboard.writeText(asset.url)} className="rounded-lg p-1.5 text-white/35 hover:bg-white/10 hover:text-white"><Copy size={15} /></button></div>
              {asset.prompt && <p className="line-clamp-2 text-xs leading-5 text-white/45">{asset.prompt}</p>}
              <div className="flex gap-2">
                <select value={asset.category ?? ""} onChange={(e) => updateCategory(asset, e.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#171b22] px-2 py-1.5 text-xs text-white/70 outline-none"><option value="">Uncategorized</option>{CATEGORIES.map(({ name }) => <option key={name}>{name}</option>)}</select>
                {activeCollection?.kind === "manual" && <button onClick={() => toggleMembership(asset.id, false)} className="rounded-lg border border-white/10 px-2 text-xs text-white/55 hover:bg-white/10">Remove</button>}
              </div>
              {!activeCollection && data.collections.some((item) => item.kind === "manual") && <select defaultValue="" onChange={(e) => { const collectionId = e.target.value; if (collectionId) void toggleMembership(asset.id, true, collectionId).then(() => { e.target.value = ""; }); }} className="w-full rounded-lg border border-white/10 bg-[#171b22] px-2 py-1.5 text-xs text-white/55 outline-none"><option value="">Add to collection…</option>{data.collections.filter((item) => item.kind === "manual").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            </div>
          </article>)}
        </div>}
      </section>
    </main>
  );
}
