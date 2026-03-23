# Google Cloud Console MCP Server

MCP server for managing Google Cloud resources, APIs, IAM, and monitoring for ServalSheets deployment.

## Features

- ✅ **Project Management** - List and get Google Cloud project details
- ✅ **API Management** - List enabled APIs, enable new services
- ✅ **Quota Monitoring** - Get quota limits and usage
- ✅ **IAM Policies** - List and validate IAM permissions
- ✅ **Cloud Logging** - Fetch logs with filters
- ✅ **Cloud Monitoring** - Get metrics and time series data
- ✅ **Permission Validation** - Verify service account has required permissions

## Prerequisites

### Authentication Setup

**Option 1: Application Default Credentials (Recommended)**

```bash
gcloud auth application-default login
```

**Option 2: Service Account Key**

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
```

### Required IAM Roles

Service account needs these roles:

- `roles/resourcemanager.projectViewer` - View projects
- `roles/serviceusage.serviceUsageViewer` - View enabled APIs
- `roles/serviceusage.serviceUsageAdmin` - Enable APIs (if needed)
- `roles/iam.securityReviewer` - View IAM policies
- `roles/logging.viewer` - View logs
- `roles/monitoring.viewer` - View metrics

## Installation

```bash
cd tools/gcloud-console-server
npm install
npm run build
```

## Configuration

Add to Claude Desktop config (`~/.config/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gcloud-console": {
      "command": "node",
      "args": ["/absolute/path/to/tools/gcloud-console-server/dist/index.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/service-account-key.json"
      }
    }
  }
}
```

Or use Application Default Credentials (no env var needed):

```json
{
  "mcpServers": {
    "gcloud-console": {
      "command": "node",
      "args": ["/absolute/path/to/tools/gcloud-console-server/dist/index.js"]
    }
  }
}
```

Enable in project settings (`.claude/settings.local.json`):

```json
{
  "enabledMcpjsonServers": ["servalsheets", "google-docs", "test-intelligence", "gcloud-console"]
}
```

## Tools Provided

### 1. `gcloud_list_projects`

List Google Cloud projects accessible with current credentials.

**Input:**

```json
{
  "parent": "organizations/123456", // Optional
  "pageSize": 50 // Optional, default: 50
}
```

**Output:**

```json
{
  "projects": [
    {
      "projectId": "my-project",
      "displayName": "My Project",
      "state": "ACTIVE",
      "createTime": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### 2. `gcloud_get_project`

Get details for a specific Google Cloud project.

**Input:**

```json
{
  "projectId": "my-project"
}
```

**Output:**

```json
{
  "project": {
    "projectId": "my-project",
    "displayName": "My Project",
    "projectNumber": "123456789",
    "state": "ACTIVE",
    "createTime": "2024-01-01T00:00:00Z",
    "labels": { "env": "production" }
  }
}
```

### 3. `gcloud_list_enabled_apis`

List enabled APIs and services for a project.

**Input:**

```json
{
  "projectId": "my-project",
  "filter": "sheets" // Optional: filter by service name
}
```

**Output:**

```json
{
  "enabledAPIs": [
    {
      "name": "sheets.googleapis.com",
      "title": "Google Sheets API",
      "state": "ENABLED"
    },
    {
      "name": "drive.googleapis.com",
      "title": "Google Drive API",
      "state": "ENABLED"
    }
  ],
  "servalSheetsRelevant": [...]  // APIs relevant for ServalSheets
}
```

### 4. `gcloud_enable_api`

Enable a Google Cloud API or service for a project.

**Input:**

```json
{
  "projectId": "my-project",
  "serviceName": "sheets.googleapis.com"
}
```

**Output:**

```json
{
  "success": true,
  "serviceName": "sheets.googleapis.com",
  "projectId": "my-project"
}
```

### 5. `gcloud_get_quotas`

Get quota limits and usage for a Google Cloud service.

**Input:**

```json
{
  "projectId": "my-project",
  "serviceName": "sheets.googleapis.com"
}
```

**Output:**

```json
{
  "service": "sheets.googleapis.com",
  "quotaInfo": {
    "limits": [
      {
        "name": "Read requests per day",
        "defaultLimit": 500,
        "values": {...}
      }
    ]
  }
}
```

### 6. `gcloud_list_iam_policies`

List IAM policies and roles for a project.

**Input:**

```json
{
  "projectId": "my-project",
  "resourceType": "project" // Optional, default: "project"
}
```

**Output:**

```json
{
  "projectId": "my-project",
  "bindings": [
    {
      "role": "roles/owner",
      "members": ["user:admin@example.com"]
    },
    {
      "role": "roles/editor",
      "members": ["serviceAccount:my-sa@project.iam.gserviceaccount.com"]
    }
  ]
}
```

### 7. `gcloud_get_logs`

Get Cloud Logging logs for a project.

**Input:**

```json
{
  "projectId": "my-project",
  "filter": "severity>=ERROR", // Optional
  "pageSize": 100, // Optional, default: 100
  "orderBy": "timestamp desc" // Optional, default: "timestamp desc"
}
```

**Output:**

```json
{
  "logEntries": [
    {
      "timestamp": "2024-02-17T10:00:00Z",
      "severity": "ERROR",
      "logName": "projects/my-project/logs/cloudaudit.googleapis.com%2Factivity",
      "textPayload": "Error message here",
      "jsonPayload": {...}
    }
  ],
  "totalCount": 100
}
```

**Common Filters:**

- `severity>=ERROR` - Only errors
- `resource.type=gce_instance` - Specific resource type
- `timestamp>="2024-02-17T00:00:00Z"` - Time range
- `jsonPayload.message:~"pattern"` - Regex search

### 8. `gcloud_get_metrics`

Get Cloud Monitoring metrics for a project.

**Input:**

```json
{
  "projectId": "my-project",
  "metricType": "sheets.googleapis.com/quota/read_requests",
  "startTime": "2024-02-17T09:00:00Z", // Optional, default: 1 hour ago
  "endTime": "2024-02-17T10:00:00Z" // Optional, default: now
}
```

**Output:**

```json
{
  "metricType": "sheets.googleapis.com/quota/read_requests",
  "timeSeries": [
    {
      "metric": {...},
      "resource": {...},
      "points": [
        {
          "interval": {"endTime": "2024-02-17T10:00:00Z"},
          "value": {"int64Value": "1234"}
        }
      ]
    }
  ]
}
```

**Common Metrics:**

- `sheets.googleapis.com/quota/read_requests` - Sheets read requests
- `sheets.googleapis.com/quota/write_requests` - Sheets write requests
- `drive.googleapis.com/quota/read_bytes` - Drive read bytes
- `compute.googleapis.com/instance/cpu/utilization` - CPU usage

### 9. `gcloud_validate_permissions`

Validate if service account has required permissions for ServalSheets.

**Input:**

```json
{
  "projectId": "my-project",
  "permissions": ["sheets.spreadsheets.get", "sheets.spreadsheets.update", "drive.files.get"]
}
```

**Output:**

```json
{
  "projectId": "my-project",
  "requestedPermissions": [...],
  "grantedPermissions": ["sheets.spreadsheets.get", "sheets.spreadsheets.update"],
  "missingPermissions": ["drive.files.get"],
  "hasAllPermissions": false
}
```

## Usage Examples

### Example 1: Setup New Project for ServalSheets

```bash
# 1. List available projects
claude-code "Use gcloud_list_projects to find my Google Cloud projects"

# 2. Get project details
claude-code "Use gcloud_get_project for project 'my-servalsheets-project'"

# 3. Check enabled APIs
claude-code "Use gcloud_list_enabled_apis to see what APIs are enabled for 'my-servalsheets-project'"

# 4. Enable required APIs
claude-code "Use gcloud_enable_api to enable sheets.googleapis.com for 'my-servalsheets-project'"
claude-code "Use gcloud_enable_api to enable drive.googleapis.com for 'my-servalsheets-project'"

# 5. Validate permissions
claude-code "Use gcloud_validate_permissions to check if I have all required Sheets API permissions"
```

### Example 2: Monitor ServalSheets Production

```bash
# Check quota usage
claude-code "Use gcloud_get_metrics to get Sheets API quota usage for the last hour"

# Check for errors
claude-code "Use gcloud_get_logs with filter='severity>=ERROR' to find recent errors"

# Review IAM policies
claude-code "Use gcloud_list_iam_policies to see who has access to the project"
```

### Example 3: Troubleshoot API Issues

```bash
# 1. Check if API is enabled
claude-code "Use gcloud_list_enabled_apis with filter='sheets' to verify Sheets API is enabled"

# 2. Check quota limits
claude-code "Use gcloud_get_quotas for 'sheets.googleapis.com' to see if we're hitting limits"

# 3. Check recent logs
claude-code "Use gcloud_get_logs with filter='resource.type=sheets.googleapis.com' to see Sheets API logs"

# 4. Validate permissions
claude-code "Use gcloud_validate_permissions to check if service account has required permissions"
```

## Integration with ServalSheets

### Pre-Deployment Checklist

Use `gcloud-console-server` to verify setup before deploying ServalSheets:

```bash
# 1. Verify project exists and is active
gcloud_get_project { "projectId": "my-project" }

# 2. Check required APIs are enabled
gcloud_list_enabled_apis { "projectId": "my-project" }
# Should see: sheets.googleapis.com, drive.googleapis.com, bigquery.googleapis.com

# 3. Enable missing APIs
gcloud_enable_api { "projectId": "my-project", "serviceName": "sheets.googleapis.com" }

# 4. Validate service account permissions
gcloud_validate_permissions {
  "projectId": "my-project",
  "permissions": [
    "sheets.spreadsheets.get",
    "sheets.spreadsheets.update",
    "drive.files.get"
  ]
}

# 5. Check IAM policies
gcloud_list_iam_policies { "projectId": "my-project" }
```

### Production Monitoring

Set up periodic checks:

```bash
# Daily quota check
gcloud_get_metrics {
  "projectId": "my-project",
  "metricType": "sheets.googleapis.com/quota/read_requests",
  "startTime": "24 hours ago",
  "endTime": "now"
}

# Error log check
gcloud_get_logs {
  "projectId": "my-project",
  "filter": "severity>=ERROR AND timestamp>=\"24 hours ago\"",
  "pageSize": 100
}
```

## Troubleshooting

### Authentication Errors

**Problem:** `Error: Could not load the default credentials`

**Solution:**

```bash
# Set up Application Default Credentials
gcloud auth application-default login

# Or set service account key
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"
```

### Permission Denied

**Problem:** `Error: Permission denied on resource project`

**Solution:**

```bash
# Grant required IAM roles
gcloud projects add-iam-policy-binding my-project \
  --member="serviceAccount:my-sa@my-project.iam.gserviceaccount.com" \
  --role="roles/resourcemanager.projectViewer"
```

### API Not Enabled

**Problem:** `Error: API [sheets.googleapis.com] not enabled`

**Solution:**

```bash
# Use gcloud_enable_api tool
{"projectId": "my-project", "serviceName": "sheets.googleapis.com"}

# Or via gcloud CLI
gcloud services enable sheets.googleapis.com --project=my-project
```

## Performance

- **Project list:** ~500ms
- **Get project:** ~200ms
- **List APIs:** ~800ms
- **Enable API:** ~5-10 seconds (async operation)
- **Get logs:** ~1-3 seconds (depends on filter)
- **Get metrics:** ~1-2 seconds

## Cost

**Agent Cost:** $3-8 per task (Sonnet model)
**When to use:**

- Project setup and configuration
- Permission troubleshooting
- Quota monitoring
- Log analysis
- API management

**API Costs:** All Cloud Console API calls are **free** (no charges for Resource Manager, Service Usage, IAM, Logging, Monitoring read operations)

## Security

- Uses Application Default Credentials or service account key
- Supports least-privilege IAM (read-only roles recommended)
- No credentials stored in server code
- All API calls authenticated via Google Auth Library

## License

MIT

---

**Last Updated:** 2026-02-17 | **Version:** 1.0.0 | **Protocol:** MCP 2025-11-25
