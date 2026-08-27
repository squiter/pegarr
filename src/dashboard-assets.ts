import { readFile } from "node:fs/promises";

const assets = {
  "dashboard.css": { contentType: "text/css; charset=utf-8" },
  "dashboard.js": { contentType: "text/javascript; charset=utf-8" },
  "dashboard-model.js": { contentType: "text/javascript; charset=utf-8" },
} as const;

export type DashboardAssetName = keyof typeof assets;

const contents = new Map<DashboardAssetName, Promise<string>>();

export function dashboardAsset(
  name: DashboardAssetName,
): Promise<{ readonly contentType: string; readonly body: string }> {
  let content = contents.get(name);
  if (content === undefined) {
    content = readFile(new URL(`./web/${name}`, import.meta.url), "utf8");
    contents.set(name, content);
  }
  return content.then((body) => ({ contentType: assets[name].contentType, body }));
}
