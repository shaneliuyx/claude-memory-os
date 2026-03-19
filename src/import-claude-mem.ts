import Database from "better-sqlite3";
import { existsSync } from "fs";
import { join } from "path";
import { storeMemory } from "./memory.js";

const CLAUDE_MEM_DB = join(
  process.env.CLAUDE_MEM_DATA_DIR ||
    join(process.env.HOME || "~", ".claude-mem"),
  "claude-mem.db"
);

// Map claude-mem types to memory-os categories
const TYPE_TO_CATEGORY: Record<string, string> = {
  decision: "semantic",
  bugfix: "episodic",
  feature: "episodic",
  refactor: "episodic",
  discovery: "semantic",
  change: "episodic",
};

interface ClaudeMemObservation {
  id: number;
  type: string;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  text: string | null;
  facts: string | null;
  concepts: string | null;
  project: string;
  created_at: string;
  files_modified: string | null;
}

export function importClaudeMem(
  targetDb: Database.Database,
  opts: { limit?: number; project?: string; since?: string } = {}
): { imported: number; skipped: number; total: number; errors: string[] } {
  if (!existsSync(CLAUDE_MEM_DB)) {
    return {
      imported: 0,
      skipped: 0,
      total: 0,
      errors: [`claude-mem database not found at ${CLAUDE_MEM_DB}`],
    };
  }

  const sourceDb = new Database(CLAUDE_MEM_DB, { readonly: true });
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  let sql = `SELECT id, type, title, subtitle, narrative, text, facts, concepts, project, created_at, files_modified
    FROM observations WHERE 1=1`;
  const params: (string | number)[] = [];

  if (opts.project) {
    sql += " AND project = ?";
    params.push(opts.project);
  }
  if (opts.since) {
    sql += " AND created_at > ?";
    params.push(opts.since);
  }

  sql += " ORDER BY created_at_epoch ASC";

  if (opts.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }

  const rows = sourceDb.prepare(sql).all(...params) as ClaudeMemObservation[];
  const total = rows.length;

  for (const row of rows) {
    try {
      // Build rich content from claude-mem fields
      const parts: string[] = [];
      if (row.title) parts.push(`# ${row.title}`);
      if (row.subtitle) parts.push(row.subtitle);
      if (row.narrative) parts.push(row.narrative);
      if (row.text && row.text !== row.narrative) parts.push(row.text);
      if (row.facts) parts.push(`Facts: ${row.facts}`);

      const content = parts.join("\n\n");
      if (!content.trim()) {
        skipped++;
        continue;
      }

      const category = TYPE_TO_CATEGORY[row.type] || "episodic";
      const tags = [row.type, row.concepts || ""].filter(Boolean).join(",");
      const source = `claude-mem:${row.id}`;

      const result = storeMemory(targetDb, content, {
        category,
        tags,
        source,
        project: row.project,
      });

      if (result.action === "created") imported++;
      else skipped++;
    } catch (e) {
      errors.push(`Observation ${row.id}: ${(e as Error).message}`);
      skipped++;
    }
  }

  sourceDb.close();
  return { imported, skipped, total, errors };
}

export { CLAUDE_MEM_DB };
