import { readFileSync } from "node:fs";

export interface BuildInfo {
  readonly service: "pegarr";
  readonly version: string;
  readonly revision?: string;
}

interface PackageMetadata {
  readonly version?: unknown;
}

const packageMetadataUrl = new URL("../package.json", import.meta.url);

export function parseBuildInfo(packageContents: string, revision: string | undefined): BuildInfo {
  const metadata = JSON.parse(packageContents) as PackageMetadata;
  if (typeof metadata.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(metadata.version)) {
    throw new TypeError("package version must be a semantic version");
  }

  const normalizedRevision = revision?.trim().toLowerCase();
  return {
    service: "pegarr",
    version: metadata.version,
    ...(normalizedRevision !== undefined && /^[0-9a-f]{7,64}$/u.test(normalizedRevision)
      ? { revision: normalizedRevision }
      : {}),
  };
}

export const currentBuildInfo = parseBuildInfo(
  readFileSync(packageMetadataUrl, "utf8"),
  process.env.PEGARR_REVISION,
);
