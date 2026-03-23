---
title: Webhook Integration Guide
category: guide
last_updated: 2026-01-31
description: 'Tool: sheetswebhook'
version: 1.6.0
tags: [sheets]
audience: user
difficulty: intermediate
---

# Webhook Integration Guide

**Tool**: `sheets_webhook`
**Purpose**: Receive real-time notifications when spreadsheets change
**Version**: 1.6.0
**Last Updated**: 2026-01-30

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Actions](#actions)
4. [Common Workflows](#common-workflows)
5. [Best Practices](#best-practices)
6. [Troubleshooting](#troubleshooting)

---

## Overview

The `sheets_webhook` tool enables real-time push notifications when Google Sheets are modified. Instead of polling for changes, your application receives HTTP POST requests immediately when events occur.

### What Are Webhooks?

**Webhooks** are HTTP callbacks that send event data to your application when specific events occur. This "push" model is more efficient than repeatedly polling for changes.

### Key Capabilities

- **Event Subscription**: Subscribe to specific change types (cell updates, sheet creation, formatting, etc.)
- **Secure Delivery**: HMAC signatures verify payload authenticity
- **Automatic Retry**: Failed deliveries retry with exponential backoff
- **Delivery Tracking**: Monitor success rates and troubleshoot failures
- **Test Mode**: Send test payloads to verify endpoint configuration

### How It Works

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│ Google Sheets│  ────►  │ ServalSheets │  ────►  │ Your App     │
│ (Change)     │  Watch  │ Webhook      │  POST   │ (Webhook URL)│
└──────────────┘         └──────────────┘         └──────────────┘
```

1. **Register webhook** with spreadsheet ID and event types
2. **Google Sheets Watch API** monitors spreadsheet
3. **ServalSheets receives** notifications from Google
4. **Your endpoint receives** HTTP POST with event payload
5. **Signature verification** ensures authenticity

### Tool Annotations

| Property        | Value | Meaning                                            |
| --------------- | ----- | -------------------------------------------------- |
| readOnlyHint    | false | Creates webhook registrations                      |
| destructiveHint | false | Unregistering is safe (doesn't affect spreadsheet) |
| idempotentHint  | false | Registration creates new webhooks                  |
| openWorldHint   | true  | Calls Google Watch API, sends HTTP requests        |

### Drive API Integration

**Important:** ServalSheets uses the **Google Drive API v3 Push Notifications** feature for webhook subscriptions, not a Sheets-specific API. Here's why:

- **Sheets API v4 has NO native event/webhook capabilities**
- **Drive API** provides file-level change notifications via the `watch()` endpoint
- When a spreadsheet changes, Drive sends notifications to ServalSheets
- ServalSheets processes these notifications and delivers structured events to your webhook URL

**What This Means:**

- ✅ You get notifications when spreadsheet content changes
- ⚠️ Notifications are file-level (not cell-specific without additional processing)
- ⚠️ Minimum notification interval: ~3 minutes (Drive API rate limit)
- ⚠️ Channel expiration: Maximum 1 day for files
- ⚠️ Requires `drive` or `drive.file` OAuth scope

**API Flow:**

```
Register Webhook
  → ServalSheets calls Drive API files.watch()
    → Google creates notification channel
      → Returns channelId + resourceId
        → ServalSheets stores mapping (webhook ↔ channel)

Spreadsheet Changes
  → Google Drive detects change
    → Sends POST to ServalSheets /webhook/drive-callback
      → Headers: X-Goog-Channel-ID, X-Goog-Resource-State, etc.
        → ServalSheets enqueues event for webhook delivery
          → Worker delivers to your webhook URL with HMAC signature
```

**Channel Lifecycle:**

- **Registration**: Creates a watch channel with expiration (max 1 day)
- **Renewal**: Automatic renewal 2 hours before expiration
- **Unregistration**: Calls Drive API `channels.stop()` to clean up

**X-Goog Headers from Drive API:**

```
X-Goog-Channel-ID: <channel UUID>
X-Goog-Resource-State: update | trash | remove | sync
X-Goog-Resource-ID: <resource identifier from watch response>
X-Goog-Channel-Token: <webhook ID for correlation>
X-Goog-Message-Number: <sequential counter>
```

**Resource States:**

- `sync` - Initial sync notification (acknowledge only, no event)
- `update` - File modified → mapped to `sheet.update` event
- `trash` - File trashed → mapped to `sheet.delete` event
- `remove` - Watch stopped → no event delivered

**See Also:**

- [Google Drive API Push Notifications](https://developers.google.com/workspace/drive/api/guides/push)
- [Drive API files.watch() Reference](https://developers.google.com/drive/api/v3/reference/files/watch)
- [Drive API channels.stop() Reference](https://developers.google.com/drive/api/v3/reference/channels/stop)

---

## Prerequisites

### 1. HTTPS Endpoint Required

⚠️ **Webhooks ONLY work with HTTPS URLs** (not HTTP)

**Your webhook endpoint must:**

- Be publicly accessible (not localhost)
- Use valid TLS/SSL certificate
- Return 2xx status codes promptly (< 30 seconds)
- Handle idempotent requests (may receive duplicates)

**Development Options:**

- **ngrok**: Tunnel localhost to public HTTPS (`ngrok http 3000`)
- **Cloudflare Tunnel**: `cloudflared tunnel`
- **LocalTunnel**: `lt --port 3000`

### 2. Webhook Endpoint Implementation

Your endpoint must:

**A. Accept POST Requests:**

```javascript
app.post('/webhooks/sheets', async (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = req.body;

  // Verify signature (see below)
  // Process event

  res.status(200).json({ received: true });
});
```

**B. Verify HMAC Signature (if secret provided):**

```javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  const computed = hmac.digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
}
```

**C. Handle Event Types:**

```javascript
function handleEvent(event) {
  switch (event.eventType) {
    case 'cell.update':
      console.log('Cells updated:', event.spreadsheetId);
      break;
    case 'sheet.create':
      console.log('New sheet created:', event.sheetName);
      break;
    // ... handle other event types
  }
}
```

### 3. Channel Expiration and Renewal

**Drive API Channels** have strict expiration limits:

- **Maximum expiration**: 1 day (86400000 ms) for file-level watch
- **Automatic renewal**: ServalSheets renews channels 2 hours before expiration
- **Background task**: Runs every hour to check and renew expiring channels
- **Clean shutdown**: Channels are stopped when webhook is unregistered

**Production Deployment Requirements:**

- Set `WEBHOOK_ENDPOINT` environment variable to your public HTTPS callback URL
  - Example: `WEBHOOK_ENDPOINT=https://servalsheets.example.com/webhook/drive-callback`
- Ensure ServalSheets receives POST requests from Google at this endpoint
- Configure `REDIS_URL` for persistent webhook storage
- Worker process must be running (`npm start` handles this automatically)

**Channel Lifecycle:**

```
Register → Create Drive channel (24h expiration)
           ↓
         Renew every 22h (automatic background task)
           ↓
         Unregister → Stop Drive channel (cleanup)
```

**Note:** If ServalSheets restarts, channels persist in Redis and renewal continues automatically.

---

## Actions

### `register` - Register Webhook

**Subscribe to spreadsheet change notifications.**

**Parameters:**

| Name          | Type    | Required | Description                                                     |
| ------------- | ------- | -------- | --------------------------------------------------------------- |
| action        | literal | ✅       | `"register"`                                                    |
| spreadsheetId | string  | ✅       | Spreadsheet ID to monitor                                       |
| webhookUrl    | string  | ✅       | HTTPS URL for receiving events                                  |
| eventTypes    | array   | ✅       | Event types to subscribe to (min 1)                             |
| secret        | string  | ❌       | Secret for HMAC signature (min 16 chars, recommended)           |
| expirationMs  | number  | ❌       | Expiration time in milliseconds (default: 12 hours, max: 1 day) |

**Event Types:**

| Event Type      | Description               |
| --------------- | ------------------------- |
| `all`           | All events (catch-all)    |
| `sheet.update`  | Any change to spreadsheet |
| `sheet.create`  | New sheet added           |
| `sheet.delete`  | Sheet removed             |
| `sheet.rename`  | Sheet renamed             |
| `cell.update`   | Cell values changed       |
| `format.update` | Cell formatting changed   |

**Example - Basic Registration:**

```json
{
  "request": {
    "action": "register",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "webhookUrl": "https://myapp.example.com/webhooks/sheets",
    "eventTypes": ["cell.update", "sheet.create"],
    "secret": "my-secure-secret-key-16chars",
    "expirationMs": 43200000
  }
}
```

**Note:** `expirationMs` defaults to 12 hours (43200000 ms) if not specified. Maximum is 1 day (86400000 ms) per Google Drive API limits.

**Example - All Events with Maximum Expiration:**

```json
{
  "request": {
    "action": "register",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "webhookUrl": "https://myapp.example.com/webhooks/sheets",
    "eventTypes": ["all"],
    "secret": "my-secure-secret-key",
    "expirationMs": 86400000
  }
}
```

**Note:** Use maximum 1-day expiration (86400000 ms) only when necessary. Shorter expiration times reduce security risk if your webhook endpoint is compromised.

**Response:**

```json
{
  "success": true,
  "data": {
    "webhookId": "webhook_abc123",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "webhookUrl": "https://myapp.example.com/webhooks/sheets",
    "eventTypes": ["cell.update", "sheet.create"],
    "resourceId": "RESOURCE_xyz789",
    "channelId": "CHANNEL_def456",
    "expiresAt": "2026-02-06T10:00:00Z",
    "active": true,
    "secret": "my-secure-secret-key-16chars"
  }
}
```

⚠️ **Important**: Save the `webhookId` and `secret` - you'll need them for unregistering and signature verification.

---

### `unregister` - Unregister Webhook

**Stop receiving notifications for a webhook.**

**Parameters:**

| Name      | Type    | Required | Description          |
| --------- | ------- | -------- | -------------------- |
| action    | literal | ✅       | `"unregister"`       |
| webhookId | string  | ✅       | Webhook ID to remove |

**Example:**

```json
{
  "request": {
    "action": "unregister",
    "webhookId": "webhook_abc123"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "Webhook unregistered successfully"
  }
}
```

---

### `list` - List Webhooks

**Get all registered webhooks, optionally filtered.**

**Parameters:**

| Name          | Type    | Required | Description             |
| ------------- | ------- | -------- | ----------------------- |
| action        | literal | ✅       | `"list"`                |
| spreadsheetId | string  | ❌       | Filter by spreadsheet   |
| active        | boolean | ❌       | Filter by active status |

**Example - All Webhooks:**

```json
{
  "request": {
    "action": "list"
  }
}
```

**Example - Active Webhooks for Specific Spreadsheet:**

```json
{
  "request": {
    "action": "list",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "active": true
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "webhooks": [
      {
        "webhookId": "webhook_abc123",
        "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
        "webhookUrl": "https://myapp.example.com/webhooks/sheets",
        "eventTypes": ["cell.update", "sheet.create"],
        "resourceId": "RESOURCE_xyz789",
        "channelId": "CHANNEL_def456",
        "createdAt": "2026-01-30T10:00:00Z",
        "expiresAt": "2026-02-06T10:00:00Z",
        "active": true,
        "deliveryCount": 42,
        "failureCount": 1,
        "lastDelivery": "2026-01-30T15:30:00Z",
        "lastFailure": "2026-01-29T12:00:00Z"
      }
    ]
  }
}
```

---

### `get` - Get Webhook Details

**Retrieve details for a specific webhook.**

**Parameters:**

| Name      | Type    | Required | Description |
| --------- | ------- | -------- | ----------- |
| action    | literal | ✅       | `"get"`     |
| webhookId | string  | ✅       | Webhook ID  |

**Example:**

```json
{
  "request": {
    "action": "get",
    "webhookId": "webhook_abc123"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "webhook": {
      "webhookId": "webhook_abc123",
      "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
      "webhookUrl": "https://myapp.example.com/webhooks/sheets",
      "eventTypes": ["cell.update", "sheet.create"],
      "resourceId": "RESOURCE_xyz789",
      "channelId": "CHANNEL_def456",
      "createdAt": "2026-01-30T10:00:00Z",
      "expiresAt": "2026-02-06T10:00:00Z",
      "active": true,
      "deliveryCount": 42,
      "failureCount": 1,
      "lastDelivery": "2026-01-30T15:30:00Z"
    }
  }
}
```

---

### `test` - Send Test Payload

**Send a test event to verify endpoint configuration.**

**Use Case**: Verify webhook URL is reachable, signature verification works, and endpoint handles payloads correctly.

**Parameters:**

| Name      | Type    | Required | Description        |
| --------- | ------- | -------- | ------------------ |
| action    | literal | ✅       | `"test"`           |
| webhookId | string  | ✅       | Webhook ID to test |

**Example:**

```json
{
  "request": {
    "action": "test",
    "webhookId": "webhook_abc123"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "delivery": {
      "deliveryId": "delivery_test123",
      "webhookId": "webhook_abc123",
      "timestamp": "2026-01-30T16:00:00Z",
      "eventType": "sheet.update",
      "payload": {
        "eventType": "sheet.update",
        "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
        "test": true,
        "message": "This is a test webhook delivery"
      },
      "status": "success",
      "statusCode": 200,
      "attemptCount": 1
    }
  }
}
```

**Test Payload Your Endpoint Receives:**

```json
{
  "eventType": "sheet.update",
  "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
  "test": true,
  "message": "This is a test webhook delivery",
  "timestamp": "2026-01-30T16:00:00Z",
  "webhookId": "webhook_abc123"
}
```

---

### `get_stats` - Get Delivery Statistics

**Retrieve webhook delivery metrics.**

**Parameters:**

| Name      | Type    | Required | Description                                            |
| --------- | ------- | -------- | ------------------------------------------------------ |
| action    | literal | ✅       | `"get_stats"`                                          |
| webhookId | string  | ❌       | Get stats for specific webhook (omit for global stats) |

**Example - Global Stats:**

```json
{
  "request": {
    "action": "get_stats"
  }
}
```

**Example - Webhook-Specific Stats:**

```json
{
  "request": {
    "action": "get_stats",
    "webhookId": "webhook_abc123"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "totalWebhooks": 5,
    "activeWebhooks": 4,
    "totalDeliveries": 1250,
    "successfulDeliveries": 1235,
    "failedDeliveries": 15,
    "pendingDeliveries": 2,
    "averageDeliveryTimeMs": 185,
    "webhookStats": [
      {
        "webhookId": "webhook_abc123",
        "deliveryCount": 42,
        "successRate": 0.9762,
        "averageLatencyMs": 150
      },
      {
        "webhookId": "webhook_def456",
        "deliveryCount": 380,
        "successRate": 1.0,
        "averageLatencyMs": 120
      }
    ]
  }
}
```

---

## Common Workflows

### Workflow 1: Initial Webhook Setup

**Goal**: Set up webhook for a spreadsheet and verify it works.

**Steps:**

1. **Prepare endpoint** (see Prerequisites)

2. **Register webhook:**

```json
{
  "request": {
    "action": "register",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "webhookUrl": "https://myapp.example.com/webhooks/sheets",
    "eventTypes": ["cell.update"],
    "secret": "my-secure-secret-key-16chars"
  }
}
```

1. **Save webhook ID and secret** from response

2. **Send test payload:**

```json
{
  "request": {
    "action": "test",
    "webhookId": "webhook_abc123"
  }
}
```

1. **Verify endpoint received test** (check logs)

2. **Make change to spreadsheet** and verify webhook fires

---

### Workflow 2: Monitor Webhook Health

**Goal**: Track webhook delivery success and troubleshoot failures.

**Steps:**

1. **Check delivery stats:**

```json
{
  "request": {
    "action": "get_stats",
    "webhookId": "webhook_abc123"
  }
}
```

1. **Get webhook details:**

```json
{
  "request": {
    "action": "get",
    "webhookId": "webhook_abc123"
  }
}
```

1. **Analyze metrics:**
   - Success rate < 95%: Check endpoint health
   - High average latency: Optimize endpoint response time
   - Recent failures: Review `lastFailure` timestamp

2. **If issues found, fix endpoint and test:**

```json
{
  "request": {
    "action": "test",
    "webhookId": "webhook_abc123"
  }
}
```

---

### Workflow 3: Webhook Renewal Before Expiration

**Goal**: Re-register webhook before it expires to avoid downtime.

**Steps:**

1. **List webhooks expiring soon:**

```json
{
  "request": {
    "action": "list",
    "active": true
  }
}
```

1. **Check expiration dates** in response (24-hour warning)

2. **Unregister old webhook:**

```json
{
  "request": {
    "action": "unregister",
    "webhookId": "webhook_abc123"
  }
}
```

1. **Register new webhook** (same parameters):

```json
{
  "request": {
    "action": "register",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "webhookUrl": "https://myapp.example.com/webhooks/sheets",
    "eventTypes": ["cell.update"],
    "secret": "my-secure-secret-key-16chars"
  }
}
```

1. **Update stored webhook ID**

**Automation Tip**: Schedule daily cron job to check and renew webhooks.

---

### Workflow 4: Clean Up Inactive Webhooks

**Goal**: Remove unused webhooks to reduce noise and quota usage.

**Steps:**

1. **List all webhooks:**

```json
{
  "request": {
    "action": "list"
  }
}
```

1. **Identify candidates for removal:**
   - Expired webhooks (`active: false`)
   - High failure rate (> 50%)
   - No recent deliveries

2. **Unregister each:**

```json
{
  "request": {
    "action": "unregister",
    "webhookId": "webhook_old123"
  }
}
```

1. **Verify removal:**

```json
{
  "request": {
    "action": "list",
    "active": true
  }
}
```

---

## Best Practices

### Security

1. **Always use secrets**
   - Generate cryptographically random secrets (16+ chars)
   - Verify HMAC signatures on every request
   - Rotate secrets periodically

2. **Validate Drive API headers** ⚠️ **CRITICAL**
   - **Verify `X-Goog-Channel-ID`** - Must match registered channel ID
   - **Verify `X-Goog-Resource-ID`** - Must match stored resource ID
   - **Why?** Prevents webhook spoofing attacks where malicious actors send fake notifications

   **Example validation:**

   ```typescript
   const channelId = req.headers['x-goog-channel-id'];
   const resourceId = req.headers['x-goog-resource-id'];

   // Look up webhook in your database
   const webhook = await getWebhook(channelId);

   if (!webhook || webhook.resourceId !== resourceId) {
     return res.status(403).send('Unauthorized webhook');
   }
   ```

   **Security Risk:** Without this validation, attackers can forge valid-looking webhook payloads and trigger your handlers with malicious data.

3. **Validate event payload**
   - Check `spreadsheetId` matches expected
   - Verify `timestamp` is recent (< 5 mins)
   - Reject duplicate `deliveryId`

4. **Use HTTPS only**
   - Never use HTTP webhooks
   - Ensure valid SSL certificates
   - Avoid self-signed certificates in production

### Performance

1. **Respond quickly**
   - Return 2xx status within 30 seconds
   - Process events asynchronously if needed
   - Use job queues for heavy processing

2. **Handle idempotency**
   - Track `deliveryId` to detect duplicates
   - Design event handlers to be idempotent
   - Same event delivered twice should be safe

3. **Implement retry logic on your side**
   - If processing fails, retry with exponential backoff
   - Log failures for debugging
   - Alert on repeated failures

### Reliability

1. **Monitor webhook health**
   - Track success rates with `get_stats`
   - Alert on failure rate > 5%
   - Review `lastFailure` timestamps regularly

2. **Auto-renew before expiration**
   - Check expiration daily
   - Renew 1 day before expiration
   - Alert if renewal fails

3. **Graceful degradation**
   - If webhook fails, fall back to polling
   - Implement circuit breaker pattern
   - Log webhook failures

### Event Handling

1. **Filter event types**
   - Only subscribe to needed events
   - Use specific types over `all`
   - Reduces noise and processing overhead

2. **Batch processing**
   - If high volume, batch events
   - Process every N seconds instead of immediately
   - Reduces load spikes

3. **Error handling**
   - Return 2xx even if processing fails (to prevent retries)
   - Log errors for later review
   - Implement dead letter queue

---

## Troubleshooting

### Common Issues

#### Issue: "Webhook URL must be HTTPS"

**Cause**: Attempted to register HTTP URL

**Solution**:

1. Use HTTPS URL only
2. For local development:
   - ngrok: `ngrok http 3000`
   - Get public HTTPS URL from ngrok output
   - Use that URL for webhook registration

---

#### Issue: "No events being received"

**Cause**: Multiple possible causes

**Debug Steps**:

1. **Verify webhook is active:**

```json
{
  "request": {
    "action": "get",
    "webhookId": "webhook_abc123"
  }
}
```

1. **Check expiration date** (`expiresAt` in response)

2. **Send test payload:**

```json
{
  "request": {
    "action": "test",
    "webhookId": "webhook_abc123"
  }
}
```

1. **Verify endpoint is reachable:**
   - Check firewall rules
   - Verify public DNS resolves
   - Test with curl: `curl -X POST https://your-url/webhooks/sheets`

2. **Check event type filters:**
   - Ensure subscribed to correct event types
   - Try `"all"` temporarily to catch all events

---

#### Issue: "Signature verification failing"

**Cause**: HMAC signature doesn't match

**Solution**:

1. **Verify secret matches** registration secret

2. **Check signature header:**
   - Header name: `x-webhook-signature`
   - Value format: hex string (64 chars for SHA-256)

3. **Ensure payload is raw JSON string:**

```javascript
// ❌ Wrong - signing parsed object
const hmac = crypto.createHmac('sha256', secret);
hmac.update(req.body); // This is already parsed

// ✅ Correct - signing raw JSON string
const hmac = crypto.createHmac('sha256', secret);
hmac.update(JSON.stringify(req.body));
```

1. **Use timing-safe comparison:**

```javascript
return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
```

---

#### Issue: "High failure rate"

**Cause**: Endpoint returning errors or timing out

**Debug Steps**:

1. **Check delivery stats:**

```json
{
  "request": {
    "action": "get_stats",
    "webhookId": "webhook_abc123"
  }
}
```

1. **Review endpoint logs:**
   - Look for errors or exceptions
   - Check response times

2. **Verify endpoint performance:**
   - Should respond in < 5 seconds
   - Async processing for heavy operations
   - Return 2xx immediately, process later

3. **Check for rate limiting:**
   - Your endpoint may be rate-limited
   - Implement backpressure handling

---

#### Issue: "Webhook expired"

**Cause**: Webhook reached expiration time (max 1 day per Drive API limits)

**Solution**:

1. **Unregister old webhook:**

```json
{
  "request": {
    "action": "unregister",
    "webhookId": "webhook_old123"
  }
}
```

1. **Register new webhook:**

```json
{
  "request": {
    "action": "register",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "webhookUrl": "https://myapp.example.com/webhooks/sheets",
    "eventTypes": ["cell.update"],
    "secret": "new-secret-key-16chars"
  }
}
```

1. **Implement auto-renewal:**
   - Check expiration daily
   - Renew 1 day before expiration
   - Alert on renewal failures

---

#### Issue: "Duplicate events received"

**Cause**: Google may deliver events multiple times

**Solution**:

1. **Track delivery IDs:**

```javascript
const processedDeliveries = new Set();

app.post('/webhooks/sheets', (req, res) => {
  const deliveryId = req.body.deliveryId;

  if (processedDeliveries.has(deliveryId)) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  processedDeliveries.add(deliveryId);
  // Process event...
});
```

1. **Design idempotent handlers:**
   - Same event processed twice should be safe
   - Use database transactions
   - Check current state before applying changes

---

### Getting Help

1. **Check webhook status:**

   ```json
   {
     "request": {
       "action": "get",
       "webhookId": "webhook_abc123"
     }
   }
   ```

2. **Review delivery stats:**

   ```json
   {
     "request": {
       "action": "get_stats"
     }
   }
   ```

3. **Test endpoint manually:**

   ```bash
   curl -X POST https://your-url/webhooks/sheets \
     -H "Content-Type: application/json" \
     -H "x-webhook-signature: test" \
     -d '{"eventType":"sheet.update","test":true}'
   ```

4. **ServalSheets documentation:**
   - [Error Handling Guide](./ERROR_HANDLING.md)
   - [Troubleshooting Guide](./TROUBLESHOOTING.md)

---

## Additional Resources

- **Google Sheets Watch API**: https://developers.google.com/drive/api/v3/push
- **HMAC Signatures**: https://en.wikipedia.org/wiki/HMAC
- **Webhook Security Best Practices**: https://webhooks.fyi/best-practices/security
- **ServalSheets Source**: [src/schemas/webhook.ts](../../src/schemas/webhook.ts)
- **Handler Implementation**: [src/handlers/webhook.ts](../../src/handlers/webhook.ts)

---

**Last Updated**: 2026-01-30 (v1.6.0)
