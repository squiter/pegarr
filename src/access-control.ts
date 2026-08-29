import { createHash, timingSafeEqual } from "node:crypto";

import type { LoginRuntimeConfiguration, SecretValue } from "./config.js";

export class AccessControl {
  readonly #expectedDigest: Buffer | undefined;
  readonly #expectedUsernameDigest: Buffer | undefined;
  readonly #expectedPasswordDigest: Buffer | undefined;

  constructor(token: SecretValue | undefined, login?: LoginRuntimeConfiguration) {
    this.#expectedDigest = token === undefined ? undefined : digest(token.reveal());
    this.#expectedUsernameDigest = login === undefined ? undefined : digest(login.username);
    this.#expectedPasswordDigest = login === undefined ? undefined : digest(login.password.reveal());
  }

  get configured(): boolean {
    return this.#expectedDigest !== undefined || this.#expectedUsernameDigest !== undefined;
  }

  get challenge(): string {
    return this.#expectedUsernameDigest === undefined
      ? 'Bearer realm="pegarr", charset="UTF-8"'
      : 'Basic realm="pegarr", charset="UTF-8"';
  }

  authorize(authorization: string | undefined): boolean {
    if (authorization === undefined || authorization.length > 8_200) return false;
    if (authorization.slice(0, 7).toLowerCase() === "bearer ") {
      if (this.#expectedDigest === undefined || authorization.length > 4_103) return false;
      const candidate = authorization.slice(7);
      return candidate.length >= 32 && timingSafeEqual(this.#expectedDigest, digest(candidate));
    }
    return this.authorizeLogin(authorization);
  }

  authorizeLogin(authorization: string | undefined): boolean {
    if (
      authorization === undefined ||
      authorization.length > 8_200 ||
      authorization.slice(0, 6).toLowerCase() !== "basic " ||
      this.#expectedUsernameDigest === undefined ||
      this.#expectedPasswordDigest === undefined
    ) return false;
    const encoded = authorization.slice(6);
    if (!/^[a-z0-9+/]+={0,2}$/iu.test(encoded)) return false;
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 1) return false;
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return password.length >= 32 &&
      timingSafeEqual(this.#expectedUsernameDigest, digest(username)) &&
      timingSafeEqual(this.#expectedPasswordDigest, digest(password));
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
