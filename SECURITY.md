# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |

## Reporting a Vulnerability

Please **do not** open a public issue for security problems.

Instead, use GitHub's private vulnerability reporting
(**Security → Report a vulnerability**) on this repository. You should receive
an acknowledgement within 72 hours.

## Scope Notes

InsightOS is an analytics library plus a demonstration frontend.

- The published GitHub Pages site is **fully static**. It performs no network
  calls other than fetching its own pre-computed JSON, stores no cookies and
  collects no telemetry.
- The optional FastAPI service (`apps/api`) accepts file uploads. It is intended
  for local or trusted-network use. If you expose it publicly, put it behind
  authentication and a request-size limit; the container already runs as a
  non-root user.
- The analytics engine never executes code contained in an uploaded dataset and
  never calls `eval` on user input.
