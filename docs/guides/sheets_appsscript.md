---
title: Google Apps Script Integration Guide
category: guide
last_updated: 2026-01-31
description: 'Tool: sheetsappsscript'
version: 1.6.0
audience: user
difficulty: intermediate
---

# Google Apps Script Integration Guide

**Tool**: `sheets_appsscript`
**Purpose**: Create, manage, and execute Apps Script projects programmatically
**Version**: 1.6.0
**Last Updated**: 2026-01-30

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication Requirements](#authentication-requirements)
3. [Actions](#actions)
4. [Common Workflows](#common-workflows)
5. [Best Practices](#best-practices)
6. [Troubleshooting](#troubleshooting)

---

## Overview

The `sheets_appsscript` tool provides programmatic access to Google Apps Script projects. You can create scripts, manage versions, deploy as web apps or APIs, and execute functions.

### What is Apps Script?

**Google Apps Script** is JavaScript-based cloud scripting that lets you extend and automate Google Workspace applications (Sheets, Docs, Forms, etc.).

### Key Capabilities

- **Project Management**: Create standalone or container-bound scripts
- **Version Control**: Create immutable version snapshots with descriptions
- **Deployment**: Deploy as web apps (public/private) or API executables
- **Execution**: Run functions with parameters and get results
- **Monitoring**: Track execution processes and usage metrics

### Tool Annotations

| Property        | Value | Meaning                                   |
| --------------- | ----- | ----------------------------------------- |
| readOnlyHint    | false | Modifies Apps Script state                |
| destructiveHint | true  | Can undeploy or run side-effect functions |
| idempotentHint  | false | Function execution not idempotent         |
| openWorldHint   | true  | Calls Google Apps Script API              |

---

## Authentication Requirements

⚠️ **CRITICAL: OAuth User Authentication Required**

Unlike other ServalSheets tools, `sheets_appsscript` **DOES NOT WORK** with service accounts.

### Why OAuth is Required

Apps Script projects are owned by specific Google accounts. The Apps Script API requires:

- User consent for script management
- User identity for project ownership and execution context
- OAuth 2.0 authorization flow

### Required OAuth Scopes

```
https://www.googleapis.com/auth/script.projects
https://www.googleapis.com/auth/script.processes
https://www.googleapis.com/auth/script.deployments
https://www.googleapis.com/auth/script.metrics
```

### Setup Instructions

1. **Enable OAuth in ServalSheets:**

   ```bash
   # Start server with OAuth enabled
   npm run start:oauth
   # or
   node dist/http-server.js --enable-oauth
   ```

2. **Configure Google Cloud Project:**
   - Enable Apps Script API
   - Add OAuth consent screen
   - Add required scopes
   - Add authorized redirect URIs

3. **Complete OAuth Flow:**
   - Visit `/oauth/authorize` endpoint
   - Grant permissions
   - Receive access token

See [OAUTH_USER_SETUP.md](./OAUTH_USER_SETUP.md) for detailed instructions.

---

## Actions

### Project Management (4 actions)

#### `create` - Create New Apps Script Project

**Create a new standalone or container-bound script project.**

**Parameters:**

| Name      | Type    | Required | Description                                                 |
| --------- | ------- | -------- | ----------------------------------------------------------- |
| action    | literal | ✅       | `"create"`                                                  |
| title     | string  | ✅       | Project title (min 1 character)                             |
| parentId  | string  | ❌       | Parent file ID (Sheets/Docs/Forms/Slides) for bound scripts |
| verbosity | enum    | ✅       | Response detail level: `minimal`, `standard`, `detailed`    |

**Example - Standalone Script:**

```json
{
  "request": {
    "action": "create",
    "title": "My Data Processor",
    "verbosity": "standard"
  }
}
```

**Example - Container-Bound Script:**

```json
{
  "request": {
    "action": "create",
    "title": "Spreadsheet Automation",
    "parentId": "1A2B3C4D5E6F7G8H9I0J",
    "verbosity": "standard"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "create",
  "project": {
    "scriptId": "AKfycbz...",
    "title": "My Data Processor",
    "createTime": "2026-01-30T10:00:00Z",
    "updateTime": "2026-01-30T10:00:00Z"
  }
}
```

---

#### `get` - Get Project Metadata

**Retrieve metadata for an Apps Script project.**

**Parameters:**

| Name      | Type    | Required | Description           |
| --------- | ------- | -------- | --------------------- |
| action    | literal | ✅       | `"get"`               |
| scriptId  | string  | ✅       | Script project ID     |
| verbosity | enum    | ✅       | Response detail level |

**Example:**

```json
{
  "request": {
    "action": "get",
    "scriptId": "AKfycbz...",
    "verbosity": "standard"
  }
}
```

---

#### `get_content` - Get Script Source Code

**Retrieve all script files and their source code.**

**Parameters:**

| Name          | Type    | Required | Description                      |
| ------------- | ------- | -------- | -------------------------------- |
| action        | literal | ✅       | `"get_content"`                  |
| scriptId      | string  | ✅       | Script project ID                |
| versionNumber | number  | ❌       | Specific version (omit for HEAD) |
| verbosity     | enum    | ✅       | Response detail level            |

**Example:**

```json
{
  "request": {
    "action": "get_content",
    "scriptId": "AKfycbz...",
    "verbosity": "detailed"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "get_content",
  "files": [
    {
      "name": "Code",
      "type": "SERVER_JS",
      "source": "function myFunction() {\n  // code here\n}",
      "functionSet": {
        "values": [{ "name": "myFunction" }]
      }
    },
    {
      "name": "appsscript",
      "type": "JSON",
      "source": "{\"timeZone\": \"America/New_York\", \"dependencies\": {}}"
    }
  ]
}
```

---

#### `update_content` - Update Script Files

**Replace all script files with new content.**

⚠️ **Warning**: This action **replaces all files** in the project. Include all files you want to keep.

**Parameters:**

| Name      | Type    | Required | Description                   |
| --------- | ------- | -------- | ----------------------------- |
| action    | literal | ✅       | `"update_content"`            |
| scriptId  | string  | ✅       | Script project ID             |
| files     | array   | ✅       | Complete set of files (min 1) |
| verbosity | enum    | ✅       | Response detail level         |

**File Object:**

| Field  | Type   | Required | Description                       |
| ------ | ------ | -------- | --------------------------------- |
| name   | string | ✅       | File name (without .gs extension) |
| type   | enum   | ✅       | `SERVER_JS`, `HTML`, `JSON`       |
| source | string | ✅       | File content                      |

**Example:**

```json
{
  "request": {
    "action": "update_content",
    "scriptId": "AKfycbz...",
    "files": [
      {
        "name": "Code",
        "type": "SERVER_JS",
        "source": "function processData() {\n  Logger.log('Processing...');\n}"
      },
      {
        "name": "Helper",
        "type": "SERVER_JS",
        "source": "function helperFunction() {\n  return 'Helper';\n}"
      }
    ],
    "verbosity": "standard"
  }
}
```

---

### Version Management (3 actions)

#### `create_version` - Create Version Snapshot

**Create an immutable version of the current script state.**

**Parameters:**

| Name        | Type    | Required | Description           |
| ----------- | ------- | -------- | --------------------- |
| action      | literal | ✅       | `"create_version"`    |
| scriptId    | string  | ✅       | Script project ID     |
| description | string  | ❌       | Version description   |
| verbosity   | enum    | ✅       | Response detail level |

**Example:**

```json
{
  "request": {
    "action": "create_version",
    "scriptId": "AKfycbz...",
    "description": "Added data validation feature",
    "verbosity": "standard"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "create_version",
  "version": {
    "versionNumber": 5,
    "description": "Added data validation feature",
    "createTime": "2026-01-30T10:00:00Z"
  }
}
```

---

#### `list_versions` - List All Versions

**Get all version snapshots for a script project.**

**Parameters:**

| Name      | Type    | Required | Description                      |
| --------- | ------- | -------- | -------------------------------- |
| action    | literal | ✅       | `"list_versions"`                |
| scriptId  | string  | ✅       | Script project ID                |
| pageSize  | number  | ❌       | Max results (1-200, default: 50) |
| pageToken | string  | ❌       | Pagination token                 |
| verbosity | enum    | ✅       | Response detail level            |

**Example:**

```json
{
  "request": {
    "action": "list_versions",
    "scriptId": "AKfycbz...",
    "pageSize": 20,
    "verbosity": "standard"
  }
}
```

---

#### `get_version` - Get Specific Version

**Retrieve details of a specific version.**

**Parameters:**

| Name          | Type    | Required | Description                       |
| ------------- | ------- | -------- | --------------------------------- |
| action        | literal | ✅       | `"get_version"`                   |
| scriptId      | string  | ✅       | Script project ID                 |
| versionNumber | number  | ✅       | Version number (positive integer) |
| verbosity     | enum    | ✅       | Response detail level             |

**Example:**

```json
{
  "request": {
    "action": "get_version",
    "scriptId": "AKfycbz...",
    "versionNumber": 3,
    "verbosity": "standard"
  }
}
```

---

### Deployment Management (4 actions)

#### `deploy` - Create Deployment

**Deploy a script as a web app or API executable.**

**Parameters:**

| Name           | Type    | Required | Description                                                          |
| -------------- | ------- | -------- | -------------------------------------------------------------------- |
| action         | literal | ✅       | `"deploy"`                                                           |
| scriptId       | string  | ✅       | Script project ID                                                    |
| versionNumber  | number  | ❌       | Version to deploy (creates new if omitted)                           |
| description    | string  | ❌       | Deployment description                                               |
| deploymentType | enum    | ❌       | `WEB_APP`, `EXECUTION_API` (default: `EXECUTION_API`)                |
| access         | enum    | ❌       | `MYSELF`, `DOMAIN`, `ANYONE`, `ANYONE_ANONYMOUS` (default: `MYSELF`) |
| executeAs      | enum    | ❌       | `USER_ACCESSING`, `USER_DEPLOYING` (default: `USER_DEPLOYING`)       |
| verbosity      | enum    | ✅       | Response detail level                                                |

**Access Levels:**

- `MYSELF`: Only you can access
- `DOMAIN`: Anyone in your Google Workspace domain
- `ANYONE`: Anyone with a Google account
- `ANYONE_ANONYMOUS`: Public access (no login required)

**Execute As:**

- `USER_DEPLOYING`: Script runs as you (your permissions)
- `USER_ACCESSING`: Script runs as end user (their permissions)

**Example - API Executable (Private):**

```json
{
  "request": {
    "action": "deploy",
    "scriptId": "AKfycbz...",
    "versionNumber": 5,
    "description": "Production API v1.2",
    "deploymentType": "EXECUTION_API",
    "access": "MYSELF",
    "executeAs": "USER_DEPLOYING",
    "verbosity": "standard"
  }
}
```

**Example - Public Web App:**

```json
{
  "request": {
    "action": "deploy",
    "scriptId": "AKfycbz...",
    "deploymentType": "WEB_APP",
    "access": "ANYONE_ANONYMOUS",
    "executeAs": "USER_DEPLOYING",
    "verbosity": "standard"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "deploy",
  "deployment": {
    "deploymentId": "AKfycby...",
    "deploymentConfig": {
      "scriptId": "AKfycbz...",
      "versionNumber": 5,
      "description": "Production API v1.2"
    }
  },
  "webAppUrl": "https://script.google.com/macros/s/AKfycby.../exec"
}
```

---

#### `list_deployments` - List All Deployments

**Get all deployments for a script project.**

**Parameters:**

| Name      | Type    | Required | Description                      |
| --------- | ------- | -------- | -------------------------------- |
| action    | literal | ✅       | `"list_deployments"`             |
| scriptId  | string  | ✅       | Script project ID                |
| pageSize  | number  | ❌       | Max results (1-200, default: 50) |
| pageToken | string  | ❌       | Pagination token                 |
| verbosity | enum    | ✅       | Response detail level            |

**Example:**

```json
{
  "request": {
    "action": "list_deployments",
    "scriptId": "AKfycbz...",
    "verbosity": "standard"
  }
}
```

---

#### `get_deployment` - Get Deployment Details

**Retrieve details of a specific deployment.**

**Parameters:**

| Name         | Type    | Required | Description           |
| ------------ | ------- | -------- | --------------------- |
| action       | literal | ✅       | `"get_deployment"`    |
| scriptId     | string  | ✅       | Script project ID     |
| deploymentId | string  | ✅       | Deployment ID         |
| verbosity    | enum    | ✅       | Response detail level |

**Example:**

```json
{
  "request": {
    "action": "get_deployment",
    "scriptId": "AKfycbz...",
    "deploymentId": "AKfycby...",
    "verbosity": "standard"
  }
}
```

---

#### `undeploy` - Delete Deployment

**Remove a deployment (does not delete the version).**

**Parameters:**

| Name         | Type    | Required | Description             |
| ------------ | ------- | -------- | ----------------------- |
| action       | literal | ✅       | `"undeploy"`            |
| scriptId     | string  | ✅       | Script project ID       |
| deploymentId | string  | ✅       | Deployment ID to delete |
| verbosity    | enum    | ✅       | Response detail level   |

**Example:**

```json
{
  "request": {
    "action": "undeploy",
    "scriptId": "AKfycbz...",
    "deploymentId": "AKfycby...",
    "verbosity": "standard"
  }
}
```

---

### Execution (3 actions)

#### `run` - Execute Function

**Run a function in an Apps Script project.**

⚠️ **Important**: Function must be deployed (or use devMode for owner).

**Parameters:**

| Name         | Type    | Required | Description                                        |
| ------------ | ------- | -------- | -------------------------------------------------- |
| action       | literal | ✅       | `"run"`                                            |
| scriptId     | string  | ✅       | Script project ID                                  |
| functionName | string  | ✅       | Function name to execute                           |
| parameters   | array   | ❌       | Function arguments (basic types only)              |
| devMode      | boolean | ❌       | Run latest saved code (owner only, default: false) |
| verbosity    | enum    | ✅       | Response detail level                              |

**Supported Parameter Types:**

- Strings
- Numbers
- Booleans
- Arrays
- Objects (plain JSON)

**Not Supported:**

- Functions
- Dates (use ISO strings instead)
- undefined (use null)

**Example - No Parameters:**

```json
{
  "request": {
    "action": "run",
    "scriptId": "AKfycbz...",
    "functionName": "generateReport",
    "verbosity": "standard"
  }
}
```

**Example - With Parameters:**

```json
{
  "request": {
    "action": "run",
    "scriptId": "AKfycbz...",
    "functionName": "processSheet",
    "parameters": ["1A2B3C4D5E6F7G8H9I0J", "Sheet1", { "mode": "full", "notify": true }],
    "verbosity": "standard"
  }
}
```

**Example - Dev Mode (Owner Only):**

```json
{
  "request": {
    "action": "run",
    "scriptId": "AKfycbz...",
    "functionName": "testNewFeature",
    "devMode": true,
    "verbosity": "standard"
  }
}
```

**Response - Success:**

```json
{
  "success": true,
  "action": "run",
  "result": {
    "processedRows": 150,
    "status": "completed"
  }
}
```

**Response - Script Error:**

```json
{
  "success": true,
  "action": "run",
  "result": null,
  "executionError": {
    "errorMessage": "Cannot read property 'length' of undefined",
    "errorType": "TypeError",
    "scriptStackTraceElements": [
      { "function": "processData", "lineNumber": 42 },
      { "function": "main", "lineNumber": 10 }
    ]
  }
}
```

---

#### `list_processes` - List Execution Logs

**Get execution history and logs.**

**Parameters:**

| Name          | Type    | Required | Description                                                                                |
| ------------- | ------- | -------- | ------------------------------------------------------------------------------------------ |
| action        | literal | ✅       | `"list_processes"`                                                                         |
| scriptId      | string  | ❌       | Filter by script (omit for all your scripts)                                               |
| functionName  | string  | ❌       | Filter by function name                                                                    |
| processType   | enum    | ❌       | `EDITOR`, `SIMPLE_TRIGGER`, `TRIGGER`, `WEBAPP`, `API_EXECUTABLE`, `ADD_ON`, `TIME_DRIVEN` |
| processStatus | enum    | ❌       | `COMPLETED`, `FAILED`, `RUNNING`, `CANCELED`, `TIMED_OUT`                                  |
| pageSize      | number  | ❌       | Max results (1-200, default: 50)                                                           |
| pageToken     | string  | ❌       | Pagination token                                                                           |
| verbosity     | enum    | ✅       | Response detail level                                                                      |

**Example - Recent Failures:**

```json
{
  "request": {
    "action": "list_processes",
    "scriptId": "AKfycbz...",
    "processStatus": "FAILED",
    "pageSize": 10,
    "verbosity": "detailed"
  }
}
```

**Example - All API Executions:**

```json
{
  "request": {
    "action": "list_processes",
    "scriptId": "AKfycbz...",
    "processType": "API_EXECUTABLE",
    "verbosity": "standard"
  }
}
```

---

#### `get_metrics` - Get Usage Metrics

**Retrieve usage statistics for a script project.**

**Parameters:**

| Name         | Type    | Required | Description                           |
| ------------ | ------- | -------- | ------------------------------------- |
| action       | literal | ✅       | `"get_metrics"`                       |
| scriptId     | string  | ✅       | Script project ID                     |
| granularity  | enum    | ❌       | `DAILY`, `WEEKLY` (default: `WEEKLY`) |
| deploymentId | string  | ❌       | Filter by deployment                  |
| verbosity    | enum    | ✅       | Response detail level                 |

**Example:**

```json
{
  "request": {
    "action": "get_metrics",
    "scriptId": "AKfycbz...",
    "granularity": "DAILY",
    "verbosity": "standard"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "get_metrics",
  "metrics": {
    "activeUsers": [{ "value": "12" }, { "value": "15" }, { "value": "18" }],
    "totalExecutions": [{ "value": "450" }, { "value": "520" }, { "value": "610" }],
    "failedExecutions": [{ "value": "3" }, { "value": "1" }, { "value": "2" }]
  }
}
```

---

## Common Workflows

### Workflow 1: Create and Deploy a New Script

**Goal**: Create a standalone script, add code, version it, and deploy as API executable.

**Steps:**

1. **Create project:**

```json
{
  "request": {
    "action": "create",
    "title": "Data Processor API",
    "verbosity": "standard"
  }
}
```

1. **Add script code:**

```json
{
  "request": {
    "action": "update_content",
    "scriptId": "AKfycbz...",
    "files": [
      {
        "name": "Code",
        "type": "SERVER_JS",
        "source": "function processData(data) {\n  return data.map(x => x * 2);\n}"
      }
    ],
    "verbosity": "standard"
  }
}
```

1. **Create version:**

```json
{
  "request": {
    "action": "create_version",
    "scriptId": "AKfycbz...",
    "description": "Initial release v1.0",
    "verbosity": "standard"
  }
}
```

1. **Deploy as API:**

```json
{
  "request": {
    "action": "deploy",
    "scriptId": "AKfycbz...",
    "versionNumber": 1,
    "deploymentType": "EXECUTION_API",
    "access": "MYSELF",
    "verbosity": "standard"
  }
}
```

1. **Test execution:**

```json
{
  "request": {
    "action": "run",
    "scriptId": "AKfycbz...",
    "functionName": "processData",
    "parameters": [[1, 2, 3, 4, 5]],
    "verbosity": "standard"
  }
}
```

---

### Workflow 2: Update Existing Script

**Goal**: Modify code, create new version, and update deployment.

**Steps:**

1. **Get current code:**

```json
{
  "request": {
    "action": "get_content",
    "scriptId": "AKfycbz...",
    "verbosity": "detailed"
  }
}
```

1. **Update code:**

```json
{
  "request": {
    "action": "update_content",
    "scriptId": "AKfycbz...",
    "files": [
      {
        "name": "Code",
        "type": "SERVER_JS",
        "source": "function processData(data) {\n  // Enhanced version\n  return data.map(x => x * 2).filter(x => x > 0);\n}"
      }
    ],
    "verbosity": "standard"
  }
}
```

1. **Create new version:**

```json
{
  "request": {
    "action": "create_version",
    "scriptId": "AKfycbz...",
    "description": "Added filtering logic v1.1",
    "verbosity": "standard"
  }
}
```

1. **Deploy new version:**

```json
{
  "request": {
    "action": "deploy",
    "scriptId": "AKfycbz...",
    "versionNumber": 2,
    "description": "Production deployment v1.1",
    "deploymentType": "EXECUTION_API",
    "access": "MYSELF",
    "verbosity": "standard"
  }
}
```

1. **Undeploy old version (optional):**

```json
{
  "request": {
    "action": "undeploy",
    "scriptId": "AKfycbz...",
    "deploymentId": "AKfycby_old...",
    "verbosity": "standard"
  }
}
```

---

### Workflow 3: Container-Bound Script for Sheets

**Goal**: Create a script bound to a specific spreadsheet.

**Steps:**

1. **Create bound script:**

```json
{
  "request": {
    "action": "create",
    "title": "Spreadsheet Automation",
    "parentId": "1A2B3C4D5E6F7G8H9I0J",
    "verbosity": "standard"
  }
}
```

1. **Add code with Sheets operations:**

```json
{
  "request": {
    "action": "update_content",
    "scriptId": "AKfycbz...",
    "files": [
      {
        "name": "Code",
        "type": "SERVER_JS",
        "source": "function onEdit(e) {\n  var sheet = e.source.getActiveSheet();\n  var range = e.range;\n  // Custom logic here\n}\n\nfunction customMenu() {\n  SpreadsheetApp.getUi()\n    .createMenu('Custom')\n    .addItem('Run Process', 'processData')\n    .addToUi();\n}\n\nfunction processData() {\n  var ss = SpreadsheetApp.getActiveSpreadsheet();\n  var sheet = ss.getActiveSheet();\n  // Processing logic\n}"
      }
    ],
    "verbosity": "standard"
  }
}
```

1. **Test in dev mode:**

```json
{
  "request": {
    "action": "run",
    "scriptId": "AKfycbz...",
    "functionName": "processData",
    "devMode": true,
    "verbosity": "detailed"
  }
}
```

---

### Workflow 4: Monitor Script Health

**Goal**: Check recent executions and error rates.

**Steps:**

1. **Get recent processes:**

```json
{
  "request": {
    "action": "list_processes",
    "scriptId": "AKfycbz...",
    "pageSize": 50,
    "verbosity": "standard"
  }
}
```

1. **Check for failures:**

```json
{
  "request": {
    "action": "list_processes",
    "scriptId": "AKfycbz...",
    "processStatus": "FAILED",
    "pageSize": 20,
    "verbosity": "detailed"
  }
}
```

1. **Get usage metrics:**

```json
{
  "request": {
    "action": "get_metrics",
    "scriptId": "AKfycbz...",
    "granularity": "DAILY",
    "verbosity": "standard"
  }
}
```

---

## Best Practices

### Development Workflow

1. **Always version before deploying**
   - Create immutable versions with descriptive messages
   - Never deploy HEAD directly in production

2. **Use dev mode for testing**
   - Test with `devMode: true` before creating versions
   - Only project owner can use dev mode

3. **Version numbering convention**
   - Use semantic versioning in descriptions
   - Example: "v1.2.3 - Fixed calculation bug"

### Deployment Strategy

1. **Separate environments**
   - Use different deployments for dev/staging/prod
   - Different access levels per environment

2. **Gradual rollout**
   - Deploy to yourself first (`MYSELF`)
   - Then to domain (`DOMAIN`)
   - Finally public if needed (`ANYONE`)

3. **Keep old deployments temporarily**
   - Don't undeploy immediately
   - Keep previous version for quick rollback

### Security

1. **Minimize access levels**
   - Use `MYSELF` for personal automation
   - Use `DOMAIN` for workspace tools
   - Avoid `ANYONE_ANONYMOUS` unless truly public

2. **Execute as deploying user**
   - Use `executeAs: USER_DEPLOYING` for controlled permissions
   - Avoid `USER_ACCESSING` unless specifically needed

3. **Review execution logs**
   - Monitor for unexpected usage patterns
   - Check failed executions regularly

### Code Management

1. **Include all files in updates**
   - `update_content` replaces ALL files
   - Always include appsscript.json manifest

2. **Basic parameter types only**
   - Pass simple JSON-serializable data
   - Convert complex types to strings/objects

3. **Handle errors in script**
   - Use try-catch in Apps Script functions
   - Return error objects instead of throwing

### Monitoring

1. **Set up regular metric checks**
   - Weekly metrics review
   - Alert on failure rate spikes

2. **Monitor execution duration**
   - Apps Script has 6-minute execution limit
   - Break long operations into smaller chunks

3. **Track active users**
   - Understand usage patterns
   - Plan for capacity

---

## Troubleshooting

### Common Issues

#### Issue: "Authentication Required"

**Cause**: Using service account instead of OAuth user auth

**Solution**:

1. Enable OAuth mode: `npm run start:oauth`
2. Complete OAuth flow in browser
3. Use user access token (not service account)

---

#### Issue: "Script not found"

**Cause**: Invalid scriptId or no access to project

**Solution**:

1. Verify scriptId is correct
2. Check you're authenticated as project owner or editor
3. Ensure script wasn't deleted

---

#### Issue: "Deployment configuration invalid"

**Cause**: Incompatible deployment settings

**Solution**:

- `WEB_APP` requires `access` and `executeAs` settings
- `EXECUTION_API` only works with deployed versions
- Cannot use `devMode` with API executables

---

#### Issue: "Function not found"

**Cause**: Function doesn't exist or isn't deployed

**Solution**:

1. Verify function name spelling (case-sensitive)
2. Ensure function is in deployed version
3. Use `devMode: true` for testing latest code

---

#### Issue: "Execution failed with script error"

**Cause**: Runtime error in Apps Script code

**Solution**:

1. Check `executionError` in response for details
2. Review `scriptStackTraceElements` for line numbers
3. Test function with `devMode: true` for debugging
4. Use `Logger.log()` in script for debugging output

---

#### Issue: "Quota exceeded"

**Cause**: Hit Apps Script API or execution quotas

**Quotas:**

- Apps Script API: 100 requests/100 seconds/user
- Script execution: 90 minutes/day for consumer accounts, 6 hours/day for Workspace
- Email: 100/day (consumer), unlimited (Workspace)

**Solution**:

1. Implement rate limiting
2. Use batch operations where possible
3. Consider Workspace account for higher quotas
4. Use `list_processes` to monitor quota usage

---

#### Issue: "Parameters not passed correctly"

**Cause**: Unsupported parameter types or serialization issues

**Solution**:

- Only use: strings, numbers, booleans, arrays, plain objects
- Convert dates to ISO strings
- Convert undefined to null
- Flatten complex objects

**Example - Converting Date:**

```javascript
// ❌ Wrong
parameters: [new Date()];

// ✅ Correct
parameters: ['2026-01-30T10:00:00Z'];
```

---

### Getting Help

1. **Check execution logs:**

   ```json
   {
     "request": {
       "action": "list_processes",
       "scriptId": "AKfycbz...",
       "processStatus": "FAILED",
       "verbosity": "detailed"
     }
   }
   ```

2. **Review Apps Script documentation:**
   - [Apps Script Reference](https://developers.google.com/apps-script/reference)
   - [Apps Script API](https://developers.google.com/apps-script/api)

3. **ServalSheets documentation:**
   - [Error Handling Guide](./ERROR_HANDLING.md)
   - [OAuth Setup Guide](./OAUTH_USER_SETUP.md)
   - [Troubleshooting Guide](./TROUBLESHOOTING.md)

---

## Additional Resources

- **Apps Script Editor**: https://script.google.com
- **Apps Script API Reference**: https://developers.google.com/apps-script/api/reference/rest
- **OAuth 2.0 Setup**: [OAUTH_USER_SETUP.md](./OAUTH_USER_SETUP.md)
- **ServalSheets Source**: [src/schemas/appsscript.ts](../../src/schemas/appsscript.ts)
- **Handler Implementation**: [src/handlers/appsscript.ts](../../src/handlers/appsscript.ts)

---

**Last Updated**: 2026-01-30 (v1.6.0)
