---
title: Welcome to ServalSheets! 🎉
category: guide
last_updated: 2026-01-31
description: You've successfully installed ServalSheets. Start with readiness, then verify the connection, then complete one useful task.
version: 1.6.0
audience: user
difficulty: intermediate
---

# Welcome to ServalSheets! 🎉

You've successfully installed ServalSheets. Start with readiness, then verify the connection, then complete one useful task.

## Your First 5 Minutes

### Step 1: Restart Claude Desktop

1. Quit Claude Desktop completely (⌘+Q)
2. Reopen Claude Desktop
3. Look for the 🔨 icon in the bottom-right corner (custom ServalSheets icon may not appear yet)

### Step 2: Check Readiness First

Use the `sheets_auth` tool with:

```json
{
  "request": {
    "action": "status"
  }
}
```

Read these fields in the response:

- `readiness`
- `blockingIssues`
- `recommendedNextAction`
- `recommendedPrompt`

This step tells you whether Google auth is ready, whether elicitation is supported, and whether optional capabilities like connectors, AI fallback, or webhooks are already configured.

### Step 3: Say Hello

Type this in Claude Desktop:

```
/welcome
```

This will give you an interactive introduction to the canonical onboarding funnel.

### Step 4: Test Your Setup

Type:

```
/test_connection
```

This verifies readiness, metadata access, value reads, session context, and the lightweight analysis path using a public spreadsheet.

### Step 5: Try Your First Operation

Type:

```
/first_operation
```

Claude will guide you through one useful task after readiness has already been verified.

### Optional: Full New Project Setup

If you want to create a brand-new workbook from scratch, use:

```
/full_setup type=budget name="Q1 2026 Budget"
```

## What Are These `/` Commands?

These are called **prompts**. They're pre-built conversation starters that guide you through common tasks.

**Available prompts:**

- `/welcome` - Introduction and routing
- `/test_connection` - Verify the full stack works
- `/first_operation` - Guided first useful task
- `/full_setup` - Guided new workbook setup
- `/analyze_spreadsheet` - Analyze data quality
- `/clean_data` - Clean and standardize data
- `/transform_data` - Transform data safely
- `/create_report` - Generate formatted report

## Quick Examples

### Example 1: Read Data

```
Read cells A1:D10 from spreadsheet: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
```

### Example 2: Analyze Quality

```
Analyze the data quality in spreadsheet: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
```

### Example 3: Create a Chart

```
Create a bar chart from the data in spreadsheet: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
Show monthly sales from range A1:B12
```

## Safety Features 🛡️

ServalSheets is built with safety in mind:

- **Dry-run mode**: Preview changes before executing
- **Effect limits**: Prevent accidental large-scale changes
- **Auto-snapshots**: Automatic backups before destructive operations
- **Confirmation prompts**: Claude will ask before major changes

## Using Your Own Spreadsheets

### With Service Account

1. Open your Google Sheet
2. Click "Share"
3. Add your service account email (from your JSON file)
4. Grant "Editor" permission

### With OAuth Token

You automatically have access to your own spreadsheets!

## What Can ServalSheets Do?

### 📊 Data Operations

- Read and write cell values
- Batch operations for efficiency
- Find columns by header name (semantic ranges)

### 🔍 Analysis

- Data quality checks
- Statistics and correlations
- Formula auditing
- Duplicate detection

### 🎨 Formatting

- Cell formatting (colors, fonts, numbers)
- Conditional formatting rules
- Charts and visualizations

### 🚀 Advanced

- Version history and restore
- Sharing and permissions
- Comments and notes
- Named ranges and protection

## Need Help?

- **Blocked before auth?** Run `sheets_auth status` again and follow `recommendedNextAction`
- **Need onboarding?** Type `/welcome`
- **Need verification?** Type `/test_connection`
- **Need a guided real task?** Type `/first_operation`
- **Logs:** `~/Library/Logs/Claude/mcp-server-servalsheets.log`

## Documentation

- `PROMPTS_GUIDE.md` - All available prompts
- `CLAUDE_DESKTOP_SETUP.md` - Detailed setup guide
- `README.md` - Full documentation
- `SKILL.md` - How Claude uses ServalSheets

## Test Spreadsheet

For testing, use this public spreadsheet:

- **ID**: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`
- **URL**: https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms

## Pro Tips

1. **Start with readiness**: Run `sheets_auth status`, then use `/welcome`, `/test_connection`, and `/first_operation`
2. **Be specific**: Include spreadsheet IDs and cell ranges
3. **Use dry-run**: Always preview destructive operations first
4. **Batch operations**: Ask Claude to do multiple things at once for efficiency
5. **Ask questions**: Claude will guide you through complex tasks

---

**Ready to start?**

Run `sheets_auth status`, then type `/welcome` in Claude Desktop to begin your ServalSheets journey.
