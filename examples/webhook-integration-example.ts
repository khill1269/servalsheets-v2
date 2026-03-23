/**
 * ServalSheets - Complete Webhook Integration Example
 *
 * This example demonstrates the complete workflow of:
 * 1. Registering a webhook with automatic secret generation
 * 2. Receiving and verifying webhook signatures
 * 3. Processing verified webhooks securely
 *
 * @category Examples
 */

import express, { Request, Response, NextFunction } from 'express';
import {
  webhookVerificationMiddleware,
  VerifiedWebhookRequest,
  captureRawBody,
} from '../utils/webhook-verification.js';

// ============================================================================
// Step 1: Express App Setup
// ============================================================================

const app = express();

/**
 * IMPORTANT: Must capture raw body BEFORE parsing JSON
 * This preserves the exact bytes for signature verification
 */
app.use(captureRawBody);

// Now parse JSON normally
app.use(express.json());

// ============================================================================
// Step 2: Webhook Secret Storage (Mock Database)
// ============================================================================

/**
 * In production, store secrets in a secure database or secret manager.
 * This example uses a simple in-memory map for demonstration.
 */
const webhookSecrets = new Map<string, string>();

// Mock function to retrieve webhook secret from database
async function getWebhookSecret(webhookId: string): Promise<string | null> {
  return webhookSecrets.get(webhookId) || null;
}

// Mock function to store webhook secret
async function storeWebhookSecret(webhookId: string, secret: string): Promise<void> {
  webhookSecrets.set(webhookId, secret);
  console.log(`Stored webhook secret for ${webhookId}`);
}

// ============================================================================
// Step 3: Register Webhook Endpoint
// ============================================================================

/**
 * Endpoint to register a webhook
 *
 * In a real application, this would:
 * 1. Validate the user's spreadsheet access
 * 2. Call ServalSheets webhook API
 * 3. Store the returned secret securely
 */
app.post('/api/register-webhook', async (req: Request, res: Response) => {
  try {
    const { spreadsheetId, webhookUrl } = req.body;

    // Validate inputs
    if (!spreadsheetId || !webhookUrl) {
      return res.status(400).json({
        error: 'Missing required fields: spreadsheetId, webhookUrl',
      });
    }

    // In a real app, call ServalSheets API:
    // const response = await servalsheets.registerWebhook({
    //   spreadsheetId,
    //   webhookUrl,
    //   eventTypes: ['all'],
    //   // No secret provided - will be auto-generated
    // });

    // Mock response from ServalSheets
    const mockResponse = {
      webhookId: `webhook_${Date.now()}`,
      spreadsheetId,
      webhookUrl,
      secret: `secret_${Math.random().toString(36).substring(2)}`, // Simulated
      eventTypes: ['all'],
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    // CRITICAL: Store the secret securely
    await storeWebhookSecret(mockResponse.webhookId, mockResponse.secret);

    return res.status(201).json({
      success: true,
      data: {
        webhookId: mockResponse.webhookId,
        spreadsheetId: mockResponse.spreadsheetId,
        webhookUrl: mockResponse.webhookUrl,
        expiresAt: mockResponse.expiresAt,
        // NOTE: Secret is returned only once - store it securely!
        secret: mockResponse.secret,
      },
      message: 'Webhook registered successfully. Save the secret in a secure location.',
    });
  } catch (error) {
    console.error('Failed to register webhook', error);
    return res.status(500).json({
      error: 'Failed to register webhook',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Step 4: Webhook Verification Middleware
// ============================================================================

/**
 * Create the webhook verification middleware
 * This automatically verifies HMAC signatures on all webhook requests
 */
const verifyWebhook = webhookVerificationMiddleware({
  getSecret: getWebhookSecret,
  webhookIdHeader: 'x-webhook-id',
  signatureHeader: 'x-webhook-signature',
  deliveryIdHeader: 'x-webhook-delivery',
  requireSignature: true,
  // Custom error handler
  onError: (error, req, res) => {
    console.warn('Webhook verification failed', {
      code: error.code,
      message: error.message,
      details: error.details,
    });

    res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
    });
  },
});

// ============================================================================
// Step 5: Webhook Receiver Endpoint
// ============================================================================

/**
 * Receive and process webhooks from ServalSheets
 *
 * The verifyWebhook middleware automatically:
 * 1. Extracts the webhook ID from headers
 * 2. Looks up the secret from the database
 * 3. Verifies the HMAC-SHA256 signature
 * 4. Rejects invalid signatures (401)
 * 5. Calls next() only if valid
 */
app.post('/webhooks/servalsheets', verifyWebhook, async (req: Request, res: Response) => {
  try {
    // Cast to VerifiedWebhookRequest to access webhook info
    const verifiedReq = req as VerifiedWebhookRequest;
    const webhook = verifiedReq.webhook!;

    const payloadObj = webhook.payload as Record<string, unknown>;
    console.log('Received verified webhook:', {
      webhookId: webhook.webhookId,
      deliveryId: webhook.deliveryId,
      eventType: payloadObj?.['eventType'],
      timestamp: payloadObj?.['timestamp'],
    });

    // GUARANTEED: Webhook signature is verified at this point
    // The payload has not been modified in transit
    // The webhook came from ServalSheets (verified by secret)

    // Process the webhook payload
    await handleWebhookEvent(payloadObj || {});

    // Return 200 to acknowledge successful processing
    // ServalSheets will not retry on 2xx responses
    res.status(200).json({
      success: true,
      deliveryId: webhook.deliveryId,
    });
  } catch (error) {
    console.error('Failed to process webhook', error);

    // Return 5xx to trigger retry
    res.status(500).json({
      error: 'Failed to process webhook',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Step 6: Webhook Event Handler
// ============================================================================

/**
 * Process the webhook event payload
 *
 * @param payload - The verified webhook payload
 */
async function handleWebhookEvent(payload: Record<string, unknown>): Promise<void> {
  if (!payload) {
    throw new Error('Invalid webhook payload');
  }

  const deliveryId = payload['deliveryId'] as string | undefined;
  const _webhookId = payload['webhookId'] as string | undefined;
  const eventType = payload['eventType'] as string | undefined;
  const _timestamp = payload['timestamp'] as string | undefined;
  const data = payload['data'] as Record<string, unknown> | undefined;

  // Implement idempotency using deliveryId
  const isProcessed = await checkIfProcessed(deliveryId || '');
  if (isProcessed) {
    console.log('Webhook already processed:', deliveryId);
    return;
  }

  // Process based on event type
  switch (eventType) {
    case 'cell.update':
      await handleCellUpdate(data || {});
      break;
    case 'sheet.create':
      await handleSheetCreate(data || {});
      break;
    case 'sheet.delete':
      await handleSheetDelete(data || {});
      break;
    case 'format.update':
      await handleFormatUpdate(data || {});
      break;
    default:
      console.log('Unknown event type:', eventType);
  }

  // Mark as processed
  await markAsProcessed(deliveryId || '');
  console.log('Webhook processed successfully:', deliveryId);
}

// ============================================================================
// Step 7: Event Type Handlers
// ============================================================================

async function handleCellUpdate(data: Record<string, unknown>): Promise<void> {
  const changeDetails = data['changeDetails'] as Record<string, unknown> | undefined;
  console.log('Handling cell update:', {
    spreadsheetId: data['spreadsheetId'],
    cellRanges: changeDetails?.['cellRanges'],
  });

  // Perform your business logic
  // Example: Update database, send notifications, trigger workflows, etc.
}

async function handleSheetCreate(data: Record<string, unknown>): Promise<void> {
  const changeDetails = data['changeDetails'] as Record<string, unknown> | undefined;
  console.log('Handling sheet create:', {
    spreadsheetId: data['spreadsheetId'],
    sheetsAdded: changeDetails?.['sheetsAdded'],
  });
}

async function handleSheetDelete(data: Record<string, unknown>): Promise<void> {
  const changeDetails = data['changeDetails'] as Record<string, unknown> | undefined;
  console.log('Handling sheet delete:', {
    spreadsheetId: data['spreadsheetId'],
    sheetsRemoved: changeDetails?.['sheetsRemoved'],
  });
}

async function handleFormatUpdate(data: Record<string, unknown>): Promise<void> {
  console.log('Handling format update:', {
    spreadsheetId: data['spreadsheetId'],
  });
}

// ============================================================================
// Step 8: Idempotency Tracking
// ============================================================================

/**
 * Track processed deliveries to prevent duplicate processing
 * Use X-Webhook-Delivery header as the idempotency key
 */
const processedDeliveries = new Set<string>();

async function checkIfProcessed(deliveryId: string): Promise<boolean> {
  return processedDeliveries.has(deliveryId);
}

async function markAsProcessed(deliveryId: string): Promise<void> {
  processedDeliveries.add(deliveryId);

  // In production, persist to database with TTL (e.g., 24 hours)
}

// ============================================================================
// Step 9: Health Check & Monitoring
// ============================================================================

/**
 * Health check endpoint for monitoring
 */
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    webhooksRegistered: webhookSecrets.size,
  });
});

/**
 * Webhook statistics endpoint
 */
app.get('/api/webhook-stats', (_req: Request, res: Response) => {
  res.status(200).json({
    webhooksConfigured: webhookSecrets.size,
    deliveriesProcessed: processedDeliveries.size,
  });
});

// ============================================================================
// Step 10: Error Handling & Logging
// ============================================================================

/**
 * Global error handler
 */
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', error);

  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
  });
});

// ============================================================================
// Step 11: Start Server
// ============================================================================

const PORT = process.env['PORT'] || 3000;

app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
  console.log('');
  console.log('Endpoints:');
  console.log(`  POST /api/register-webhook - Register a new webhook`);
  console.log(`  POST /webhooks/servalsheets - Receive webhooks (with signature verification)`);
  console.log(`  GET /health - Health check`);
  console.log(`  GET /api/webhook-stats - Webhook statistics`);
});

// ============================================================================
// Usage Instructions
// ============================================================================

/*
STEP-BY-STEP GUIDE:

1. Register a Webhook:
   ```
   curl -X POST http://localhost:3000/api/register-webhook \
     -H "Content-Type: application/json" \
     -d '{
       "spreadsheetId": "your-spreadsheet-id",
       "webhookUrl": "https://your-domain.com/webhooks/servalsheets"
     }'
   ```

   Response includes:
   - webhookId: Save this for tracking
   - secret: SAVE THIS SECURELY - you need it for signature verification

2. Configure ServalSheets:
   - Copy the webhookId from the response
   - Add your webhook endpoint URL to ServalSheets
   - ServalSheets will use the secret to sign all deliveries

3. Receive Webhooks:
   - ServalSheets will POST to /webhooks/servalsheets
   - The middleware will verify the signature
   - Your handler processes the verified payload

4. Security:
   - Secrets are verified using HMAC-SHA256
   - Signatures are compared using constant-time algorithm
   - Invalid signatures are rejected (401)
   - All processing is audited in logs

5. Monitoring:
   - Check /health for server status
   - Check /api/webhook-stats for processed webhooks
   - Monitor logs for verification failures

IMPORTANT SECURITY NOTES:

✓ Store webhook secrets securely (use AWS Secrets Manager, Vault, etc.)
✓ Use HTTPS for webhook URLs
✓ Always verify signatures before processing
✓ Use X-Webhook-Delivery to prevent duplicate processing
✓ Return 2xx for success, 5xx for retriable errors
✓ Implement timeout handling (ServalSheets has 10 second timeout)
✓ Log all webhook operations for audit trail
✓ Rotate secrets periodically
*/
