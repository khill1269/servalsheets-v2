# ServalSheets MCP Server - Test Results Log

**Test Date:** 2026-01-17  
**Test Spreadsheet:** `1GGSb44zvzRa6z7z7q6CrfGj94ALeZEbXb9AGA_wRkQA`

---

## ISSUE #1: Auth state not properly restored after logout

**Tool:** sheets_auth → sheets_core  
**Severity:** HIGH  
**Error:** `No access, refresh token, API key or refresh handler callback is set.`  
**Steps to reproduce:**

1. Call `sheets_auth` action `status` → returns authenticated=true
2. Call `sheets_auth` action `logout` → clears auth
3. Call `sheets_auth` action `status` → returns authenticated=true (service account re-auth)
4. Call `sheets_core` action `get` → FAILS with "No access token"

**Root Cause:** The `status` action detects service account credentials exist but doesn't actually initialize the auth client. The GoogleAuth client state is cleared by logout and not re-initialized.

**Files to investigate:**

- `/src/services/auth-service.ts` - logout and status methods
- `/src/handlers/auth.ts` - handler logic

---

## TEST PROGRESS

### sheets_auth (4 actions)

| Action   | Status      | Notes                                       |
| -------- | ----------- | ------------------------------------------- |
| status   | ✅ PASS     | Works correctly                             |
| login    | ⚠️ EXPECTED | OAuth not configured (service account only) |
| callback | ⏭️ SKIP     | Requires OAuth flow                         |
| logout   | ⚠️ BUG      | Breaks subsequent auth - see Issue #1       |

### sheets_core (15 actions)

| Action | Status     | Notes                               |
| ------ | ---------- | ----------------------------------- |
| get    | ❌ BLOCKED | Auth state broken after logout test |

---

_Testing paused - need to restart MCP server or work around auth issue_
