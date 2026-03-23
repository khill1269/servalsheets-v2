---
title: Privacy Policy
description: ServalSheets privacy policy for local and remote deployments.
---

# Privacy Policy

Last updated: 2026-01-25

ServalSheets is an MCP server that enables AI assistants to interact with Google Sheets on behalf of users. This page summarizes what data ServalSheets handles, how it is used, and what controls users have.

## Data Handling

ServalSheets may temporarily handle:

- OAuth access and refresh tokens
- spreadsheet values, formulas, formatting, and metadata needed for requested operations
- recent operation history and error logs used for debugging and recovery

ServalSheets is designed so spreadsheet data is accessed only when a user explicitly requests an operation. Spreadsheet content is not used for advertising or model training.

## Storage

- OAuth tokens are encrypted at rest when token persistence is enabled.
- STDIO deployments store token material locally on the user device.
- HTTP deployments may store session and token data in configured server-side stores.
- Spreadsheet data is generally processed pass-through and is not retained as a permanent application dataset.

## Third Parties

ServalSheets interacts with Google APIs to fulfill spreadsheet operations. Optional integrations may connect to additional third-party services only when those integrations are explicitly configured and used.

## User Controls

Users can:

- revoke OAuth access
- clear operation history
- remove local token stores
- review configured integrations and credentials

## Security

ServalSheets supports:

- OAuth 2.1 with PKCE
- encrypted token storage
- configurable session lifetimes
- audit logging and operational controls

## Contact

- Support: https://github.com/khill1269/servalsheets/issues
- Source: https://github.com/khill1269/servalsheets

For the full repository privacy text used by the project, see the root [PRIVACY.md](https://github.com/khill1269/servalsheets/blob/main/PRIVACY.md).
