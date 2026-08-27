import { createServer } from "node:http";

import { AccessControl } from "./access-control.js";
import { JsonTransportError } from "./adapters/http.js";
import { createRequestHandler } from "./app.js";
import { ConfigurationError, loadRuntimeConfiguration } from "./config.js";
import { createRuntimeServices } from "./runtime.js";

const port = parsePort(process.env.PORT);
const host = process.env.HOST ?? "0.0.0.0";
const dataDirectory = process.env.DATA_DIR ?? "./data";

async function start(): Promise<void> {
  const configuration = await loadRuntimeConfiguration(process.env);
  const services = createRuntimeServices(configuration);
  const accessControl = new AccessControl(configuration.accessToken);
  const server = createServer(createRequestHandler(dataDirectory, services, accessControl));

  server.listen(port, host, () => {
    process.stdout.write(`${JSON.stringify({ event: "server_started", service: "pegarr", port })}\n`);
  });

  function shutdown(signal: string): void {
    process.stdout.write(`${JSON.stringify({ event: "shutdown_started", service: "pegarr", signal })}\n`);
    server.close((error) => {
      if (error) {
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
