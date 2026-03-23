# ServalSheets Examples

Welcome to the ServalSheets examples directory! These examples demonstrate how to use ServalSheets as a library in your Node.js applications.

## Overview

This directory contains 5 comprehensive, runnable examples, **available in both JavaScript and TypeScript**:

1. **01-basic-read-write** (.js / .ts) - Basic spreadsheet operations
2. **02-semantic-ranges** (.js / .ts) - Semantic range queries (header-based)
3. **03-safety-rails** (.js / .ts) - Safety features (dry-run, effect scope)
4. **04-batch-operations** (.js / .ts) - Efficient batch operations
5. **05-oauth-setup** (.js / .ts) - OAuth authentication flow

### JavaScript vs TypeScript

- **JavaScript examples** (`.js`) - Ready to run with Node.js, no compilation needed
- **TypeScript examples** (`.ts`) - Full type safety, requires TypeScript compilation

Choose JavaScript for quick prototyping, or TypeScript for production applications with type safety.

## Prerequisites

### 1. Node.js 22+

```bash
node --version  # Should be v22.0.0 or higher
```

### 2. Install ServalSheets

```bash
npm install servalsheets
```

### 3. Google Credentials

You need Google Sheets API credentials. Choose one method:

#### Option A: Service Account (Recommended for automation)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Enable Google Sheets API
4. Create a Service Account
5. Download JSON key file
6. Set environment variable:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
   ```

#### Option B: OAuth Access Token (For user accounts)

1. Get an OAuth access token from Google OAuth 2.0 playground
2. Set environment variable:
   ```bash
   export GOOGLE_ACCESS_TOKEN=ya29.xxx
   ```

See [QUICKSTART_CREDENTIALS.md](../docs/guides/QUICKSTART_CREDENTIALS.md) for detailed instructions.

### 4. Prepare a Test Spreadsheet

Create a Google Spreadsheet and note its ID from the URL:

```
https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
                                      ^^^^^^^^^^^^^^^^^^^
```

For service accounts, share the spreadsheet with the service account email.

## Running Examples

Each example is a standalone script using ES modules.

### Running JavaScript Examples

JavaScript examples can be run directly with Node.js:

```bash
node examples/01-basic-read-write.js
```

### Running TypeScript Examples

TypeScript examples require compilation first:

#### Option 1: Use tsx (Recommended)

```bash
# Install tsx globally
npm install -g tsx

# Run TypeScript directly
tsx examples/01-basic-read-write.ts
```

#### Option 2: Compile with TypeScript

```bash
# Install TypeScript
npm install -g typescript

# Compile and run
tsc examples/01-basic-read-write.ts --module es2022 --target es2022 --moduleResolution node
node examples/01-basic-read-write.js
```

### Basic Read/Write

```bash
# JavaScript
node examples/01-basic-read-write.js

# TypeScript
tsx examples/01-basic-read-write.ts
```

Demonstrates:

- Reading cell values
- Writing data to cells
- Error handling
- Basic operations
- Full type safety (TypeScript)

### Semantic Ranges

```bash
# JavaScript
node examples/02-semantic-ranges.js

# TypeScript
tsx examples/02-semantic-ranges.ts
```

Demonstrates:

- Header-based queries ("Revenue" column)
- Named range resolution
- Semantic vs A1 notation
- Resolution metadata
- Type-safe column resolution (TypeScript)

### Safety Rails

```bash
# JavaScript
node examples/03-safety-rails.js

# TypeScript
tsx examples/03-safety-rails.ts
```

Demonstrates:

- Dry-run mode (preview changes)
- Effect scope limits
- Expected state validation
- Auto-snapshots
- Type-safe state management (TypeScript)

### Batch Operations

```bash
# JavaScript
node examples/04-batch-operations.js

# TypeScript
tsx examples/04-batch-operations.ts
```

Demonstrates:

- Batch reading (multiple ranges)
- Batch writing (atomic updates)
- Performance best practices
- Error handling in batches
- Type-safe batch transformations (TypeScript)

### OAuth Setup

```bash
# JavaScript
node examples/05-oauth-setup.js

# TypeScript
tsx examples/05-oauth-setup.ts
```

Demonstrates:

- OAuth 2.0 authentication flow
- Token management
- Refresh token handling
- Token storage
- Type-safe OAuth credentials (TypeScript)

## Expected Output

Each example includes detailed console output showing:

- What operation is being performed
- Request parameters
- Response data
- Success/failure status
- Timing information

Example output:

```
=== ServalSheets: Basic Read/Write Example ===

[1/3] Reading data from spreadsheet...
✓ Successfully read 10 rows from Sales!A1:D10

[2/3] Writing data to spreadsheet...
✓ Successfully wrote 5 rows to Data!A1:C5

[3/3] Verifying write...
✓ Data verified successfully

=== Example Complete ===
Time taken: 2.3s
```

## Configuration

### Using Your Spreadsheet

Edit the spreadsheet ID in each example:

```javascript
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
```

### Adjusting for Your Data

Examples use placeholder sheet names like "Sales", "Data", etc. Update these to match your actual sheet names:

```javascript
const SHEET_NAME = 'YourSheetName';
```

## Troubleshooting

### "Permission denied"

- Ensure the spreadsheet is shared with your service account email
- Or ensure your OAuth token has correct scopes

### "Sheet not found"

- Verify the sheet name matches exactly (case-sensitive)
- Check the spreadsheet ID is correct

### "Invalid credentials"

- Check `GOOGLE_APPLICATION_CREDENTIALS` path is correct
- Ensure the JSON file is valid and readable

### "Module not found"

- Run `npm install servalsheets` in your project directory
- Ensure Node.js version is 22+

## Next Steps

After running these examples:

1. Read the [USAGE_GUIDE.md](../USAGE_GUIDE.md) for complete API reference
2. Explore [PROMPTS_GUIDE.md](../PROMPTS_GUIDE.md) for Claude Desktop usage
3. Review [SECURITY.md](../SECURITY.md) for production best practices
4. Check [PERFORMANCE.md](../PERFORMANCE.md) for optimization tips

## Using with Claude Desktop

These examples show library usage. To use ServalSheets with Claude Desktop:

1. Install globally:

   ```bash
   npm install -g servalsheets
   ```

2. Configure Claude Desktop (see [CLAUDE_DESKTOP_SETUP.md](../CLAUDE_DESKTOP_SETUP.md)):

   ```json
   {
     "mcpServers": {
       "servalsheets": {
         "command": "npx",
         "args": ["servalsheets"],
         "env": {
           "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/service-account.json"
         }
       }
     }
   }
   ```

3. Restart Claude Desktop

4. Use natural language to interact with your spreadsheets!

## Additional Resources

- [ServalSheets Documentation](../DOCUMENTATION.md)
- [Google Sheets API Reference](https://developers.google.com/sheets/api)
- [MCP Protocol](https://modelcontextprotocol.io)

## Support

Having issues? Check:

- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) for common problems
- [GitHub Issues](https://github.com/khill1269/servalsheets/issues) for bug reports
- [SECURITY.md](../SECURITY.md) for security concerns

## License

MIT - See [LICENSE](../LICENSE) for details
