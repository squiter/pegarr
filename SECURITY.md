# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/squiter/pegarr/security/advisories/new). Do not open an issue containing a vulnerability, credential, private service address, or media-library detail.

Include the affected revision, reproduction steps, likely impact, and any suggested mitigation. Please do not test against systems or accounts you do not own or have permission to use.

## Security boundary

Pegarr is designed to keep Sonarr, Radarr, Bazarr, and subtitle-provider credentials on the server. Credentials must not be exposed to the browser, written to URLs, included in diagnostics, or committed in configuration and fixtures.

Live library routes require a separate Pegarr access token loaded from a secret file. Treat it as a credential: send it only in the `Authorization` header over HTTPS or a trusted private network, and never place it in browser storage, URLs, logs, issue attachments, or `.env` values.

The application is read-only by default. The future Grab operation will require authenticated authorization, exact-release confirmation, revalidation, and an audit record.
