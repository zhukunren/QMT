import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type { Artifact, Plan, Job } from "@qmt/shared";

export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS records_kind_time ON records(kind, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_request_id ON records(json_extract(body, '$.requestId')) WHERE kind='job' AND json_extract(body, '$.requestId') IS NOT NULL;
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL, record_id TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL);`);
    // In-process jobs cannot survive a restart. Mark interrupted work truthfully.
    for (const job of this.list<Job>("job", 1000)) {
      if (job.status === "running" || job.status === "queued")
        this.save("job", {
          ...job,
          status: "failed",
          error: "服务已重启，请重新生成。",
        });
    }
  }
  save(kind: string, value: Plan | Artifact | Job) {
    const createdAt =
      "createdAt" in value
        ? value.createdAt
        : value.events[0]?.at || new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO records(id,kind,created_at,body) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(value.id, kind, createdAt, JSON.stringify(value));
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT body FROM records WHERE kind=? AND id=?")
      .get(kind, id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as T) : undefined;
  }
  jobForRequest(requestId: string): Job | undefined {
    const row = this.db
      .prepare(
        "SELECT body FROM records WHERE kind='job' AND json_extract(body, '$.requestId')=?",
      )
      .get(requestId) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as Job) : undefined;
  }
  list<T>(kind: string, limit = 100): T[] {
    return (
      this.db
        .prepare(
          "SELECT body FROM records WHERE kind=? ORDER BY created_at DESC LIMIT ?",
        )
        .all(kind, limit) as { body: string }[]
    ).map((r) => JSON.parse(r.body) as T);
  }
  deleteArtifact(id: string): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const removed = this.db
        .prepare("DELETE FROM records WHERE kind='artifact' AND id=?")
        .run(id);
      if (removed.changes) this.audit("artifact.deleted", id);
      this.db.exec("COMMIT");
      return Boolean(removed.changes);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  audit(action: string, id: string) {
    const prev = this.db
      .prepare("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1")
      .get() as { hash: string } | undefined;
    const at = new Date().toISOString();
    const previous = prev?.hash || "0".repeat(64);
    const hash = createHash("sha256")
      .update(JSON.stringify([at, action, id, previous]))
      .digest("hex");
    this.db
      .prepare(
        "INSERT INTO audit(at,action,record_id,previous_hash,hash) VALUES(?,?,?,?,?)",
      )
      .run(at, action, id, previous, hash);
  }
  close() {
    this.db.close();
  }
}
