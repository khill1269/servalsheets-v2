# ServalSheets Privacy Policy

**Last Updated:** January 25, 2026  
**Version:** 1.0

## Overview

ServalSheets is an MCP (Model Context Protocol) server that enables AI assistants to interact with Google Sheets on behalf of users. This privacy policy explains what data ServalSheets collects, how it's used, and your rights regarding your data.

## Data We Collect

### 1. Authentication Credentials

When you authenticate with ServalSheets, we temporarily store:

- **OAuth Access Tokens**: Used to make Google Sheets API calls on your behalf
- **OAuth Refresh Tokens**: Used to obtain new access tokens when they expire

**Storage:**

- Tokens are encrypted using AES-256-GCM encryption
- Stored locally on your device (STDIO mode) or in secure session storage (HTTP mode)
- Never transmitted to third parties

### 2. Spreadsheet Data

ServalSheets accesses spreadsheet data only when:

- You explicitly request operations on a spreadsheet
- The AI assistant needs to read/write data you've requested

**What we access:**

- Cell values, formulas, and formatting
- Sheet metadata (names, IDs, properties)
- Chart and pivot table configurations

**What we DON'T collect:**

- We don't store copies of your spreadsheet data
- We don't transmit your data to external servers (except Google's APIs)
- We don't use your data for training or analytics

### 3. Operation Logs

For debugging and error recovery, we may temporarily store:

- Recent operation history (last 100 operations per session)
- Error messages and stack traces

**Retention:** Operation logs are cleared when:

- The session ends
- You explicitly clear history via `sheets_history` action
- The server restarts

## How We Use Your Data

### Providing Service

- Making Google Sheets API calls you request
- Caching metadata to improve performance
- Validating operations before execution

### We Do NOT

- Sell or share your data with third parties
- Use your data for advertising
- Train AI models on your spreadsheet content
- Access spreadsheets you haven't explicitly requested

## Data Security

### Encryption

- All tokens are encrypted at rest using AES-256-GCM
- All network communication uses HTTPS/TLS
- OAuth 2.1 with PKCE for secure authentication

### Access Control

- Only authenticated sessions can access your data
- Session tokens expire after configurable periods (default: 1 hour)
- Refresh tokens expire after 30 days

### Best Practices

We recommend:

- Rotating encryption keys annually
- Using service accounts for automated workflows
- Regularly reviewing OAuth permissions

## Your Rights

### Access

You can view what data ServalSheets has access to via the `sheets_auth` status action.

### Deletion

- Clear operation history: `sheets_history` action with `clear`
- Revoke OAuth access: `sheets_auth` action with `logout`
- Remove all tokens: Delete the token store file

### Portability

ServalSheets stores minimal data. Your spreadsheet data remains in Google Sheets and can be exported via Google's tools.

## Third-Party Services

ServalSheets interacts with:

### Google Sheets API

- Subject to [Google's Privacy Policy](https://policies.google.com/privacy)
- Required for core functionality
- We use minimal scopes necessary for requested operations

### No Other Third Parties

ServalSheets does not share data with any other third-party services.

## Data Retention

| Data Type         | Retention Period                  |
| ----------------- | --------------------------------- |
| Access Tokens     | 1 hour (configurable)             |
| Refresh Tokens    | 30 days (configurable)            |
| Operation History | Session-only (cleared on restart) |
| Spreadsheet Data  | Not stored (pass-through only)    |

## Children's Privacy

ServalSheets is not intended for use by children under 13. We do not knowingly collect data from children.

## Changes to This Policy

We may update this privacy policy occasionally. Changes will be documented in the CHANGELOG.md file with the version number.

## Contact

For privacy concerns or questions:

- **GitHub Issues:** https://github.com/khill1269/servalsheets/issues
- **Security Issues:** See SECURITY.md for responsible disclosure

## Compliance

ServalSheets is designed to comply with:

- **GDPR:** Data minimization, user rights, encryption
- **CCPA:** Transparency about data collection and use
- **Anthropic's Software Directory Policy:** Privacy-first design

---

## Summary

| Question                                 | Answer                           |
| ---------------------------------------- | -------------------------------- |
| Do you store my spreadsheet data?        | No                               |
| Do you share my data with third parties? | No                               |
| How long are tokens stored?              | Until logout or expiration       |
| Can I delete my data?                    | Yes, via logout or file deletion |
| Is my data encrypted?                    | Yes, AES-256-GCM                 |

---

_This privacy policy is effective as of January 25, 2026._
