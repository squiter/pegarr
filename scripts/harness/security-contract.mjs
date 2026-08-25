import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { failContract, lineNumber, repoRoot, repositoryFiles } from "./lib.mjs";

const issues = [];
const files = repositoryFiles();
const secretMarkers = [
  "gh" + "p_",
  "github_" + "pat_",
  "-----BEGIN " + "PRIVATE KEY-----",
  "-----BEGIN RSA " + "PRIVATE KEY-----",
];

for (const file of files) {
  if ((file === ".env" || file.startsWith(".env.")) && file !== ".env.example") {
    issues.push(`${file} must not be tracked`);
  }

  const content = readFileSync(resolve(repoRoot, file), "utf8");
  for (const marker of secretMarkers) {
    const index = content.indexOf(marker);
    if (index >= 0) {
      issues.push(`${file}:${lineNumber(content, index)} contains a credential marker`);
    }
  }

  const keyInUrl = content.match(/[?&](?:api[_-]?key|apikey)=[A-Za-z0-9_-]{8,}/iu);
  if (keyInUrl?.index !== undefined) {
    issues.push(`${file}:${lineNumber(content, keyInUrl.index)} puts an API key in a URL`);
  }

  if (file.startsWith("src/") && /\b(?:localStorage|sessionStorage)\b/u.test(content)) {
    issues.push(`${file} may not use browser storage for service credentials or state`);
  }

  if (
    /(?:compose[^/]*\.ya?ml|\.env\.example)$/u.test(file) &&
    /PEGARR_(?:SONARR|RADARR|BAZARR|SUBDL)_API_KEY\s*[:=]/u.test(content)
  ) {
    issues.push(`${file} may not pass an integration API key as an environment value`);
  }

  if (file.includes("fixtures/") || file.includes("fixture")) {
    if (/\b(?:10\.|127\.0\.0\.1|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(content)) {
      issues.push(`${file} contains a private or loopback address`);
    }
    if (!/synthetic/iu.test(content)) {
      issues.push(`${file} must label fixture evidence as synthetic`);
    }
  }
}

failContract("PEG-SECRETS", issues);
