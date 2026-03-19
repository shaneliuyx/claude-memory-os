import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(
  process.env.MEMORY_OS_DATA_DIR ||
    join(process.env.HOME || "~", ".claude-memory-os")
);
const DB_PATH = join(DATA_DIR, "memories.db");

export function getDb(): Database.Database {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'episodic',
      tags TEXT DEFAULT '',
      source TEXT DEFAULT '',
      project TEXT DEFAULT '',
      agent TEXT DEFAULT 'user',
      confidence REAL DEFAULT 1.0,
      access_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      content_hash TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS memory_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL DEFAULT 'related',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (from_id) REFERENCES memories(id),
      FOREIGN KEY (to_id) REFERENCES memories(id),
      UNIQUE(from_id, to_id, relation_type)
    );

    CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash);
  `);

  // FTS5 with trigram tokenizer for Chinese-friendly search
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content, tags, source, project,
        content='memories',
        content_rowid='id',
        tokenize='trigram'
      );
    `);
  } catch {
    // Fallback if trigram not available (older SQLite)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content, tags, source, project,
        content='memories',
        content_rowid='id',
        tokenize='unicode61'
      );
    `);
  }

  // Triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, tags, source, project)
      VALUES (new.id, new.content, new.tags, new.source, new.project);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags, source, project)
      VALUES ('delete', old.id, old.content, old.tags, old.source, old.project);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags, source, project)
      VALUES ('delete', old.id, old.content, old.tags, old.source, old.project);
      INSERT INTO memories_fts(rowid, content, tags, source, project)
      VALUES (new.id, new.content, new.tags, new.source, new.project);
    END;
  `);
}

export { DB_PATH, DATA_DIR };
