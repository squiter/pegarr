import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, closeSync, openSync } from "node:fs";
import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface SessionStoreOptions {
  readonly databasePath?: string;
  readonly now?: () => number;
  readonly randomToken?: () => string;
  readonly ttlMs?: number;
  readonly maxSessions?: number;
}

export interface CreatedSession {
  readonly token: string;
  readonly csrfToken: string;
  readonly expiresAt: string;
}

export interface RefreshedSession {
  readonly csrfToken: string;
  readonly expiresAt: string;
}

interface StoredSession {
  readonly csrfDigest: Buffer;
  readonly expiresAtMs: number;
}

interface SessionRow {
  readonly csrf_digest: Uint8Array;
  readonly expires_at_ms: number;
}

const defaultTtlMs = 8 * 60 * 60_000;
const defaultMaxSessions = 100;

export class SessionStore {
  readonly #database: DatabaseSync;
  readonly #now: () => number;
  readonly #randomToken: () => string;
  readonly #ttlMs: number;
  readonly #maxSessions: number;

  constructor(options: SessionStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
    this.#ttlMs = boundedInteger(options.ttlMs ?? defaultTtlMs, 60_000, 24 * 60 * 60_000, "ttlMs");
    this.#maxSessions = boundedInteger(options.maxSessions ?? defaultMaxSessions, 1, 1_000, "maxSessions");
    const databasePath = options.databasePath ?? ":memory:";
    if (databasePath !== ":memory:" && !isAbsolute(databasePath)) {
      throw new TypeError("Session database path must be absolute");
    }
    if (databasePath !== ":memory:") preparePrivateDatabaseFile(databasePath);
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        session_digest TEXT NOT NULL UNIQUE CHECK (length(session_digest) = 64),
        csrf_digest BLOB NOT NULL CHECK (length(csrf_digest) = 32),
        expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= 0)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at_ms);
    `);
    this.#prune(safeNow(this.#now()));
  }

  create(): CreatedSession {
    const now = safeNow(this.#now());
    const token = opaqueToken(this.#randomToken(), "session token");
    const csrfToken = opaqueToken(this.#randomToken(), "CSRF token");
    const expiresAtMs = Math.min(8.64e15, now + this.#ttlMs);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#prune(now);
      const count = (this.#database.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { readonly count: number }).count;
      if (count >= this.#maxSessions) {
        this.#database.prepare(`
          DELETE FROM sessions
          WHERE sequence IN (
            SELECT sequence FROM sessions
            ORDER BY sequence ASC
            LIMIT ?
          )
        `).run(count - this.#maxSessions + 1);
      }
      this.#database.prepare(`
        INSERT INTO sessions(session_digest, csrf_digest, expires_at_ms)
        VALUES (?, ?, ?)
      `).run(digestHex(token), digest(csrfToken), expiresAtMs);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return { token, csrfToken, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  authenticate(token: string | undefined): boolean {
    return this.#read(token) !== undefined;
  }

  authorizeMutation(token: string | undefined, csrfToken: string | undefined): boolean {
    if (csrfToken === undefined || csrfToken.length > 128) return false;
    const session = this.#read(token);
    return session !== undefined && timingSafeEqual(session.csrfDigest, digest(csrfToken));
  }

  refresh(token: string | undefined): RefreshedSession | undefined {
    const session = this.#read(token);
    if (session === undefined || token === undefined) return undefined;
    const csrfToken = opaqueToken(this.#randomToken(), "CSRF token");
    this.#database.prepare(`
      UPDATE sessions SET csrf_digest = ? WHERE session_digest = ?
    `).run(digest(csrfToken), digestHex(token));
    return { csrfToken, expiresAt: new Date(session.expiresAtMs).toISOString() };
  }

  destroy(token: string | undefined): void {
    if (!validToken(token)) return;
    this.#database.prepare("DELETE FROM sessions WHERE session_digest = ?").run(digestHex(token));
  }

  close(): void {
    this.#database.close();
  }

  #read(token: string | undefined): StoredSession | undefined {
    if (!validToken(token)) return undefined;
    const now = safeNow(this.#now());
    this.#prune(now);
    const row = this.#database.prepare(`
      SELECT csrf_digest, expires_at_ms
      FROM sessions
      WHERE session_digest = ?
    `).get(digestHex(token)) as SessionRow | undefined;
    if (row === undefined) return undefined;
    const csrfDigest = Buffer.from(row.csrf_digest);
    if (csrfDigest.byteLength !== 32 || !Number.isSafeInteger(row.expires_at_ms)) {
      this.destroy(token);
      return undefined;
    }
    return { csrfDigest, expiresAtMs: row.expires_at_ms };
  }

  #prune(now: number): void {
    this.#database.prepare("DELETE FROM sessions WHERE expires_at_ms <= ?").run(now);
  }
}

function preparePrivateDatabaseFile(path: string): void {
  const descriptor = openSync(path, "a", 0o600);
  closeSync(descriptor);
  chmodSync(path, 0o600);
}

function validToken(value: string | undefined): value is string {
  return value !== undefined && value.length >= 32 && value.length <= 128 && /^[A-Za-z0-9_-]+$/u.test(value);
}

function opaqueToken(value: string, field: string): string {
  if (!validToken(value)) throw new TypeError(`${field} is invalid`);
  return value;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function digestHex(value: string): string {
  return digest(value).toString("hex");
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${field} is invalid`);
  return value;
}

function safeNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8.64e15) throw new TypeError("Session clock is invalid");
  return value;
}
