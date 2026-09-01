# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/squiter/pegarr/security/advisories/new). Do not open an issue containing a vulnerability, credential, private service address, or media-library detail.

Include the affected revision, reproduction steps, likely impact, and any suggested mitigation. Please do not test against systems or accounts you do not own or have permission to use.

## Security boundary

Pegarr is designed to keep Sonarr, Radarr, Bazarr, and subtitle-provider credentials on the server. Credentials must not be exposed to the browser, written to URLs, included in diagnostics, or committed in configuration and fixtures.

The browser UI uses a username/password login backed by a bounded server-side session in an `HttpOnly`, `SameSite=Strict` cookie. The password stays in a server-side secret file and is never returned to or stored by the browser. Legacy API clients may use the separate bearer access token; treat it as a credential, send it only in the `Authorization` header over HTTPS or a trusted private network, and never place it in browser storage, URLs, logs, issue attachments, or `.env` values.

The application is read-only by default. Catalog add is a separate opt-in and always disables Sonarr/Radarr automatic search. Controlled Grab is an independent opt-in protected by an administrator secret, exact-release confirmation, two revalidations, idempotency and duplicate protection, and a durable audit record. Pegarr never performs either mutation automatically.
