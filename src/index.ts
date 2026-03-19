#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb, DB_PATH } from "./db.js";
import {
  storeMemory,
  searchMemories,
  recallRecent,
  getTimeline,
  getStats,
  deleteMemory,
} from "./memory.js";
import { syncFromObsidian, syncToObsidian, OBSIDIAN_VAULT } from "./sync.js";
import { importClaudeMem, CLAUDE_MEM_DB } from "./import-claude-mem.js";

const db = getDb();
const server = new McpServer({
  name: "claude-memory-os",
  version: "1.0.0",
});

// --- Tool: memory_store ---
server.tool(
  "memory_store",
  "Store a memory with verified write. Categories: episodic (events/conversations), semantic (knowledge/patterns), rules (constraints/preferences), task (todos). Returns verification status.",
  {
    content: z.string().describe("The memory content to store"),
    category: z
      .enum(["episodic", "semantic", "rules", "task"])
      .default("episodic")
      .describe("Memory category"),
    tags: z.string().optional().describe("Comma-separated tags"),
    source: z.string().optional().describe("Source context (file, conversation, url)"),
    project: z.string().optional().describe("Project name for scoping"),
  },
  async (args) => {
    const result = storeMemory(db, args.content, {
      category: args.category,
      tags: args.tags,
      source: args.source,
      project: args.project,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// --- Tool: memory_search ---
server.tool(
  "memory_search",
  "Search memories using hybrid FTS5 trigram + LIKE search with recency scoring. Supports Chinese and English. Use when you need to recall past decisions, rules, experiences, or any stored knowledge.",
  {
    query: z.string().describe("Search query (Chinese or English)"),
    category: z
      .enum(["episodic", "semantic", "rules", "task", ""])
      .optional()
      .describe("Filter by category"),
    project: z.string().optional().describe("Filter by project"),
    limit: z.number().optional().default(10).describe("Max results"),
  },
  async (args) => {
    const results = searchMemories(db, args.query, {
      category: args.category || undefined,
      project: args.project,
      limit: args.limit,
    });
    return {
      content: [
        {
          type: "text" as const,
          text:
            results.length === 0
              ? "No memories found."
              : results
                  .map(
                    (r, i) =>
                      `[${i + 1}] (id:${r.id}, ${r.category}, score:${r.score.toFixed(2)}) ${r.content.slice(0, 200)}${r.content.length > 200 ? "..." : ""}\n    tags:${r.tags} source:${r.source} project:${r.project} created:${r.created_at}`
                  )
                  .join("\n\n"),
        },
      ],
    };
  }
);

// --- Tool: memory_recall ---
server.tool(
  "memory_recall",
  "Recall recent memories for context injection at session start. Returns high-priority memories from the last N hours. Use at the beginning of a session to load relevant context.",
  {
    hours: z.number().optional().default(72).describe("Look back N hours"),
    category: z.string().optional().describe("Filter by category"),
    project: z.string().optional().describe("Filter by project"),
    limit: z.number().optional().default(10).describe("Max memories to recall"),
  },
  async (args) => {
    const memories = recallRecent(db, {
      hours: args.hours,
      category: args.category,
      project: args.project,
      limit: args.limit,
    });
    return {
      content: [
        {
          type: "text" as const,
          text:
            memories.length === 0
              ? "No recent memories."
              : `Recent memories (last ${args.hours}h):\n\n` +
                memories
                  .map(
                    (m, i) =>
                      `[${i + 1}] [${m.category}] ${m.content.slice(0, 300)}${m.content.length > 300 ? "..." : ""}\n    (${m.created_at}, source: ${m.source})`
                  )
                  .join("\n\n"),
        },
      ],
    };
  }
);

// --- Tool: memory_timeline ---
server.tool(
  "memory_timeline",
  "View memory activity timeline showing daily counts and categories over the last N days.",
  {
    days: z.number().optional().default(30).describe("Number of days"),
    category: z.string().optional(),
    project: z.string().optional(),
  },
  async (args) => {
    const timeline = getTimeline(db, args);
    return {
      content: [
        {
          type: "text" as const,
          text:
            timeline.length === 0
              ? "No activity in this period."
              : timeline
                  .map(
                    (t) =>
                      `${t.date}: ${t.count} memories [${t.categories}]`
                  )
                  .join("\n"),
        },
      ],
    };
  }
);

// --- Tool: memory_stats ---
server.tool(
  "memory_stats",
  "Get memory database statistics: total count, breakdown by category and project, recent activity.",
  {},
  async () => {
    const stats = getStats(db);
    return {
      content: [
        {
          type: "text" as const,
          text: `Memory OS Stats:
  Total memories: ${stats.total}
  Last 24h: ${stats.recentCount}
  Oldest: ${stats.oldestMemory || "none"}
  Newest: ${stats.newestMemory || "none"}
  DB: ${DB_PATH}
  Obsidian: ${OBSIDIAN_VAULT}

By category:
${Object.entries(stats.byCategory)
  .map(([k, v]) => `  ${k}: ${v}`)
  .join("\n")}

By project:
${Object.entries(stats.byProject)
  .map(([k, v]) => `  ${k}: ${v}`)
  .join("\n") || "  (none)"}`,
        },
      ],
    };
  }
);

// --- Tool: memory_delete ---
server.tool(
  "memory_delete",
  "Delete a memory by ID. Use with caution - prefer archiving over deletion.",
  {
    id: z.number().describe("Memory ID to delete"),
  },
  async (args) => {
    const ok = deleteMemory(db, args.id);
    return {
      content: [
        {
          type: "text" as const,
          text: ok ? `Deleted memory ${args.id}` : `Memory ${args.id} not found`,
        },
      ],
    };
  }
);

// --- Tool: memory_sync_obsidian ---
server.tool(
  "memory_sync_obsidian",
  "Sync memories between SQLite and the 第二大脑 Obsidian vault. Direction: 'import' (Obsidian→DB), 'export' (DB→Obsidian), 'both'.",
  {
    direction: z
      .enum(["import", "export", "both"])
      .default("both")
      .describe("Sync direction"),
    category: z.string().optional(),
  },
  async (args) => {
    const results: string[] = [];

    if (args.direction === "import" || args.direction === "both") {
      const imp = syncFromObsidian(db);
      results.push(
        `Import: ${imp.imported} new, ${imp.skipped} skipped` +
          (imp.errors.length ? `, ${imp.errors.length} errors` : "")
      );
    }

    if (args.direction === "export" || args.direction === "both") {
      const exp = syncToObsidian(db, { category: args.category });
      results.push(
        `Export: ${exp.exported} written` +
          (exp.errors.length ? `, ${exp.errors.length} errors` : "")
      );
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Obsidian sync complete:\n${results.join("\n")}`,
        },
      ],
    };
  }
);

// --- Tool: memory_import_claude_mem ---
server.tool(
  "memory_import_claude_mem",
  "Import observations from claude-mem plugin (at ~/.claude-mem/claude-mem.db) into Memory OS. Migrates all decisions, discoveries, bugfixes, features, refactors, and changes with their metadata. Safe to run multiple times (deduplicates by content hash).",
  {
    limit: z.number().optional().describe("Max observations to import (default: all)"),
    project: z.string().optional().describe("Only import from this project"),
    since: z.string().optional().describe("Only import after this ISO date (e.g. 2026-03-01)"),
  },
  async (args) => {
    const result = importClaudeMem(db, {
      limit: args.limit,
      project: args.project,
      since: args.since,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: `claude-mem import complete:
  Source: ${CLAUDE_MEM_DB}
  Total observations found: ${result.total}
  Imported: ${result.imported}
  Skipped (duplicate/empty): ${result.skipped}
  Errors: ${result.errors.length}${result.errors.length > 0 ? "\n  " + result.errors.slice(0, 5).join("\n  ") : ""}`,
        },
      ],
    };
  }
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Memory OS failed to start:", err);
  process.exit(1);
});
