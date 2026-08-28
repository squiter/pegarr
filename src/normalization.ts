import type { ReleaseTraits } from "./domain.js";

export interface NormalizedRelease {
  readonly original: string;
  readonly canonical: string;
  readonly tokens: ReadonlySet<string>;
  readonly source?: string;
  readonly resolution?: string;
  readonly codec?: string;
  readonly releaseGroup?: string;
  readonly edition?: string;
  readonly frameRate?: number;
}

const aliases: readonly [RegExp, string][] = [
  [/\bmulti(?:[ ._-]?lang(?:uage)?)?\b/giu, "multilang"],
  [/\bdual[ ._-]?audio\b/giu, "multilang"],
  [/\bweb[ ._-]?dl\b/giu, "webdl"],
  [/\bweb[ ._-]?rip\b/giu, "webrip"],
  [/\bblu[ ._-]?ray\b|\bbd(?:rip|remux)\b/giu, "bluray"],
  [/\bh[ ._-]?264\b|\bx264\b|\bavc\b/giu, "h264"],
  [/\bh[ ._-]?265\b|\bx265\b|\bhevc\b/giu, "h265"],
];

export function normalizeRelease(title: string, explicitTraits: ReleaseTraits = {}): NormalizedRelease {
  const normalizedAliases = aliases.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    canonicalReleaseSyntax(
      title.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase(),
    ),
  );
  const tokens = normalizedAliases.split(/[^a-z0-9]+/u).filter(Boolean);
  const tokenSet = new Set(tokens);
  const inferredGroup = inferReleaseGroup(title);
  const source = normalizeTrait(explicitTraits.source) ?? firstToken(tokenSet, ["webdl", "webrip", "bluray", "hdtv"]);
  const resolution =
    normalizeTrait(explicitTraits.resolution) ?? firstToken(tokenSet, ["2160p", "1080p", "720p", "480p"]);
  const codec = normalizeTrait(explicitTraits.codec) ?? firstToken(tokenSet, ["h265", "h264", "av1"]);
  const releaseGroup = normalizeTrait(explicitTraits.releaseGroup ?? inferredGroup);
  const edition = normalizeTrait(explicitTraits.edition ?? inferEdition(title));
  const frameRate = explicitTraits.frameRate ?? inferFrameRate(title);

  return {
    original: title,
    canonical: tokens.join("."),
    tokens: tokenSet,
    ...(source === undefined ? {} : { source }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(codec === undefined ? {} : { codec }),
    ...(releaseGroup === undefined ? {} : { releaseGroup }),
    ...(edition === undefined ? {} : { edition }),
    ...(frameRate === undefined ? {} : { frameRate }),
  };
}

export function normalizeLanguage(code: string): string {
  const normalized = code.trim().toLowerCase().replace("_", "-");
  return normalized === "pb" ? "pt-br" : normalized;
}

function inferReleaseGroup(title: string): string | undefined {
  const withoutExtension = title.replace(/\.(?:mkv|mp4|avi|srt|ass|ssa|sub)$/iu, "");
  return withoutExtension.match(/-([a-z0-9]+)$/iu)?.[1]
    ?? withoutExtension.match(/^\[([a-z][a-z0-9._-]{1,63})\]/iu)?.[1];
}

function canonicalReleaseSyntax(value: string): string {
  return canonicalEpisodeNotation(value)
    .replace(/\[[a-f0-9]{8}\]/giu, " ")
    .replace(/(\s+-\s+)0+(\d{1,4})(?=\s*(?:[[(]|$))/giu, "$1$2");
}

function canonicalEpisodeNotation(value: string): string {
  return value
    .replace(/\bseason[ ._-]*(\d{1,3})\b/giu, (_match, season: string) => seasonToken(season))
    .replace(
      /\bs(\d{1,3})e(\d{1,4})[ ._-]+e?(\d{1,4})\b/giu,
      (_match, season: string, from: string, to: string) => `${episodeToken(season, from)}e${padded(to)}`,
    )
    .replace(
      /\b(\d{1,3})x(\d{1,4})[ ._-]+(?:\1x)?(\d{1,4})\b/giu,
      (_match, season: string, from: string, to: string) => `${episodeToken(season, from)}e${padded(to)}`,
    )
    .replace(
      /\bs(\d{1,3})e(\d{1,4})\b/giu,
      (_match, season: string, episode: string) => episodeToken(season, episode),
    )
    .replace(
      /\b(\d{1,3})x(\d{1,4})\b/giu,
      (_match, season: string, episode: string) => episodeToken(season, episode),
    )
    .replace(/\bs(\d{1,3})\b/giu, (_match, season: string) => seasonToken(season));
}

function episodeToken(season: string, episode: string): string {
  return `${seasonToken(season)}e${padded(episode)}`;
}

function seasonToken(season: string): string {
  return `s${padded(season)}`;
}

function padded(value: string): string {
  return String(Number(value)).padStart(2, "0");
}

function inferEdition(title: string): string | undefined {
  const normalized = title.toLowerCase();
  if (/\bdirector['’]?s[ ._-]+cut\b/u.test(normalized)) return "directorscut";
  if (/\bextended(?:[ ._-]+(?:cut|edition|version))?\b/u.test(normalized)) return "extended";
  if (/\btheatrical(?:[ ._-]+cut)?\b/u.test(normalized)) return "theatrical";
  if (/\bremaster(?:ed)?\b/u.test(normalized)) return "remastered";
  if (/\buncut\b/u.test(normalized)) return "uncut";
  return undefined;
}

function inferFrameRate(title: string): number | undefined {
  const value = title.match(/\b(23\.976|24(?:\.0+)?|25(?:\.0+)?|29\.97|30(?:\.0+)?|50(?:\.0+)?|59\.94|60(?:\.0+)?)\s*fps\b/iu)?.[1];
  return value === undefined ? undefined : Number(value);
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
