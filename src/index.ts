import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { AccessControl } from "./access-control.js";
import { JsonTransportError } from "./adapters/http.js";
import { createRequestHandler } from "./app.js";
import { currentBuildInfo } from "./build-info.js";
import { ConfigurationError, loadRuntimeConfiguration } from "./config.js";
import { createRuntimeServices } from "./runtime.js";
import { SessionStore } from "./session-store.js";

const port = parsePort(process.env.PORT);
const host = process.env.HOST ?? "0.0.0.0";
const dataDirectory = resolve(process.env.DATA_DIR ?? "./data");

async function start(): Promise<void> {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const configuration = await loadRuntimeConfiguration(process.env);
  const services = createRuntimeServices(configuration, { environment: process.env, dataDirectory });
  const accessControl = new AccessControl(configuration.accessToken, configuration.login);
  const adminAccessControl = new AccessControl(configuration.controlledGrab?.adminToken);
  const sessionStore = configuration.login === undefined
    ? undefined
    : new SessionStore({ databasePath: resolve(dataDirectory, "sessions.sqlite") });
  const server = createServer(createRequestHandler(dataDirectory, services, accessControl, {
    adminAccessControl,
    ...(sessionStore === undefined ? {} : { sessionStore }),
    secureSessionCookie: configuration.sessionCookieSecure === true,
    log: (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
  }));

  server.listen(port, host, () => {
    process.stdout.write(`${JSON.stringify({ event: "server_started", ...currentBuildInfo, port })}\n`);
  });

  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`${JSON.stringify({ event: "shutdown_started", service: "pegarr", signal })}\n`);
    server.close((error) => {
      let failed = error !== undefined;
      try {
        services.close();
      } catch {
        failed = true;
      }
      try {
        sessionStore?.close();
      } catch {
        failed = true;
      }
      if (failed) {
        process.stderr.write(`${JSON.stringify({ event: "shutdown_failed", service: "pegarr" })}\n`);
        process.exitCode = 1;
      }
    });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((error: unknown) => {
  const detail =
    error instanceof ConfigurationError || error instanceof JsonTransportError
      ? error.message
      : "Unexpected startup failure";
  process.stderr.write(
    `${JSON.stringify({
      event: "startup_failed",
      service: "pegarr",
      reason: "invalid_configuration",
      detail,
    })}\n`,
  );
  process.exitCode = 1;
});

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? "8080");

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return parsed;
}
