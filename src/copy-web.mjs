import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const destination = resolve("dist/web");
mkdirSync(destination, { recursive: true });
for (const file of ["dashboard.css", "dashboard.js", "dashboard-model.js"]) {
  cpSync(resolve("src/web", file), resolve(destination, file));
}
