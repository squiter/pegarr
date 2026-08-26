import type { ReleaseTraits } from "./domain.js";

export interface NormalizedRelease {
  readonly original: string;
  readonly canonical: string;
  readonly tokens: ReadonlySet<string>;
  readonly source?: string;
  readonly resolution?: string;
  readonly codec?: string;
  readonly releaseGroup?: string;
}

const aliases: readonly [RegExp, string][] = [
  [/\bweb[ ._-]?dl\b/giu, "webdl"],
  [/\bweb[ ._-]?rip\b/giu, "webrip"],
  [/\bblu[ ._-]?ray\b|\bbd(?:rip|remux)\b/giu, "bluray"],
  [/\bh[ ._-]?264\b|\bx264\b|\bavc\b/giu, "h264"],
  [/\bh[ ._-]?265\b|\bx265\b|\bhevc\b/giu, "h265"],
];

export function normalizeRelease(title: string, explicitTraits: ReleaseTraits = {}): NormalizedRelease {
  const normalizedAliases = aliases.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    title.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase(),
  );
  const tokens = normalizedAliases.split(/[^a-z0-9]+/u).filter(Boolean);
  const tokenSet = new Set(tokens);
  const inferredGroup = inferReleaseGroup(title);
  const source = normalizeTrait(explicitTraits.source) ?? firstToken(tokenSet, ["webdl", "webrip", "bluray", "hdtv"]);
  const resolution =
    normalizeTrait(explicitTraits.resolution) ?? firstToken(tokenSet, ["2160p", "1080p", "720p", "480p"]);
  const codec = normalizeTrait(explicitTraits.codec) ?? firstToken(tokenSet, ["h265", "h264", "av1"]);
  const releaseGroup = normalizeTrait(explicitTraits.releaseGroup ?? inferredGroup);

  return {
    original: title,
    canonical: tokens.join("."),
    tokens: tokenSet,
    ...(source === undefined ? {} : { source }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(codec === undefined ? {} : { codec }),
    ...(releaseGroup === undefined ? {} : { releaseGroup }),
  };
}

export function normalizeLanguage(code: string): string {
  const normalized = code.trim().toLowerCase().replace("_", "-");
  return normalized === "pb" ? "pt-br" : normalized;
}

function inferReleaseGroup(title: string): string | undefined {
  const withoutExtension = title.replace(/\.(?:mkv|mp4|avi|srt|ass|ssa|sub)$/iu, "");
  return withoutExtension.match(/-([a-z0-9]+)$/iu)?.[1];
}

function normalizeTrait(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = aliases
    .reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value.toLowerCase())
    .replace(/[^a-z0-9]+/gu, "");
  return normalized || undefined;
}

function firstToken(tokens: ReadonlySet<string>, candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => tokens.has(candidate));
}
