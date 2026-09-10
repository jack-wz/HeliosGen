import { db } from "./sqlite";

/**
 * Local persistence for workflow "spaces" (node canvases). SQLite-backed
 * (see ./sqlite).
 */
export interface GuestSpace {
  id: string;
  name: string;
  nodes: unknown[];
  edges: unknown[];
  nodeCounters: Record<string, number>;
  createdAt: number;
  updatedAt?: number;
  viewport?: { x: number; y: number; zoom: number };
}

export function getSpaces(): GuestSpace[] {
  const rows = db().prepare("SELECT data FROM spaces ORDER BY updated_at ASC").all() as {
    data: string;
  }[];
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.data) as GuestSpace;
      } catch {
        return null;
      }
    })
    .filter((s): s is GuestSpace => s !== null);
}

export function getSpace(id: string): GuestSpace | null {
  const row = db().prepare("SELECT data FROM spaces WHERE id = ?").get(id) as
    | { data: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.data) as GuestSpace;
  } catch {
    return null;
  }
}

/** Upsert a single space without touching any others (unlike saveSpaces). */
export function saveSpace(space: GuestSpace): void {
  db()
    .prepare(
      `INSERT INTO spaces (id, name, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(
      space.id,
      space.name ?? "Untitled",
      JSON.stringify(space),
      Number(space.updatedAt ?? space.createdAt ?? Date.now()),
    );
}

export function deleteSpace(id: string): boolean {
  const res = db().prepare("DELETE FROM spaces WHERE id = ?").run(id);
  return Number(res.changes) > 0;
}

export function saveSpaces(spaces: GuestSpace[]): void {
  const d = db();
  d.exec("BEGIN");
  const keep = new Set(spaces.map((s) => s.id));
  const upsert = d.prepare(`
    INSERT INTO spaces (id, name, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at
  `);
  for (const s of spaces) {
    upsert.run(s.id, s.name ?? "Untitled", JSON.stringify(s), Number(s.updatedAt ?? s.createdAt ?? Date.now()));
  }
  const existing = d.prepare("SELECT id FROM spaces").all() as { id: string }[];
  const del = d.prepare("DELETE FROM spaces WHERE id = ?");
  for (const { id } of existing) if (!keep.has(id)) del.run(id);
  d.exec("COMMIT");
}
