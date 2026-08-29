import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface SessionStoreOptions {
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

const defaultTtlMs = 8 * 60 * 60_000;
const defaultMaxSessions = 100;

export class SessionStore {
  readonly #now: () => number;
  readonly #randomToken: () => string;
  readonly #ttlMs: number;
  readonly #maxSessions: number;
  readonly #sessions = new Map<string, StoredSession>();

  constructor(options: SessionStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
    this.#ttlMs = boundedInteger(options.ttlMs ?? defaultTtlMs, 60_000, 24 * 60 * 60_000, "ttlMs");
    this.#maxSessions = boundedInteger(options.maxSessions ?? defaultMaxSessions, 1, 1_000, "maxSessions");
  }

  create(): CreatedSession {
    const now = safeNow(this.#now());
    this.#prune(now);
    while (this.#sessions.size >= this.#maxSessions) {
      const oldest = this.#sessions.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#sessions.delete(oldest);
    }
    const token = opaqueToken(this.#randomToken(), "session token");
    const csrfToken = opaqueToken(this.#randomToken(), "CSRF token");
    const expiresAtMs = now + this.#ttlMs;
    this.#sessions.set(digestHex(token), { csrfDigest: digest(csrfToken), expiresAtMs });
    return { token, csrfToken, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  authenticate(token: string | undefined): boolean {
    const session = this.#read(token);
    return session !== undefined;
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
    this.#sessions.set(digestHex(token), { ...session, csrfDigest: digest(csrfToken) });
    return { csrfToken, expiresAt: new Date(session.expiresAtMs).toISOString() };
  }

  destroy(token: string | undefined): void {
    if (token === undefined || token.length > 128) return;
    this.#sessions.delete(digestHex(token));
  }

  #read(token: string | undefined): StoredSession | undefined {
    if (token === undefined || token.length < 32 || token.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(token)) return undefined;
    const now = safeNow(this.#now());
    this.#prune(now);
    return this.#sessions.get(digestHex(token));
  }

  #prune(now: number): void {
    for (const [key, session] of this.#sessions) {
      if (session.expiresAtMs <= now) this.#sessions.delete(key);
    }
  }
}

function opaqueToken(value: string, field: string): string {
  if (value.length < 32 || value.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new TypeError(`${field} is invalid`);
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
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Session clock is invalid");
  return value;
}
