---
title: ServalSheets Prompts Guide
category: guide
last_updated: 2026-01-31
description: ServalSheets includes guided prompts for onboarding, verification, setup, analysis, and recovery. Start with the readiness-first onboarding funnel.
version: 1.6.0
audience: user
difficulty: intermediate
---

# ServalSheets Prompts Guide

ServalSheets includes guided prompts for onboarding, setup, analysis, cleaning, reporting, and recovery.

## Start Here

The canonical first-run funnel is:

1. Run `sheets_auth` with `action: "status"`
2. Read the `readiness`, `blockingIssues`, `recommendedNextAction`, and `recommendedPrompt` fields
3. Use `/test_connection`
4. Continue with `/first_operation` or `/full_setup`

If the client supports elicitation, setup prompts and setup tools can collect missing inputs interactively. If it does not, the server returns fallback instructions with copy-pastable JSON.

## 🎉 Onboarding Prompts

### `welcome`

**Your first introduction to ServalSheets**

Invoke with:

```
/welcome
```

What it shows:

- The readiness-first onboarding ladder
- Why `sheets_auth status` is the required first step
- The canonical next prompts to use after readiness

Perfect for: First-time users who want the shortest path to a successful first task

---

### `test_connection`

**Verify your ServalSheets setup**

Invoke with:

```
/test_connection
```

What it does:

- Starts with `sheets_auth status`
- Verifies readiness and authentication
- Confirms metadata, read access, session context, and analysis on a public sheet
- Tells you the next recommended action after the verification pass

Perfect for: Immediately after install, and whenever onboarding feels uncertain

---

### `first_operation`

**Guided walkthrough of your first operation**

Invoke with:

```
/first_operation
```

Or with your own spreadsheet:

```
/first_operation spreadsheetId=YOUR_SPREADSHEET_ID
```

What it covers:

- Setting active context
- Reading a representative range
- Running a lightweight analysis
- Completing one useful task
- Ending with a clear next step

Perfect for: Moving from “the server works” to “I completed something useful”

---

### `full_setup`

**Create a new workbook using the canonical readiness → create → verify flow**

Invoke with:

```bash
/full_setup type=budget name="Q1 2026 Budget"
```

What it covers:

- Confirms readiness first
- Creates the workbook
- Applies a template and formulas
- Verifies the first successful read before optional sharing

Perfect for: New projects where you want a guided, end-to-end creation path

---

## 🔬 Analysis Prompts

### `analyze_spreadsheet`

**Comprehensive data quality and structure analysis**

Invoke with:

```
/analyze_spreadsheet spreadsheetId=YOUR_ID
```

What it analyzes:

- Metadata and structure
- Data quality (completeness, duplicates, consistency)
- Column data types
- Formula health
- Provides recommendations

Perfect for: Understanding unfamiliar spreadsheets, data quality audits

---

### `clean_data`

**Systematic data cleaning workflow**

Invoke with:

```
/clean_data spreadsheetId=YOUR_ID range=Sheet1!A1:Z100
```

What it does:

- Analyzes current data quality
- Creates cleaning plan
- Previews changes (dry-run)
- Gets your confirmation
- Executes cleaning with backups
- Validates improvements

Perfect for: Messy data, standardization, preparing data for analysis

---

## 🚀 Quick Start Prompts

### `transform_data`

**Safe data transformation with preview**

Invoke with:

```
/transform_data spreadsheetId=YOUR_ID range=Sheet1!A1:D100 transformation="convert dates to YYYY-MM-DD format"
```

What it does:

- Reads current data
- Plans transformation
- Shows preview (dry-run)
- Waits for your approval
- Executes with safety limits
- Verifies results

Perfect for: Format conversions, calculations, data restructuring

---

### `create_report`

**Generate formatted report from data**

Invoke with:

```
/create_report spreadsheetId=YOUR_ID
```

Or specify report type:

```
/create_report spreadsheetId=YOUR_ID reportType=charts
```

Report types:

- `summary` - Basic summary with statistics (default)
- `detailed` - Comprehensive report with multiple sections
- `charts` - Report with visualizations

What it creates:

- New "Report" sheet
- Summary statistics
- Professional formatting
- Charts (if requested)
- Auto-sized columns
- Frozen headers

Perfect for: Dashboards, presentations, stakeholder reports

---

## 💡 How to Use Prompts

### In Claude Desktop

Prompts appear in the prompt selector. Just type `/` and you'll see:

```
🎉 welcome - Readiness-first onboarding
🔍 test_connection - Verify auth, reads, and session wiring
👶 first_operation - Complete your first useful task
🚀 full_setup - Create a new workbook with guided verification
🔬 analyze_spreadsheet - Comprehensive analysis
🧹 clean_data - Clean and standardize data
🔄 transform_data - Transform data safely
📈 create_report - Generate formatted report
```

### Example Conversations

**First Time User:**

```
You: sheets_auth status
Claude: [Shows readiness, blocking issues, and the next best action]

You: /test_connection
Claude: [Verifies auth, metadata access, value reads, and session context]

You: /first_operation
Claude: [Guides the first useful task with a clear next step]
```

**Data Analysis:**

```
You: /analyze_spreadsheet spreadsheetId=abc123
Claude: [Performs comprehensive analysis]

You: /clean_data spreadsheetId=abc123 range=Sheet1!A1:Z100
Claude: [Cleans data systematically with safety checks]
```

**Reporting:**

```
You: /create_report spreadsheetId=abc123 reportType=charts
Claude: [Creates professional report with charts]
```

## 🎯 Prompt Flow Recommendations

### For New Users

1. `/welcome` - Understand what ServalSheets does
2. `sheets_auth status` - Check readiness and follow the recommended next action
3. `/test_connection` - Verify setup works
4. `/first_operation` - Learn the workflow
5. `/full_setup` - Use this instead if the user wants a brand-new workbook

### For Data Quality

1. `/analyze_spreadsheet` - Identify issues
2. `/clean_data` - Fix the issues
3. `/analyze_spreadsheet` - Verify improvements

### For Reporting

1. `/analyze_spreadsheet` - Understand the data
2. `/create_report` - Generate the report
3. Share or export the result

### For Data Transformation

1. Read current data
2. `/transform_data` - Apply transformation safely
3. Verify results

## 🛡️ Safety Features in Prompts

All prompts emphasize safety:

- **Dry-run first**: Always preview destructive operations
- **Effect scope limits**: Prevent accidental large-scale changes
- **User confirmation**: Wait for approval before executing
- **Auto-snapshots**: Create backups before changes
- **Expected state validation**: Ensure data hasn't changed

## 📚 Learn More

- **Full Documentation**: `README.md`
- **For Claude**: `SKILL.md` - How Claude should use ServalSheets
- **Setup Guide**: `CLAUDE_DESKTOP_SETUP.md`
- **Local Testing**: `LOCAL_TESTING.md`

## 🆘 Need Help?

If prompts aren't working:

1. **Check connection**: `/test_connection`
2. **View logs**: `~/Library/Logs/Claude/mcp-server-servalsheets.log`
3. **Verify setup**: `CLAUDE_DESKTOP_SETUP.md`
4. **Test manually**: Try a direct tool call

## 🎨 Customizing Prompts

Want to create your own prompts? See:

- `src/mcp/prompts.ts` - Prompt definitions (arguments defined as plain objects)
- `src/mcp/registration.ts` - Prompt registration
- [MCP Prompts Docs](https://modelcontextprotocol.io/docs/prompts)

---

**Quick Reference:**

| Prompt                | Purpose                | Parameters                                            |
| --------------------- | ---------------------- | ----------------------------------------------------- |
| `welcome`             | Introduction           | None                                                  |
| `test_connection`     | Verify setup           | None                                                  |
| `first_operation`     | Guided walkthrough     | `spreadsheetId` (optional)                            |
| `analyze_spreadsheet` | Comprehensive analysis | `spreadsheetId` (required)                            |
| `clean_data`          | Data cleaning          | `spreadsheetId`, `range` (required)                   |
| `transform_data`      | Data transformation    | `spreadsheetId`, `range`, `transformation` (required) |
| `create_report`       | Report generation      | `spreadsheetId` (required), `reportType` (optional)   |

**Test Spreadsheet ID:** `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`
