import { createHash, timingSafeEqual } from "node:crypto";

import type { SecretValue } from "./config.js";

export class AccessControl {
  readonly #expectedDigest: Buffer | undefined;

  constructor(token: SecretValue | undefined) {
    this.#expectedDigest = token === undefined ? undefined : digest(token.reveal());
  }

  get configured(): boolean {
    return this.#expectedDigest !== undefined;
  }

  authorize(authorization: string | undefined): boolean {
    if (this.#expectedDigest === undefined || authorization === undefined) return false;
    if (authorization.length > 4_103 || authorization.slice(0, 7).toLowerCase() !== "bearer ") {
      return false;
    }
    const candidate = authorization.slice(7);
    if (candidate.length < 32) return false;
    return timingSafeEqual(this.#expectedDigest, digest(candidate));
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
