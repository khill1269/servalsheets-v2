---
title: ServalSheets Webhook Security
category: general
last_updated: 2026-03-10
description: Comprehensive guide for webhook signature verification and security best practices.
version: 1.6.0
tags: [security]
---

# ServalSheets Webhook Security

Comprehensive guide for webhook signature verification and security best practices.

## Overview

ServalSheets webhooks are secured using **HMAC-SHA256 signatures**. Every webhook callback includes a cryptographic signature that verifies:

1. **Authenticity** - The webhook came from ServalSheets
2. **Integrity** - The payload hasn't been modified in transit
3. **Origin verification** - The secret was not compromised

## Security Features

### Signature Generation

- **Algorithm**: HMAC-SHA256 (industry standard)
- **Secret Length**: Minimum 32 bytes (256 bits) cryptographically secure
- **Encoding**: Base64url for safe transmission
- **Constant-Time Comparison**: Prevents timing attacks

### Auto-Generated Secrets

When registering a webhook without providing a secret:

```typescript
const response = await servalsheets.registerWebhook({
  spreadsheetId: 'sheet123',
  webhookUrl: 'https://example.com/webhooks',
  eventTypes: ['all'],
  // secret omitted - will be auto-generated
});

// secret is returned in response and must be saved
const { secret } = response.data;
```

A 32-byte cryptographically secure secret is automatically generated and returned. **Save this secret securely** - you'll need it to verify incoming webhooks.

### Custom Secrets

You can provide your own secret if it meets the requirements:

```typescript
const response = await servalsheets.registerWebhook({
  spreadsheetId: 'sheet123',
  webhookUrl: 'https://example.com/webhooks',
  eventTypes: ['all'],
  secret: 'my-custom-32-char-minimum-secret-here', // min 16 chars
});
```

## Verifying Webhook Signatures

### Method 1: Using Middleware (Recommended)

```typescript
import express from 'express';
import { webhookVerificationMiddleware } from 'servalsheets/utils/webhook-verification';

const app = express();

// Must preserve raw body for signature verification
app.use(express.raw({ type: 'application/json' }));

// Create verification middleware
const verifyWebhook = webhookVerificationMiddleware({
  getSecret: async (webhookId) => {
    // Fetch the secret from your database
    const webhook = await db.webhooks.findById(webhookId);
    return webhook?.secret || null;
  },
});

// Use middleware on webhook route
app.post('/webhooks/servalsheets', verifyWebhook, async (req, res) => {
  // Webhook is verified here
  const webhook = (req as any).webhook;
  const payload = webhook.payload;

  console.log('Verified webhook:', {
    webhookId: webhook.webhookId,
    deliveryId: webhook.deliveryId,
    isValid: webhook.isValid,
  });

  // Process webhook safely
  await processWebhook(payload);

  res.status(200).json({ success: true });
});

app.listen(3000);
```

### Method 2: Manual Verification

```typescript
import { verifyWebhookSignature } from 'servalsheets/security/webhook-signature';

app.post('/webhooks/servalsheets', express.raw({ type: 'application/json' }), (req, res) => {
  const webhookId = req.get('x-webhook-id');
  const signature = req.get('x-webhook-signature');
  const rawBody = req.body; // Must be Buffer

  // Get secret from database
  const secret = await db.webhooks.getSecret(webhookId);

  // Verify signature
  const isValid = verifyWebhookSignature(rawBody, secret, signature);

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Process webhook
  const payload = JSON.parse(rawBody.toString());
  await processWebhook(payload);

  res.status(200).json({ success: true });
});
```

## Webhook Headers

ServalSheets includes the following headers with every webhook delivery:

```
X-Webhook-Signature: sha256=<hmac-sha256-signature>
X-Webhook-Delivery: delivery_<uuid>
X-Webhook-Event: sheet.update
X-Webhook-Id: webhook_<uuid>
```

### Header Descriptions

| Header                | Description                                   |
| --------------------- | --------------------------------------------- |
| `X-Webhook-Signature` | HMAC-SHA256 signature for verification        |
| `X-Webhook-Delivery`  | Unique delivery ID (for idempotency tracking) |
| `X-Webhook-Event`     | Event type that triggered this webhook        |
| `X-Webhook-Id`        | The webhook ID (use to look up secret)        |

## Webhook Payload Structure

```typescript
{
  // Delivery metadata
  "deliveryId": "delivery_550e8400-e29b-41d4-a716-446655440000",
  "webhookId": "webhook_550e8400-e29b-41d4-a716-446655440001",
  "eventType": "cell.update",
  "timestamp": "2025-02-05T12:34:56.789Z",

  // The actual event data
  "data": {
    "spreadsheetId": "1BxiMVs0XRA5nFMKUVfIrxQ6AI0GlLLzjg",
    "channelId": "channel_550e8400",
    "resourceId": "resource_550e8400",
    "resourceState": "exists",
    "changeDetails": {
      "cellRanges": ["A1:D100"],
      "sheetsAdded": [],
      "sheetsRemoved": [],
      "sheetsRenamed": []
    }
  }
}
```

## Signature Verification Examples

### Node.js/Express

```typescript
import { verifyWebhookSignature } from 'servalsheets/security/webhook-signature';

const isValid = verifyWebhookSignature(
  rawBody, // Request body as Buffer
  secret, // Webhook secret
  'sha256=abc123...' // X-Webhook-Signature header value
);

if (!isValid) {
  throw new Error('Invalid webhook signature');
}
```

### Python

```python
import hmac
import hashlib

def verify_webhook_signature(payload_bytes, secret, signature):
    """Verify ServalSheets webhook signature."""
    # The secret is base64url-encoded, decode it
    import base64
    secret_bytes = base64.urlsafe_b64decode(secret)

    # Calculate expected signature
    expected_sig = hmac.new(
        secret_bytes,
        payload_bytes,
        hashlib.sha256
    ).hexdigest()

    # Extract signature value (remove 'sha256=' prefix)
    received_sig = signature.split('=', 1)[1]

    # Constant-time comparison
    return hmac.compare_digest(expected_sig, received_sig)
```

### Go

```go
import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "encoding/base64"
    "strings"
)

func verifyWebhookSignature(payload []byte, secret string, signature string) bool {
    // Decode base64url-encoded secret
    secretBytes, err := base64.RawURLEncoding.DecodeString(secret)
    if err != nil {
        return false
    }

    // Calculate HMAC-SHA256
    h := hmac.New(sha256.New, secretBytes)
    h.Write(payload)
    expectedSig := hex.EncodeToString(h.Sum(nil))

    // Extract signature value (remove 'sha256=' prefix)
    parts := strings.Split(signature, "=")
    if len(parts) != 2 {
        return false
    }
    receivedSig := parts[1]

    // Constant-time comparison
    return hmac.Equal([]byte(expectedSig), []byte(receivedSig))
}
```

### Ruby

```ruby
require 'hmac-sha2'
require 'base64'

def verify_webhook_signature(payload, secret, signature)
  # Decode base64url-encoded secret
  secret_bytes = Base64.urlsafe_decode64(secret)

  # Calculate HMAC-SHA256
  expected_sig = OpenSSL::HMAC.hexdigest(
    OpenSSL::Digest.new('sha256'),
    secret_bytes,
    payload
  )

  # Extract signature value (remove 'sha256=' prefix)
  received_sig = signature.split('=', 2)[1]

  # Secure comparison
  OpenSSL::Hmac.compare_digest(expected_sig, received_sig)
end
```

## Security Best Practices

### 1. Always Verify Signatures

Never process a webhook without verifying its signature first. Always use constant-time comparison to prevent timing attacks.

### 2. Store Secrets Securely

- Store webhook secrets in a secure secret management system (AWS Secrets Manager, Vault, etc.)
- Never commit secrets to version control
- Use environment variables or secret management services
- Rotate secrets periodically

### 3. Use HTTPS Only

- Webhook URLs must use HTTPS protocol
- Verify SSL/TLS certificates
- Use certificate pinning for high-security applications

### 4. Implement Idempotency

Use the `X-Webhook-Delivery` header to track deliveries and prevent processing duplicates:

```typescript
const deliveryId = req.get('x-webhook-delivery');
const isProcessed = await db.deliveries.exists(deliveryId);

if (isProcessed) {
  // Already processed this webhook
  return res.status(200).json({ success: true });
}

// Process webhook
await processWebhook(payload);
await db.deliveries.record(deliveryId);
```

### 5. Handle Replay Attacks

Include a timestamp check:

```typescript
const payload = JSON.parse(rawBody);
const webhookTime = new Date(payload.timestamp);
const now = new Date();

// Reject webhooks older than 5 minutes
if (now.getTime() - webhookTime.getTime() > 5 * 60 * 1000) {
  return res.status(400).json({ error: 'Webhook too old' });
}
```

### 6. Implement Rate Limiting

Protect your webhook endpoint with rate limiting:

```typescript
import rateLimit from 'express-rate-limit';

const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
});

app.post('/webhooks/servalsheets', webhookLimiter, verifyWebhook, handler);
```

### 7. Implement Retry Logic

ServalSheets retries failed deliveries with exponential backoff:

- Attempt 1: Immediate
- Attempt 2: 1 second delay
- Attempt 3: 4 second delay (2^2)

Return a 2xx status code to indicate success. Any other status code will trigger a retry.

### 8. Monitor Webhook Health

Track webhook delivery metrics:

```typescript
const stats = await servalsheets.getWebhookStats({
  webhookId: 'webhook_123',
});

console.log({
  deliveryCount: stats.totalDeliveries,
  successRate: stats.successfulDeliveries / stats.totalDeliveries,
  failureCount: stats.failedDeliveries,
  avgLatencyMs: stats.averageDeliveryTimeMs,
});
```

## Troubleshooting

### "Invalid Signature" Error

**Causes:**

1. Wrong secret - Verify you're using the correct webhook secret
2. Modified payload - The body must be exactly as received (not re-parsed)
3. Wrong algorithm - Ensure you're using HMAC-SHA256
4. Encoding issues - The secret is base64url-encoded

**Fix:**

```typescript
// WRONG - Don't re-parse the JSON
const payload = JSON.parse(rawBody);
const signature = verifyWebhookSignature(payload, secret, sig); // ❌

// CORRECT - Use the raw body bytes
const signature = verifyWebhookSignature(rawBody, secret, sig); // ✅
```

### "Webhook Not Found"

The webhook ID doesn't exist or was deleted.

**Solutions:**

1. Verify the `X-Webhook-Id` header is correct
2. Check that the webhook hasn't been deleted
3. Re-register the webhook if needed

### Missing Raw Body

Your Express setup isn't preserving the raw request body.

**Fix:**

```typescript
// Add before route handlers
app.use(express.raw({ type: 'application/json' }));

// For Fastify
fastify.register(require('@fastify/raw-body'));

// For Koa
app.use(require('raw-body'));
```

## API Reference

### WebhookSignatureManager

```typescript
class WebhookSignatureManager {
  // Generate a new secure secret
  generateSecret(lengthBytes?: number): string;

  // Sign a payload with the secret
  signPayload(payload: string | object, secret: string): string;

  // Verify a signature
  verifySignature(
    payload: string | object,
    secret: string,
    signature: string,
    expectedAlgorithm?: string
  ): boolean;

  // Get the algorithm from a signature header
  getAlgorithm(signature: string): string | null;

  // Get current configuration
  getConfig(): Readonly<WebhookSignatureConfig>;
}
```

### Utility Functions

```typescript
// Generate a secret
const secret = generateWebhookSecret(); // 32 bytes
const secret = generateWebhookSecret(64); // Custom length

// Sign a payload
const sig = signWebhookPayload(payload, secret);

// Verify a signature
const isValid = verifyWebhookSignature(payload, secret, signature);
```

### Express Middleware

```typescript
// Verify webhook with middleware
app.use(
  webhookVerificationMiddleware({
    getSecret: async (webhookId) => {
      /* ... */
    },
  })
);

// With custom configuration
app.use(
  webhookVerificationMiddleware({
    getSecret,
    webhookIdHeader: 'x-webhook-id',
    signatureHeader: 'x-webhook-signature',
    deliveryIdHeader: 'x-webhook-delivery',
    requireSignature: true,
    onError: (error, req, res) => {
      /* ... */
    },
  })
);
```

## Compliance

ServalSheets webhook security implements:

- **RFC 4648** - Base64url encoding
- **FIPS 198-1** - HMAC specification
- **NIST SP 800-38B** - HMAC authentication
- **OWASP** - Security best practices for webhooks

## Support

For security issues or questions, contact ServalSheets security team at security@servalsheets.dev
