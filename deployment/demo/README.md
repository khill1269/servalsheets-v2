# ServalSheets Hosted Demo

A public demo instance of ServalSheets for "try before you install" experience.

## Features

- **Read-only access** to sample spreadsheets
- **Rate limited** to prevent abuse
- **No authentication required** for demo operations
- **Pre-configured sample data** showcasing all features

## Quick Deploy to Cloud Run

```bash
# Set project
export PROJECT_ID="your-project-id"
export REGION="us-central1"

# Build and push container
gcloud builds submit --tag gcr.io/$PROJECT_ID/servalsheets-demo .

# Deploy
gcloud run deploy servalsheets-demo \
  --image gcr.io/$PROJECT_ID/servalsheets-demo \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars="DEMO_MODE=true,READ_ONLY=true,RATE_LIMIT_MAX_REQUESTS=30" \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3
```

## Demo Mode Configuration

When `DEMO_MODE=true`:

- Uses pre-configured sample spreadsheets
- Disables write operations (or makes them no-op)
- Enables rate limiting
- Logs demo usage for analytics

### Environment Variables

| Variable                              | Value  | Description                 |
| ------------------------------------- | ------ | --------------------------- |
| `DEMO_MODE`                           | `true` | Enable demo mode            |
| `READ_ONLY`                           | `true` | Disable write operations    |
| `RATE_LIMIT_MAX_REQUESTS`             | `30`   | Requests per minute         |
| `DEMO_SPREADSHEET_ID`                 | `...`  | Sample spreadsheet ID       |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | `...`  | Service account (read-only) |

## Sample Data

The demo uses a pre-configured spreadsheet with:

### Sheet 1: Sales Data

| Product  | Q1   | Q2   | Q3   | Q4   | Total |
| -------- | ---- | ---- | ---- | ---- | ----- |
| Widget A | 1200 | 1500 | 1800 | 2100 | 6600  |
| Widget B | 800  | 950  | 1100 | 1300 | 4150  |
| ...      | ...  | ...  | ...  | ...  | ...   |

### Sheet 2: Customer Data

Sample customer records for demonstrating:

- Data validation
- Conditional formatting
- Named ranges

### Sheet 3: Financial Model

Complex formulas demonstrating:

- Formula extraction
- Cell dependencies
- Pattern analysis

## Usage Examples

### Web Interface

```bash
# Open demo page
open https://demo.servalsheets.dev
```

### MCP Inspector

```bash
# Connect to demo server
npx @modelcontextprotocol/inspector https://demo.servalsheets.dev
```

### API Testing

```bash
# Read data
curl https://demo.servalsheets.dev/api/tools \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "sheets_data",
    "action": "read",
    "spreadsheetId": "DEMO_SHEET",
    "range": "Sales!A1:F10"
  }'
```

## Demo Landing Page

Create a simple landing page at `/`:

```html
<!DOCTYPE html>
<html>
  <head>
    <title>ServalSheets Demo</title>
    <style>
      /* Modern, clean design */
    </style>
  </head>
  <body>
    <h1>ServalSheets Demo</h1>
    <p>Try the MCP Google Sheets server without installation.</p>

    <h2>Quick Start</h2>
    <pre>npx @modelcontextprotocol/inspector https://demo.servalsheets.dev</pre>

    <h2>Available Operations</h2>
    <ul>
      <li>Read spreadsheet data</li>
      <li>Analyze data patterns</li>
      <li>Get AI recommendations</li>
    </ul>

    <h2>Limitations</h2>
    <ul>
      <li>Read-only access</li>
      <li>30 requests/minute rate limit</li>
      <li>Sample data only</li>
    </ul>

    <a href="https://github.com/khill1269/servalsheets"> Install for full access → </a>
  </body>
</html>
```

## Analytics

Track demo usage with:

- Request counts by tool/action
- Geographic distribution
- Conversion to installation

Add to Cloud Run:

```bash
gcloud run services update servalsheets-demo \
  --set-env-vars="ANALYTICS_ENABLED=true,GA_TRACKING_ID=UA-XXXXX-Y"
```

## Cost Estimation

Cloud Run with minimal usage:

- **Requests:** ~10,000/month = ~$0.40
- **CPU:** ~100 vCPU-seconds/day = ~$2/month
- **Memory:** ~50 GiB-seconds/day = ~$0.50/month
- **Total:** ~$3-5/month for low-traffic demo

## Security Considerations

1. **Read-only service account** - Cannot modify any data
2. **Rate limiting** - Prevents abuse
3. **No PII** - Sample data only
4. **Monitoring** - Alert on unusual activity
5. **Separate project** - Isolated from production

## Maintenance

### Update demo data

```bash
# Update sample spreadsheet
gcloud run deploy servalsheets-demo \
  --set-env-vars="DEMO_SPREADSHEET_VERSION=v2"
```

### View logs

```bash
gcloud run services logs read servalsheets-demo --region $REGION
```

### Check usage

```bash
gcloud run services describe servalsheets-demo \
  --region $REGION \
  --format="value(status.traffic)"
```
