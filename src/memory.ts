import { createHash } from "crypto";
import type Database from "better-sqlite3";

export interface Memory {
  id: number;
  content: string;
  category: string;
  tags: string;
  source: string;
  project: string;
  agent: string;
  confidence: number;
  access_count: number;
  created_at: string;
  updated_at: string;
}

export interface StoreResult {
  success: boolean;
  id?: number;
  action: "created" | "duplicate" | "updated" | "error";
  message: string;
  verified?: boolean;
}

export interface SearchResult {
  id: number;
  content: string;
  category: string;
  tags: string;
  source: string;
  project: string;
  score: number;
  created_at: string;
}

function contentHash(content: string): string {
  return createHash("sha256").update(content.trim().toLowerCase()).digest("hex");
}

export function storeMemory(
  db: Database.Database,
  content: string,
  opts: {
    category?: string;
    tags?: string;
    source?: string;
    project?: string;
    agent?: string;
    confidence?: number;
  } = {}
): StoreResult {
  const hash = contentHash(content);
  const category = opts.category || "episodic";
  const tags = opts.tags || "";
  const source = opts.source || "";
  const project = opts.project || "";
  const agent = opts.agent || "claude";
  const confidence = opts.confidence ?? 1.0;

  // Check for duplicate
  const existing = db
    .prepare("SELECT id, content FROM memories WHERE content_hash = ?")
    .get(hash) as { id: number; content: string } | undefined;

  if (existing) {
    // Update access count and timestamp
    db.prepare(
      "UPDATE memories SET access_count = access_count + 1, updated_at = datetime('now') WHERE id = ?"
    ).run(existing.id);
    return {
      success: true,
      id: existing.id,
      action: "duplicate",
      message: `Memory already exists (id: ${existing.id}), updated access count`,
      verified: true,
    };
  }

  // Insert with transaction + verification
  const result = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO memories (content, category, tags, source, project, agent, confidence, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(content, category, tags, source, project, agent, confidence, hash);

    const insertedId = Number(info.lastInsertRowid);

    // Verify write (防止假成功)
    const verify = db
      .prepare("SELECT id FROM memories WHERE id = ? AND content_hash = ?")
      .get(insertedId, hash) as { id: number } | undefined;

    if (!verify) {
      throw new Error("Write verification failed: memory not found after insert");
    }

    return insertedId;
  })();

  return {
    success: true,
    id: result,
    action: "created",
    message: `Memory stored (id: ${result}, category: ${category})`,
    verified: true,
  };
}

export function searchMemories(
  db: Database.Database,
  query: string,
  opts: {
    category?: string;
    project?: string;
    limit?: number;
    minScore?: number;
  } = {}
): SearchResult[] {
  const limit = opts.limit || 10;

  let results: SearchResult[] = [];

  // Strategy 1: FTS5 search
  try {
    let ftsQuery = query
      .replace(/['"]/g, "")
      .trim();

    // For short queries (< 3 chars), use LIKE fallback
    if (ftsQuery.length < 3) {
      return likeFallback(db, query, opts);
    }

    let sql = `
      SELECT m.id, m.content, m.category, m.tags, m.source, m.project,
             m.created_at, rank * -1.0 as score
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.rowid
      WHERE memories_fts MATCH ?
    `;
    const params: (string | number)[] = [ftsQuery];

    if (opts.category) {
      sql += " AND m.category = ?";
      params.push(opts.category);
    }
    if (opts.project) {
      sql += " AND m.project = ?";
      params.push(opts.project);
    }

    sql += " ORDER BY score DESC LIMIT ?";
    params.push(limit);

    results = db.prepare(sql).all(...params) as SearchResult[];
  } catch {
    // FTS failed, fall back to LIKE
    results = likeFallback(db, query, opts);
  }

  // Strategy 2: If FTS returned few results, supplement with LIKE
  if (results.length < 3) {
    const likeResults = likeFallback(db, query, opts);
    const existingIds = new Set(results.map((r) => r.id));
    for (const r of likeResults) {
      if (!existingIds.has(r.id)) {
        results.push(r);
        if (results.length >= limit) break;
      }
    }
  }

  // Apply recency decay scoring
  return results.map((r) => {
    const ageHours =
      (Date.now() - new Date(r.created_at + "Z").getTime()) / 3600000;
    const recencyBoost = Math.exp(-ageHours / (24 * 30)); // 30-day half-life
    return { ...r, score: (r.score || 1) * (0.5 + 0.5 * recencyBoost) };
  });
}

function likeFallback(
  db: Database.Database,
  query: string,
  opts: { category?: string; project?: string; limit?: number }
): SearchResult[] {
  const limit = opts.limit || 10;
  let sql = `
    SELECT id, content, category, tags, source, project, created_at, 0.5 as score
    FROM memories WHERE content LIKE ?
  `;
  const params: (string | number)[] = [`%${query}%`];

  if (opts.category) {
    sql += " AND category = ?";
    params.push(opts.category);
  }
  if (opts.project) {
    sql += " AND project = ?";
    params.push(opts.project);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params) as SearchResult[];
}

export function recallRecent(
  db: Database.Database,
  opts: {
    category?: string;
    project?: string;
    limit?: number;
    hours?: number;
  } = {}
): Memory[] {
  const limit = opts.limit || 10;
  const hours = opts.hours || 72;

  let sql = `
    SELECT * FROM memories
    WHERE created_at > datetime('now', ?)
  `;
  const params: (string | number)[] = [`-${hours} hours`];

  if (opts.category) {
    sql += " AND category = ?";
    params.push(opts.category);
  }
  if (opts.project) {
    sql += " AND project = ?";
    params.push(opts.project);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params) as Memory[];
}

export function getTimeline(
  db: Database.Database,
  opts: { days?: number; category?: string; project?: string } = {}
): { date: string; count: number; categories: string }[] {
  const days = opts.days || 30;
  let sql = `
    SELECT date(created_at) as date,
           COUNT(*) as count,
           GROUP_CONCAT(DISTINCT category) as categories
    FROM memories
    WHERE created_at > datetime('now', ?)
  `;
  const params: (string | number)[] = [`-${days} days`];

  if (opts.category) {
    sql += " AND category = ?";
    params.push(opts.category);
  }
  if (opts.project) {
    sql += " AND project = ?";
    params.push(opts.project);
  }

  sql += " GROUP BY date(created_at) ORDER BY date DESC";

  return db.prepare(sql).all(...params) as {
    date: string;
    count: number;
    categories: string;
  }[];
}

export function getStats(db: Database.Database): {
  total: number;
  byCategory: Record<string, number>;
  byProject: Record<string, number>;
  recentCount: number;
  oldestMemory: string | null;
  newestMemory: string | null;
} {
  const total = (
    db.prepare("SELECT COUNT(*) as c FROM memories").get() as { c: number }
  ).c;

  const byCat = db
    .prepare(
      "SELECT category, COUNT(*) as c FROM memories GROUP BY category ORDER BY c DESC"
    )
    .all() as { category: string; c: number }[];

  const byProj = db
    .prepare(
      "SELECT project, COUNT(*) as c FROM memories WHERE project != '' GROUP BY project ORDER BY c DESC"
    )
    .all() as { project: string; c: number }[];

  const recentCount = (
    db
      .prepare(
        "SELECT COUNT(*) as c FROM memories WHERE created_at > datetime('now', '-24 hours')"
      )
      .get() as { c: number }
  ).c;

  const oldest = db
    .prepare("SELECT created_at FROM memories ORDER BY created_at ASC LIMIT 1")
    .get() as { created_at: string } | undefined;

  const newest = db
    .prepare(
      "SELECT created_at FROM memories ORDER BY created_at DESC LIMIT 1"
    )
    .get() as { created_at: string } | undefined;

  return {
    total,
    byCategory: Object.fromEntries(byCat.map((r) => [r.category, r.c])),
    byProject: Object.fromEntries(byProj.map((r) => [r.project, r.c])),
    recentCount,
    oldestMemory: oldest?.created_at || null,
    newestMemory: newest?.created_at || null,
  };
}

export function deleteMemory(db: Database.Database, id: number): boolean {
  const info = db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  return info.changes > 0;
}
