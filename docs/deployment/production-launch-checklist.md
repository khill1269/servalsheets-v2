---
title: Production Launch Checklist
category: guide
last_updated: 2026-03-17
description: Final pre-launch and post-launch checklist for ServalSheets production deployments.
version: 1.7.0
tags: [deployment, production, checklist, release]
---

# Production Launch Checklist

Use this checklist for the final go/no-go review before deploying ServalSheets to production.

This checklist assumes the repository is already in the current validated state:

- `25` tools and `403` actions synchronized
- `npm run test:all` passing
- `npm run security:audit` passing
- `npm run docs:audit` passing
- `npm run release:audit` passing
- if the release depends on live Google-backed features, live MCP smoke coverage validated with the manual `Release Audit` workflow and real credentials

Local-only desktop config files containing secrets are not an allowed release exception:

- `claude-desktop-config.json` must be ignored/untracked or reduced to safe example-only content before release

## 1. Release Candidate Lock

- [ ] Freeze the release commit and stop making unrelated changes.
- [ ] Confirm `git status` only contains intended release files.
- [ ] Confirm version, metadata, and generated files are synchronized.
- [ ] Tag the release candidate commit or note the exact SHA for rollback.

## 2. Required Validation

Run these commands from the repo root and keep the outputs with the release record:

```bash
npm run test:all
npm run security:audit
npm run docs:audit
npm run release:audit
```

Release only if all four are green.

If the release depends on real Google Sheets behavior, also run the manual `Release Audit` workflow with `include_live_tests=true` and keep its artifact output with the release record.

## 3. Secrets And Identity

- [ ] Production secrets are stored in a secrets manager, not in the repo or image.
- [ ] `ENCRYPTION_KEY` is set and matches the runtime token store strategy.
- [ ] OAuth credentials are configured for the production redirect URIs.
- [ ] `ALLOWED_REDIRECT_URIS` exactly matches the deployed callback URLs.
- [ ] Google credentials are present for the features you plan to enable.
- [ ] Any temporary local testing credentials are excluded from deployment artifacts.
- [ ] Deferred local-only config files such as `claude-desktop-config.json` are not part of the production deploy path.

## 4. Runtime Configuration

- [ ] `NODE_ENV=production`
- [ ] `HTTP_PORT` or ingress target port is correct.
- [ ] `HOST` and external base URL values match the deployment environment.
- [ ] `DEPLOYMENT_MODE` and `OAUTH_SCOPE_MODE` match the intended product surface.
- [ ] `LOG_LEVEL` and log format are production-appropriate.
- [ ] Rate limits are set to values that fit your Google quota.
- [ ] Session storage is configured intentionally.

For multi-instance or resumable HTTP deployments:

- [ ] `REDIS_URL` is configured and reachable.
- [ ] Streamable HTTP event retention settings are set intentionally.

## 5. Feature Surface Review

- [ ] Only the integrations you intend to support are enabled.
- [ ] BigQuery credentials and dataset access are configured if `sheets_bigquery` is enabled.
- [ ] Apps Script OAuth/service credentials are configured if `sheets_appsscript` is enabled.
- [ ] Webhook endpoints, signing, and callback reachability are validated if `sheets_webhook` is enabled.
- [ ] Federation targets are configured and reachable if `sheets_federation` is enabled.

## 6. Packaging And Deployment

- [ ] The release artifact is built from the validated commit.
- [ ] Docker/Helm/Kubernetes manifests point to the intended image tag.
- [ ] The runtime image contains the required workspace package artifacts.
- [ ] Health and readiness probes target `/health/live` and `/health/ready`.
- [ ] TLS termination and ingress rules are configured.
- [ ] Resource limits and autoscaling settings are set for expected load.

## 7. Observability

- [ ] Metrics scraping is enabled for `/metrics`.
- [ ] Logs are collected centrally.
- [ ] Alerts are configured for high error rate, latency, auth failures, quota pressure, and webhook backlog.
- [ ] Runbooks are available to the on-call owner:
  - [runbooks/auth-failures.md](/Users/thomascahill/Documents/servalsheets%202/docs/runbooks/auth-failures.md)
  - [runbooks/google-api-errors.md](/Users/thomascahill/Documents/servalsheets%202/docs/runbooks/google-api-errors.md)
  - [runbooks/high-error-rate.md](/Users/thomascahill/Documents/servalsheets%202/docs/runbooks/high-error-rate.md)
  - [runbooks/service-down.md](/Users/thomascahill/Documents/servalsheets%202/docs/runbooks/service-down.md)

## 8. Pre-Launch Smoke

- [ ] `tools/list` succeeds against the deployed endpoint.
- [ ] Health endpoint returns `200`.
- [ ] Readiness endpoint returns `200`.
- [ ] Authentication flow works with production redirect URIs.
- [ ] A representative read action succeeds.
- [ ] A representative write action succeeds against a disposable spreadsheet.
- [ ] If enabled, webhook registration and delivery succeed.
- [ ] If enabled, federation connectivity succeeds.

## 9. Go-Live Decision

Approve launch only if:

- [ ] All required validation is green.
- [ ] All production secrets and env vars are set correctly.
- [ ] Smoke tests pass against the deployed environment.
- [ ] Monitoring and alerting are live.
- [ ] Rollback owner and rollback command are documented.

## 10. Immediate Post-Launch

During the first 30 minutes after launch:

- [ ] Watch error rate, latency, and auth failures.
- [ ] Watch Google API quota and retry behavior.
- [ ] Confirm audit logging is flowing.
- [ ] Confirm webhook queue health if webhooks are enabled.
- [ ] Confirm Redis/session health if using shared sessions.
- [ ] Confirm no unexpected 4xx/5xx spike after real traffic begins.

## 11. Rollback Readiness

Before launch, document these values in the release ticket or runbook:

- [ ] Previous stable image tag
- [ ] Previous stable config version
- [ ] Rollback command or deployment action

Keep the incident response procedure with the release record:

- [docs/security/INCIDENT_RESPONSE_PLAN.md](/Users/thomascahill/Documents/servalsheets%202/docs/security/INCIDENT_RESPONSE_PLAN.md)
- [ ] Owner responsible for rollback approval
- [ ] Expected rollback verification steps

## Recommended Evidence To Attach

- `npm run test:all` summary
- `npm run security:audit` output
- `npm run docs:audit` output
- `npm run release:audit` output
- deployed image tag or bundle checksum
- smoke-test transcript for the production endpoint
