---
title: Smart Chips Guide
category: guide
last_updated: 2026-01-31
description: 'Tool: sheetsadvanced (chip actions)'
version: 1.6.0
tags: [sheets]
audience: user
difficulty: intermediate
---

# Smart Chips Guide

**Tool**: `sheets_advanced` (chip actions)
**API**: Google Sheets chipRuns (June 2025)
**Version**: 1.6.0
**Last Updated**: 2026-01-30

---

## Table of Contents

1. [Overview](#overview)
2. [Chip Types](#chip-types)
3. [Actions](#actions)
4. [Examples](#examples)
5. [API Details](#api-details)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Overview

**Smart chips** are interactive, rich elements in Google Sheets that link to people, files, or external resources. They provide contextual information and quick actions directly in cells.

### What Are Smart Chips?

Smart chips are special cell values that:

- Display as interactive badges with icons
- Show preview information on hover
- Link to external resources (people, Drive files, websites)
- Support programmatic creation via the chipRuns API

### Supported Chip Types

| Type          | Description                  | Example             |
| ------------- | ---------------------------- | ------------------- |
| **Person**    | @mention a person by email   | `@user@example.com` |
| **Drive**     | Link to Google Drive file    | 🔗 `My Document`    |
| **Rich Link** | Link to any URL with preview | 🌐 `example.com`    |

### chipRuns API (June 2025)

ServalSheets uses the **official chipRuns API** introduced in June 2025. This replaces the legacy approach of using `textFormatRuns` with `link.uri`.

**Key Differences:**

- ✅ **New**: Uses `chipRuns` field with `personProperties`, `richLinkProperties`
- ❌ **Old**: Used `textFormatRuns` with `link.uri` (deprecated)

---

## Chip Types

### 1. Person Chips

Link to a person by email address, creating an interactive @mention.

**Visual Appearance:**

- Icon: Profile picture or initials
- Text: Person's name (from Google Workspace directory)
- Hover: Shows email, role, and quick contact actions

**Properties:**

- `email` (required) - Email address
- `displayFormat` - How to show the chip:
  - `DEFAULT` - Smart format based on context
  - `FULL` - Full name and email
  - `NAME_ONLY` - Just the person's name

**Use Cases:**

- Assign tasks to team members
- Track document ownership
- Create approval workflows
- Build contact lists

### 2. Drive Chips

Link to a Google Drive file (document, spreadsheet, presentation, etc.).

**Visual Appearance:**

- Icon: File type icon (📄 doc, 📊 sheet, 📁 folder)
- Text: File title from Drive
- Hover: Shows file metadata, last modified, sharing status

**Properties:**

- `fileId` (required) - Google Drive file ID
- `displayText` (optional) - Custom display text

**Use Cases:**

- Link to supporting documents
- Track file dependencies
- Create document indexes
- Reference related spreadsheets

**Note:** Drive chips are implemented as rich link chips with Drive URIs (`https://drive.google.com/file/d/{fileId}/view`).

### 3. Rich Link Chips

Link to any URL with automatic preview metadata.

**Visual Appearance:**

- Icon: Website favicon or generic link icon
- Text: Page title or hostname
- Hover: Shows URL, description, preview image

**Properties:**

- `uri` (required) - Full URL (must be valid)
- `displayText` (optional) - Custom display text

**Use Cases:**

- Link to external resources
- Reference documentation
- Track URLs in research
- Create bookmark collections

---

## Actions

### `add_person_chip` - Add Person Chip

**Add an interactive @mention for a person.**

**Parameters:**

| Name          | Type       | Required | Description                                  |
| ------------- | ---------- | -------- | -------------------------------------------- |
| action        | literal    | ✅       | `"add_person_chip"`                          |
| spreadsheetId | string     | ✅       | Spreadsheet ID                               |
| range         | RangeInput | ✅       | Cell to add chip (e.g., "A1")                |
| email         | string     | ✅       | Email address (validated)                    |
| displayFormat | enum       | ❌       | Display format: SHORT, FULL (default: SHORT) |

**Example:**

```json
{
  "tool": "sheets_advanced",
  "request": {
    "action": "add_person_chip",
    "spreadsheetId": "1a2b3c4d5e6f",
    "range": "A1",
    "email": "project.owner@example.com",
    "displayFormat": "FULL"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "add_person_chip",
  "chip": {
    "type": "person",
    "cell": "A1",
    "email": "project.owner@example.com",
    "displayText": "@project.owner@example.com"
  }
}
```

---

### `add_drive_chip` - Add Drive File Chip

**Add a link to a Google Drive file.**

**Parameters:**

| Name          | Type       | Required | Description          |
| ------------- | ---------- | -------- | -------------------- |
| action        | literal    | ✅       | `"add_drive_chip"`   |
| spreadsheetId | string     | ✅       | Spreadsheet ID       |
| range         | RangeInput | ✅       | Cell to add chip     |
| fileId        | string     | ✅       | Google Drive file ID |
| displayText   | string     | ❌       | Custom display text  |

**Example:**

```json
{
  "tool": "sheets_advanced",
  "request": {
    "action": "add_drive_chip",
    "spreadsheetId": "1a2b3c4d5e6f",
    "range": "B1",
    "fileId": "1xyz789abc",
    "displayText": "Project Proposal"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "add_drive_chip",
  "chip": {
    "type": "drive",
    "cell": "B1",
    "fileId": "1xyz789abc",
    "uri": "https://drive.google.com/file/d/1xyz789abc/view",
    "displayText": "Project Proposal"
  }
}
```

---

### `add_rich_link_chip` - Add Rich Link Chip

**Add a smart link to any URL.**

**Parameters:**

| Name          | Type       | Required | Description              |
| ------------- | ---------- | -------- | ------------------------ |
| action        | literal    | ✅       | `"add_rich_link_chip"`   |
| spreadsheetId | string     | ✅       | Spreadsheet ID           |
| range         | RangeInput | ✅       | Cell to add chip         |
| uri           | string     | ✅       | Full URL (must be valid) |
| displayText   | string     | ❌       | Custom display text      |

**Example:**

```json
{
  "tool": "sheets_advanced",
  "request": {
    "action": "add_rich_link_chip",
    "spreadsheetId": "1a2b3c4d5e6f",
    "range": "C1",
    "uri": "https://docs.example.com/api",
    "displayText": "API Documentation"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "add_rich_link_chip",
  "chip": {
    "type": "rich_link",
    "cell": "C1",
    "uri": "https://docs.example.com/api",
    "displayText": "API Documentation"
  }
}
```

---

### `list_chips` - List All Chips

**Find all smart chips in a spreadsheet.**

**Parameters:**

| Name          | Type    | Required | Description                                                  |
| ------------- | ------- | -------- | ------------------------------------------------------------ |
| action        | literal | ✅       | `"list_chips"`                                               |
| spreadsheetId | string  | ✅       | Spreadsheet ID                                               |
| chipType      | enum    | ❌       | Filter by type: all, person, drive, rich_link (default: all) |
| sheetId       | number  | ❌       | Filter by specific sheet ID                                  |

**Example:**

```json
{
  "tool": "sheets_advanced",
  "request": {
    "action": "list_chips",
    "spreadsheetId": "1a2b3c4d5e6f",
    "chipType": "person"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "list_chips",
  "chips": [
    {
      "type": "person",
      "cell": "A1",
      "email": "owner@example.com",
      "displayText": "@owner@example.com"
    },
    {
      "type": "person",
      "cell": "A2",
      "email": "reviewer@example.com",
      "displayText": "@reviewer"
    }
  ]
}
```

---

## Examples

### Example 1: Create Task Assignment Sheet

**Goal:** Build a task tracker with person chips for assignees.

**Steps:**

```bash
# 1. Create sheet structure
sheets_data append
  spreadsheetId: "1a2b3c"
  range: "Tasks!A1:C1"
  values: [["Task", "Assignee", "Status"]]

# 2. Add task data
sheets_data append
  spreadsheetId: "1a2b3c"
  range: "Tasks!A2:C2"
  values: [["Implement API", "", "In Progress"]]

# 3. Add person chip for assignee
sheets_advanced add_person_chip
  spreadsheetId: "1a2b3c"
  range: "Tasks!B2"
  email: "developer@example.com"
  displayFormat: "FULL"
```

**Result:** Interactive task sheet where clicking assignee chips opens email/chat.

### Example 2: Document Reference Library

**Goal:** Create a catalog of related documents with Drive chips.

```bash
# Add header
sheets_data update
  spreadsheetId: "1a2b3c"
  range: "References!A1:B1"
  values: [["Document", "Link"]]

# Add Drive file chips
sheets_advanced add_drive_chip
  spreadsheetId: "1a2b3c"
  range: "References!B2"
  fileId: "1doc123"
  displayText: "Design Spec"

sheets_advanced add_drive_chip
  spreadsheetId: "1a2b3c"
  range: "References!B3"
  fileId: "1pres456"
  displayText: "Presentation"
```

**Result:** Clickable links to Drive files with automatic file metadata.

### Example 3: Resource Link Collection

**Goal:** Curate external resources with rich link chips.

```bash
# Add rich link chips for external resources
sheets_advanced add_rich_link_chip
  spreadsheetId: "1a2b3c"
  range: "Resources!A1"
  uri: "https://developers.google.com/sheets/api"
  displayText: "Sheets API Docs"

sheets_advanced add_rich_link_chip
  spreadsheetId: "1a2b3c"
  range: "Resources!A2"
  uri: "https://github.com/your-org/project"
  displayText: "GitHub Repository"
```

**Result:** Smart links with automatic preview metadata and favicons.

---

## API Details

### chipRuns Field Structure

**Writing Chips** (using `updateCells` request):

```typescript
{
  updateCells: {
    range: { sheetId: 0, startRowIndex: 0, startColumnIndex: 0, endRowIndex: 1, endColumnIndex: 1 },
    rows: [{
      values: [{
        userEnteredValue: { stringValue: "@user@example.com" },
        chipRuns: [{
          chip: {
            personProperties: {
              email: "user@example.com",
              displayFormat: "FULL"
            }
          }
        }]
      }]
    }],
    fields: "userEnteredValue,chipRuns"
  }
}
```

**Reading Chips** (using `spreadsheets.get`):

```typescript
{
  spreadsheetId: "1a2b3c",
  includeGridData: true,
  fields: "sheets.data.rowData.values(chipRuns,formattedValue)"
}
```

**Response Structure:**

```json
{
  "sheets": [
    {
      "data": [
        {
          "rowData": [
            {
              "values": [
                {
                  "chipRuns": [
                    {
                      "chip": {
                        "personProperties": {
                          "email": "user@example.com"
                        }
                      }
                    }
                  ],
                  "formattedValue": "@User Name"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### API Requirements and Restrictions

**IMPORTANT**: Google Sheets API enforces specific requirements when writing chips programmatically.

#### 1. Placeholder Character Requirement

**All chips MUST include the `@` character in the `userEnteredValue`:**

```typescript
// ✅ CORRECT - Person chip with @ placeholder
{
  userEnteredValue: { stringValue: "@user@example.com" },
  chipRuns: [{ chip: { personProperties: { email: "user@example.com" } } }]
}

// ✅ CORRECT - Drive chip with @ placeholder
{
  userEnteredValue: { stringValue: "@My Document" },
  chipRuns: [{ chip: { richLinkProperties: { uri: "https://drive.google.com/..." } } }]
}

// ❌ INCORRECT - Missing @ prefix will fail or display incorrectly
{
  userEnteredValue: { stringValue: "user@example.com" },
  chipRuns: [{ chip: { personProperties: { email: "user@example.com" } } }]
}
```

**Why?** The `@` character signals to Google Sheets that this is an interactive chip, not plain text.

#### 2. Drive-Only Write Restriction for Rich Link Chips

**Only Google Drive file links can be written as rich link chips:**

```typescript
// ✅ CORRECT - Drive file URI (allowed)
{
  uri: 'https://drive.google.com/file/d/1ABC123/view';
}

// ❌ INCORRECT - Non-Drive URI (will be rejected)
{
  uri: 'https://example.com/docs';
}
```

**Per Google API Documentation:**

> "Only Google Drive file links can be written as rich link chips. Other URIs will be rejected by the API."

**Workaround:** For non-Drive links, use the standard `link.uri` field in `textFormatRuns` instead of `chipRuns`.

#### 3. URI Length Limitation

**URIs cannot exceed 2000 bytes:**

```typescript
// Validate URI length before chip creation
const uriBytes = new TextEncoder().encode(uri).length;
if (uriBytes > 2000) {
  throw new Error('URI exceeds 2000 bytes maximum');
}
```

**Why?** This is a Google Sheets API limit. URLs longer than 2000 bytes will cause the API call to fail with a cryptic error.

#### 4. OAuth Scope Requirements

**Drive chips require the `drive.file` scope:**

When writing Drive chips or rich link chips pointing to Drive files, users must grant the `https://www.googleapis.com/auth/drive.file` scope.

**Incremental Consent Flow:**

1. User attempts to create Drive chip without Drive scope
2. ServalSheets returns `INCREMENTAL_SCOPE_REQUIRED` error
3. OAuth provider triggers incremental consent flow
4. User grants `drive.file` scope
5. Chip creation succeeds

**Error Response:**

```json
{
  "success": false,
  "error": {
    "code": "INCREMENTAL_SCOPE_REQUIRED",
    "message": "Drive file access required. Please grant drive.file scope to write Drive chips.",
    "retryable": true,
    "details": {
      "requiredScope": "https://www.googleapis.com/auth/drive.file",
      "currentScopes": ["https://www.googleapis.com/auth/spreadsheets"]
    }
  }
}
```

**Required Scopes by Chip Type:**

| Chip Type         | Required Scopes               |
| ----------------- | ----------------------------- |
| Person            | `spreadsheets` only           |
| Drive File        | `spreadsheets` + `drive.file` |
| Rich Link (Drive) | `spreadsheets` + `drive.file` |

---

### Helper Functions

ServalSheets provides utility functions in [src/utils/google-sheets-helpers.ts](../../src/utils/google-sheets-helpers.ts):

**Build Person Chip:**

```typescript
import { buildPersonChip } from './utils/google-sheets-helpers.js';

const cellData = buildPersonChip('user@example.com', 'FULL');
// Returns CellData with chipRuns for person chip
```

**Build Drive Chip:**

```typescript
import { buildDriveChip } from './utils/google-sheets-helpers.js';

const cellData = buildDriveChip('1fileId123', 'Custom Display');
// Returns CellData with chipRuns for drive chip (richLinkProperties with Drive URI)
```

**Build Rich Link Chip:**

```typescript
import { buildRichLinkChip } from './utils/google-sheets-helpers.js';

const cellData = buildRichLinkChip('https://example.com', 'Example Site');
// Returns CellData with chipRuns for rich link chip
```

**Parse Chip from Cell:**

```typescript
import { parseChipRuns } from './utils/google-sheets-helpers.js';

const chip = parseChipRuns(cellData, 'A1');
if (chip?.type === 'person') {
  console.log(`Person: ${chip.email}`);
} else if (chip?.type === 'drive') {
  console.log(`Drive file: ${chip.fileId}`);
}
```

---

## Best Practices

### 1. Use Person Chips for Assignments

**Good:**

```json
{ "action": "add_person_chip", "email": "assignee@example.com", "displayFormat": "FULL" }
```

**Why:** Person chips:

- Show real-time profile pictures
- Link to email/chat
- Update automatically when user changes name
- Work with Google Workspace directory

### 2. Use Drive Chips for Internal Files

**Good:**

```json
{ "action": "add_drive_chip", "fileId": "1abc123", "displayText": "Requirements Doc" }
```

**Why:** Drive chips:

- Show file type icons
- Display last modified time
- Respect sharing permissions
- Open in Google Docs/Sheets/Slides

### 3. Use Rich Links for External Resources

**Good:**

```json
{ "action": "add_rich_link_chip", "uri": "https://api.example.com/docs", "displayText": "API Docs" }
```

**Why:** Rich links:

- Show website favicons
- Fetch page metadata (title, description)
- Display preview images
- Work with any public URL

### 4. Provide Display Text for Clarity

**Good:**

```json
{ "action": "add_drive_chip", "fileId": "1xyz", "displayText": "Q4 Budget Proposal" }
```

**Bad:**

```json
{ "action": "add_drive_chip", "fileId": "1xyz" } // Shows "Drive File: 1xyz..."
```

### 5. Filter Chips by Type When Listing

**Good:**

```json
{ "action": "list_chips", "chipType": "person" } // Only person chips
```

**Why:** Faster response, easier to process specific chip types.

---

## Troubleshooting

### Chip Not Displaying as Interactive Element

**Symptoms:** Cell shows plain text instead of interactive chip.

**Causes:**

1. Using legacy `textFormatRuns` API (deprecated)
2. Missing `chipRuns` field in request
3. Invalid email or fileId

**Solution:**

- Verify using `chipRuns` API (not `textFormatRuns`)
- Check that `fields` parameter includes `chipRuns`
- Validate email format and Drive file ID

### Person Chip Shows Email Instead of Name

**Cause:** Person not in your Google Workspace directory, or using external email.

**Solution:**

- For Workspace users, chips show directory name
- For external users, chips show email address
- Use `displayFormat: "FULL"` to always show email

### Drive Chip Shows "File Not Found"

**Causes:**

1. File ID is invalid
2. You don't have permission to access the file
3. File has been deleted

**Solution:**

- Verify file ID is correct
- Check file sharing settings (must be accessible by you)
- Use `list_chips` to audit existing chips

### Rich Link Chip Shows Generic Icon

**Cause:** Website doesn't provide OpenGraph metadata or favicon.

**Solution:**

- Provide custom `displayText` for clarity
- Some sites don't support preview metadata (expected behavior)

### "INCREMENTAL_SCOPE_REQUIRED" Error

**Cause:** Drive chips require `drive` or `drive.file` scope (usually already granted).

**Solution:**

- Follow the authorization URL in error details
- Grant the requested Drive scope
- Retry chip creation

---

## API Reference

### chipRuns Schema

**PersonProperties:**

```typescript
{
  email: string;              // Required: person's email
  displayFormat?: string;     // Optional: DEFAULT | FULL | NAME_ONLY
}
```

**RichLinkProperties:**

```typescript
{
  uri: string;                // Required: full URL
  mimeType?: string;          // Output only: MIME type (for Drive files)
}
```

**ChipRun:**

```typescript
{
  chip: {
    personProperties?: PersonProperties;
    richLinkProperties?: RichLinkProperties;
  };
  startIndex?: number;        // Character offset (usually 0)
}
```

**CellData with chipRuns:**

```typescript
{
  userEnteredValue: { stringValue: "@user@example.com" };
  chipRuns: ChipRun[];
  formattedValue?: string;    // Output only: rendered text
}
```

---

## References

- [Google Sheets Smart Chips API](https://developers.google.com/workspace/sheets/api/guides/chips)
- [Managing Smart Chips with Sheets API](https://medium.com/google-cloud/managing-smart-chips-on-google-sheets-with-sheets-api-b6fb5a77ccfe)
- [ServalSheets chipRuns Helpers](../../src/utils/google-sheets-helpers.ts)
- [sheets_advanced Action Reference](./ACTION_REFERENCE.md#sheets_advanced)
