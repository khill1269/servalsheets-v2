# Webhook Security Best Practices

ServalSheets webhooks use HMAC signature verification and Redis-backed delivery queues for reliable change notifications.

## 1. Registration Security

Always use a strong random secret when registering webhooks:

```json
{
  "tool": "sheets_webhook",
  "action": "register",
  "spreadsheetId": "1ABC...",
  "webhookUrl": "https://your-server.com/webhook",
  "secret": "use-crypto-random-32-byte-hex-string",
  "eventTypes": ["CELL_CHANGE", "SHEET_ADD", "SHEET_DELETE"]
}
```

**Important:** The `webhookUrl` MUST use HTTPS. HTTP endpoints are rejected.

## 2. HMAC Signature Verification

Every webhook delivery includes an `X-ServalSheets-Signature` header containing an HMAC-SHA256 signature of the request body using your registered secret.

### Verify signatures server-side:

```javascript
const crypto = require('crypto');

function verifyWebhook(body, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

**Never skip verification** — unsigned or mismatched signatures indicate tampering.

## 3. Event Types

Available event types for monitoring:

- `CELL_CHANGE` — Cell values modified
- `SHEET_ADD` — New sheet/tab added
- `SHEET_DELETE` — Sheet/tab removed
- `FORMAT_CHANGE` — Formatting modified
- `STRUCTURE_CHANGE` — Rows/columns inserted or deleted

Use `sheets_webhook.list` to see all active registrations and `sheets_webhook.get_stats` for delivery metrics.

## 4. Delivery Reliability

Webhooks use a Redis-backed queue with automatic retry:

- **3 retry attempts** with exponential backoff (1s, 5s, 25s)
- **Delivery timeout**: 30 seconds per attempt
- **Dead letter queue**: Failed deliveries after all retries are logged for manual review
- Use `sheets_webhook.test` to verify your endpoint is reachable

## 5. Managing Webhooks

```json
// List all active webhooks
{ "action": "list", "spreadsheetId": "1ABC..." }

// Check delivery statistics
{ "action": "get_stats", "spreadsheetId": "1ABC..." }

// Remove a webhook
{ "action": "unregister", "webhookId": "wh_abc123" }
```

## 6. Rate Limiting

Webhooks are rate-limited to prevent abuse:

- **50 events per minute** per spreadsheet
- Events during rate limiting are queued and delivered when the window resets
- Burst traffic (e.g., bulk imports) may delay notifications

## Prerequisites

Webhook functionality requires:
- Redis backend (`REDIS_URL` environment variable)
- HTTPS endpoint accessible from the ServalSheets server
- Network connectivity between ServalSheets and your webhook endpoint
