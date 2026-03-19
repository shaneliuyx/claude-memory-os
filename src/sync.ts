import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join, basename } from "path";
import type Database from "better-sqlite3";
import { storeMemory, searchMemories } from "./memory.js";

const OBSIDIAN_VAULT = join(
  process.env.OBSIDIAN_VAULT_PATH ||
    join(process.env.HOME || "~", "第二大脑")
);

const CATEGORY_MAP: Record<string, string> = {
  "情景记忆": "episodic",
  "语义记忆": "semantic",
  "强制规则": "rules",
};

export function syncFromObsidian(db: Database.Database): {
  imported: number;
  skipped: number;
  errors: string[];
} {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Sync memory files from 第二大脑/记忆库/
  const memoryBase = join(OBSIDIAN_VAULT, "记忆库");
  if (!existsSync(memoryBase)) {
    return { imported: 0, skipped: 0, errors: ["记忆库 directory not found"] };
  }

  for (const [cnDir, category] of Object.entries(CATEGORY_MAP)) {
    const dirPath = join(memoryBase, cnDir);
    if (!existsSync(dirPath)) continue;

    const files = getAllMdFiles(dirPath);
    for (const file of files) {
      try {
        const content = readFileSync(file, "utf-8").trim();
        if (!content) continue;

        const result = storeMemory(db, content, {
          category,
          source: `obsidian:${basename(file)}`,
          tags: category,
          project: "第二大脑",
        });

        if (result.action === "created") imported++;
        else skipped++;
      } catch (e) {
        errors.push(`${file}: ${(e as Error).message}`);
      }
    }
  }

  // Sync task list
  const taskFile = join(OBSIDIAN_VAULT, "任务清单.md");
  if (existsSync(taskFile)) {
    const content = readFileSync(taskFile, "utf-8");
    storeMemory(db, content, {
      category: "task",
      source: "obsidian:任务清单.md",
      project: "第二大脑",
    });
  }

  return { imported, skipped, errors };
}

export function syncToObsidian(
  db: Database.Database,
  opts: { category?: string; since?: string } = {}
): { exported: number; errors: string[] } {
  let exported = 0;
  const errors: string[] = [];

  const hours = opts.since ? parseInt(opts.since) : 24;
  const results = searchMemories(db, "", {
    category: opts.category,
    limit: 50,
  });

  // Get recent memories
  const stmt = db.prepare(`
    SELECT * FROM memories
    WHERE created_at > datetime('now', ?)
    ${opts.category ? "AND category = ?" : ""}
    ORDER BY created_at DESC LIMIT 50
  `);

  const params: (string | number)[] = [`-${hours} hours`];
  if (opts.category) params.push(opts.category);

  const memories = stmt.all(...params) as any[];

  for (const mem of memories) {
    try {
      const cnCategory = Object.entries(CATEGORY_MAP).find(
        ([, v]) => v === mem.category
      )?.[0] || "语义记忆";

      const dateStr = mem.created_at.slice(0, 7); // YYYY-MM
      const targetDir = join(OBSIDIAN_VAULT, "记忆库", cnCategory, dateStr);
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

      const dayStr = mem.created_at.slice(5, 10).replace("-", "");
      const safeContent = mem.content.slice(0, 30).replace(/[/\\?%*:|"<>]/g, "");
      const fileName = `${dayStr}-${safeContent}.md`;
      const filePath = join(targetDir, fileName);

      if (!existsSync(filePath)) {
        const frontmatter = `---
id: ${mem.id}
category: ${mem.category}
tags: [${mem.tags}]
source: ${mem.source}
created: ${mem.created_at}
---

`;
        writeFileSync(filePath, frontmatter + mem.content, "utf-8");
        exported++;
      }
    } catch (e) {
      errors.push(`Memory ${mem.id}: ${(e as Error).message}`);
    }
  }

  return { exported, errors };
}

function getAllMdFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllMdFiles(full));
    } else if (entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

export { OBSIDIAN_VAULT };
