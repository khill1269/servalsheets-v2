---
title: Submission Checklist
category: guide
last_updated: 2026-02-03
description: Checklist for preparing a ServalSheets Remote MCP Server submission.
version: 1.6.0
tags: [mcp, submission, claude]
audience: developer
difficulty: intermediate
---

# Submission Checklist

Use this checklist to validate ServalSheets before submitting to the Claude/Anthropic Remote MCP Server directory.

## 1. Core Protocol and Transport

- [ ] Streamable HTTP endpoint available at `/mcp`
- [ ] MCP protocol version header set to `2025-11-25`
- [ ] `/.well-known/mcp.json` returns server card
- [ ] `/.well-known/mcp-configuration` returns server capabilities
- [ ] `/.well-known/oauth-authorization-server` returns OAuth metadata
- [ ] `/.well-known/oauth-protected-resource` returns protected resource metadata
- [ ] STDIO transport works for local testing

## 2. OAuth and Auth Security

- [ ] OAuth 2.1 with PKCE enforced (S256 only)
- [ ] Allowed redirect URIs include Claude endpoints and localhost
- [ ] `ENCRYPTION_KEY` configured for production
- [ ] Production uses Redis session store or explicitly documents `ALLOW_MEMORY_SESSIONS=true`
- [ ] Token storage uses encrypted file or OS keychain

## 3. Tool Safety and Annotations

- [ ] All tools have `readOnlyHint` and `destructiveHint`
- [ ] Tool names are <= 64 characters
- [ ] Tool descriptions match actual behavior

## 4. Privacy, Support, and Policy

- [ ] Privacy policy is published and accessible over HTTPS
- [ ] Support channel is available (GitHub issues or email)
- [ ] Security policy is published

## 5. Production Deployment Requirements

- [ ] HTTPS enabled with valid certificate
- [ ] CORS origins include `https://claude.ai` and `https://claude.com`
- [ ] Rate limits enabled (global and per-user if Redis is available)
- [ ] Health endpoints (`/health`, `/health/ready`, `/health/live`) return 200
- [ ] Metrics endpoint (`/metrics`) returns Prometheus format

## 6. Test Account and Demo Data

- [ ] Test account created with sample spreadsheets
- [ ] Test credentials stored securely
- [ ] Test account setup documented in `docs/guides/TEST_ACCOUNT_SETUP.md`

## 7. Metadata Consistency

- [ ] `package.json` version matches `server.json`
- [ ] `manifest.json` version and description match `server.json`
- [ ] README tool count and action count match `server.json`

## 8. Submission Form Data (Prepare in Advance)

- [ ] Public base URL for the server
- [ ] Public privacy policy URL
- [ ] Contact email or support URL
- [ ] Repository URL
- [ ] Short product description
- [ ] Test account credentials and instructions (shared securely)

## 9. Pre-Submission Smoke Tests

Run these before submitting:

```bash
npm run build
npm run validate:server-json
npm run test:compliance
npm run smoke
```

Optional HTTP checks:

```bash
curl -s https://YOUR_HOST/.well-known/mcp.json | jq '.'
curl -s https://YOUR_HOST/info | jq '.'
curl -s https://YOUR_HOST/health/ready | jq '.'
```
