---
title: MCP Resources
category: reference
last_updated: 2026-01-31
description: ServalSheets exposes resources through the Model Context Protocol (MCP) for LLM context enrichment.
version: 1.6.0
tags: [sheets]
stability: stable
---

# MCP Resources

ServalSheets exposes resources through the Model Context Protocol (MCP) for LLM context enrichment.

## Overview

MCP resources provide:

- Structured data access for LLMs
- Dynamic content retrieval
- URI-based resource identification
- Automatic context inclusion

## Resource Types

### Knowledge Resources

Access embedded documentation and API reference.

**URI Pattern**: `knowledge://servalsheets/{category}/{topic}`

**Categories**:

- `api/` - Google Sheets API patterns
- `formulas/` - Function reference
- `patterns/` - Common patterns

**Examples**:

```
knowledge://servalsheets/api/batch-operations
knowledge://servalsheets/api/charts
knowledge://servalsheets/formulas/functions-reference
```

See: [Knowledge Base](./knowledge.md)

### Schema Resources

Access tool schemas and action definitions.

**URI Pattern**: `schema://servalsheets/{tool}`

**Available schemas**:

- `schema://servalsheets/sheets_data`
- `schema://servalsheets/sheets_core`
- `schema://servalsheets/sheets_format`
- `schema://servalsheets/sheets_visualize`
- `schema://servalsheets/sheets_analyze`

**Returns**: JSON schema for tool actions and parameters

### Confirmation Resources

Access confirmation requirements for destructive operations.

**URI Pattern**: `confirmation://servalsheets/{action-type}`

**Confirmation types**:

- `destructive` - Delete, clear operations
- `bulk` - Large-scale changes
- `structural` - Schema modifications

**Returns**: Confirmation policy and requirements

### History Resources

Access operation history and audit logs.

**URI Pattern**: `history://servalsheets/{spreadsheet-id}`

**Examples**:

```
history://servalsheets/1abc...xyz
history://servalsheets/1abc...xyz?since=2026-01-01
history://servalsheets/1abc...xyz?action=write
```

**Returns**: Timestamped operation log

### Transaction Resources

Access transaction state and pending operations.

**URI Pattern**: `transaction://servalsheets/{transaction-id}`

**Returns**: Transaction details, status, affected ranges

### Conflict Resources

Access conflict detection results.

**URI Pattern**: `conflict://servalsheets/{spreadsheet-id}/{range}`

**Returns**: Detected conflicts, timestamps, concurrent changes

### Impact Resources

Access impact analysis for planned operations.

**URI Pattern**: `impact://servalsheets/{spreadsheet-id}/{action}`

**Returns**: Predicted impact, affected cells, dependencies

### Quality Resources

Access data quality metrics.

**URI Pattern**: `quality://servalsheets/{spreadsheet-id}`

**Returns**: Quality score, issues, recommendations

### Metrics Resources

Access performance and usage metrics.

**URI Pattern**: `metrics://servalsheets/{metric-type}`

**Metric types**:

- `performance` - Response times, throughput
- `quota` - API quota usage
- `errors` - Error rates and types
- `cache` - Cache hit rates

### Template Resources

Access spreadsheet templates.

**URI Pattern**: `template://servalsheets/{template-name}`

**Templates**:

- Budget tracking
- Project management
- Inventory tracking
- Sales dashboard

## Resource Access

### Via MCP Client

Resources are accessed through standard MCP resource protocol:

```
List available resources
```

```
Read resource: knowledge://servalsheets/api/charts
```

### Via ServalSheets Tools

Some tools automatically load relevant resources:

**Example**: Creating a chart

```
Create column chart in spreadsheet "1abc...xyz"
```

**Behind the scenes**:

1. ServalSheets loads `knowledge://servalsheets/api/charts`
2. Includes chart patterns in LLM context
3. Suggests optimal configuration
4. Validates against schema

### Programmatic Access

```typescript
import { getResource } from '@servalsheets/server';

const resource = await getResource('knowledge://servalsheets/api/charts');
// { uri, content, mimeType, metadata }
```

## Resource Metadata

Each resource includes:

```json
{
  "uri": "knowledge://servalsheets/api/charts",
  "name": "Charts API Reference",
  "description": "Chart creation and customization patterns",
  "mimeType": "text/markdown",
  "metadata": {
    "category": "api",
    "version": "v4",
    "updated": "2026-01-30T00:00:00Z",
    "related": [
      "knowledge://servalsheets/api/data-validation",
      "schema://servalsheets/sheets_visualize"
    ]
  }
}
```

## Dynamic Resources

### Spreadsheet-Specific Resources

Resources that require spreadsheet context:

**Schema resource for specific spreadsheet**:

```
schema://servalsheets/{spreadsheet-id}/structure
```

**Returns**: Sheet names, ranges, named ranges

**Quality resource**:

```
quality://servalsheets/{spreadsheet-id}?range=Sheet1!A1:E100
```

**Returns**: Quality metrics for specific range

### Filtered Resources

Add query parameters to filter:

**History with filters**:

```
history://servalsheets/{spreadsheet-id}?
  since=2026-01-01&
  until=2026-01-31&
  action=write&
  user=user@example.com
```

**Metrics with timeframe**:

```
metrics://servalsheets/performance?
  start=2026-01-01&
  end=2026-01-31&
  aggregation=daily
```

## Resource Discovery

### List All Resources

```
List all available MCP resources
```

**Returns**: Array of resource URIs with metadata

### List by Category

```
List resources in category: api
```

**Returns**: Filtered list of API documentation resources

### Search Resources

```
Search resources for: "conditional formatting"
```

**Returns**: Matching resources with relevance scores

## Resource Caching

### Client-Side Caching

Resources are cached by MCP clients:

- **Duration**: Varies by resource type
- **Knowledge**: 24 hours
- **Schema**: Until server restart
- **History**: 5 minutes
- **Metrics**: 1 minute

### Server-Side Caching

ServalSheets caches resource generation:

- Static resources (knowledge, schema): Indefinite
- Dynamic resources (history, metrics): Time-limited
- Invalidation on relevant changes

## Resource Best Practices

### For Users

1. **Explore available resources** before asking questions
2. **Use specific URIs** for faster access
3. **Cache frequently used** resources locally
4. **Report missing resources** via GitHub

### For LLMs

1. **Load relevant resources** automatically
2. **Reference resource content** when available
3. **Suggest resources** to users when appropriate
4. **Update context** as resources change

### For Developers

1. **Document new resources** with clear URIs
2. **Include metadata** for discoverability
3. **Implement caching** for performance
4. **Version resources** appropriately

## Resource Security

### Access Control

Resources respect spreadsheet permissions:

- **Public resources**: Knowledge, schemas, templates
- **Protected resources**: History, metrics (require auth)
- **Private resources**: Spreadsheet-specific data

### Sensitive Data

Resources never expose:

- OAuth tokens or credentials
- Personal user information
- Proprietary formulas or algorithms
- Unshared spreadsheet data

## Resource Formats

### Supported MIME Types

- `text/markdown` - Documentation (`.md`)
- `application/json` - Structured data (schemas, metrics)
- `text/plain` - Plain text
- `text/html` - HTML content

### Content Encoding

All resources use UTF-8 encoding.

## Error Handling

### Resource Not Found

```json
{
  "error": "RESOURCE_NOT_FOUND",
  "uri": "knowledge://servalsheets/api/nonexistent",
  "message": "Resource does not exist",
  "suggestions": [
    "knowledge://servalsheets/api/charts",
    "knowledge://servalsheets/api/batch-operations"
  ]
}
```

### Access Denied

```json
{
  "error": "ACCESS_DENIED",
  "uri": "history://servalsheets/1abc...xyz",
  "message": "Insufficient permissions to access this resource",
  "required": "spreadsheets.readonly scope"
}
```

### Resource Temporarily Unavailable

```json
{
  "error": "RESOURCE_UNAVAILABLE",
  "uri": "metrics://servalsheets/performance",
  "message": "Metrics service temporarily unavailable",
  "retryAfter": 60
}
```

## Future Resource Types

Planned resource additions:

- **Prompt templates**: `prompt://servalsheets/{template}`
- **Workflow definitions**: `workflow://servalsheets/{workflow}`
- **Policy resources**: `policy://servalsheets/{policy-type}`
- **Integration guides**: `guide://servalsheets/{integration}`

## Resource Versioning

Resources include version information:

```
knowledge://servalsheets/api/charts?version=v4
schema://servalsheets/sheets_data?version=1.6.0
```

**Version strategies**:

- API documentation: Google Sheets API version
- Schemas: ServalSheets version
- Knowledge: Content version (semantic)

## Integration Examples

### LLM Context Enrichment

```typescript
// Automatically include relevant resources
const context = await enrichContext({
  action: 'create_chart',
  resources: ['knowledge://servalsheets/api/charts', 'schema://servalsheets/sheets_visualize'],
});
```

### Documentation Generation

```typescript
// Generate documentation from resources
const docs = await generateDocs({
  source: 'schema://servalsheets/sheets_data',
  format: 'markdown',
});
```

### Quality Monitoring

```typescript
// Monitor spreadsheet quality
const quality = await getResource(`quality://servalsheets/${spreadsheetId}`);
if (quality.score < 70) {
  console.warn('Quality degraded', quality.issues);
}
```

## Related Documentation

- [Knowledge Base](./knowledge.md) - Embedded knowledge resources
- [Tool Reference](./tools/) - Tool-specific documentation
- [Usage Guide](../guides/USAGE_GUIDE.md) - General usage patterns
- [MCP Protocol](https://modelcontextprotocol.io) - Official MCP specification

## Support

For resource-related questions:

- Check resource documentation first
- List available resources to discover
- Open GitHub issue for missing resources
- Contribute new resources via pull request
