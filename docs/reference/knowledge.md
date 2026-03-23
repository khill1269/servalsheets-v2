---
title: Knowledge Base Resources
category: reference
last_updated: 2026-01-31
description: ServalSheets includes embedded knowledge resources for Google Sheets API patterns, formulas, and best practices.
version: 1.6.0
tags: [sheets]
stability: stable
---

# Knowledge Base Resources

ServalSheets includes embedded knowledge resources for Google Sheets API patterns, formulas, and best practices.

## Overview

The knowledge base provides:

- Google Sheets API v4 reference documentation
- Formula function reference
- Batch operations patterns
- Conditional formatting examples
- Named ranges and pivot tables
- Charts and data validation

## Knowledge Categories

### API Documentation

**Batch Operations** (`api/batch-operations.md`)

- Batch update patterns
- Request batching strategies
- Error handling in batches
- Performance optimization

**Charts** (`api/charts.md`)

- Chart creation and configuration
- Chart type specifications
- Positioning and sizing
- Customization options

**Conditional Formatting** (`api/conditional-formatting.md`)

- Rule types and conditions
- Color scales and data bars
- Custom formulas
- Priority and ordering

**Data Validation** (`api/data-validation.md`)

- Validation rule types
- Dropdown lists
- Custom validation formulas
- Error messages

**Named Ranges** (`api/named-ranges.md`)

- Creating and managing named ranges
- Using named ranges in formulas
- Protected named ranges
- Scope and naming conventions

**Pivot Tables** (`api/pivot-tables.md`)

- Pivot table creation
- Data source configuration
- Aggregation functions
- Filtering and sorting

### Formula Reference

**Functions Reference** (`formulas/functions-reference.md`)

- Complete Google Sheets function list
- Function syntax and examples
- Category organization
- Common patterns and usage

**Function categories**:

- Math and trigonometry
- Statistical functions
- Logical functions
- Text functions
- Date and time
- Lookup and reference
- Database functions
- Financial functions
- Engineering functions
- Information functions

## Accessing Knowledge Resources

### Via MCP Resources

Knowledge is exposed through MCP resources for LLM context:

**List all knowledge resources**:

```
List available knowledge resources
```

**Read specific knowledge**:

```
Read knowledge resource: api/batch-operations
```

### Resource URIs

Knowledge resources use the URI template:

```
knowledge://servalsheets/{category}/{topic}
```

**Examples**:

- `knowledge://servalsheets/api/batch-operations`
- `knowledge://servalsheets/api/charts`
- `knowledge://servalsheets/formulas/functions-reference`

### Knowledge in Context

ServalSheets automatically includes relevant knowledge when:

- Creating charts → `api/charts.md`
- Setting up validation → `api/data-validation.md`
- Working with formulas → `formulas/functions-reference.md`
- Batch operations → `api/batch-operations.md`

## Knowledge Content Structure

### API Documentation Format

```markdown
# Topic Title

## Overview

High-level description and use cases

## Patterns

Common usage patterns with examples

## Examples

Complete code examples

## Best Practices

Recommended approaches

## Common Issues

Troubleshooting guidance
```

### Formula Reference Format

```markdown
# Function Name

**Syntax**: `FUNCTION(arg1, arg2, ...)`

**Description**: What the function does

**Arguments**:

- arg1: Description
- arg2: Description

**Returns**: Return value description

**Examples**:

- Example 1
- Example 2

**See Also**: Related functions
```

## Knowledge Updates

### Version Compatibility

Knowledge is maintained for:

- **Google Sheets API**: v4 (current)
- **MCP Protocol**: 2025-11-25
- **ServalSheets**: v1.6.0

### Update Frequency

Knowledge resources are updated:

- When API changes occur
- When new patterns are discovered
- Based on user feedback
- With ServalSheets releases

### Contributing

To suggest knowledge improvements:

1. Open an issue on GitHub
2. Describe the gap or improvement
3. Provide example use cases
4. Include relevant documentation links

## Integration with Tools

### Tool-Knowledge Mapping

| Tool             | Primary Knowledge Resources     |
| ---------------- | ------------------------------- |
| sheets_data      | api/batch-operations.md         |
| sheets_core      | api/named-ranges.md             |
| sheets_format    | api/conditional-formatting.md   |
| sheets_visualize | api/charts.md                   |
| sheets_advanced  | All API resources               |
| sheets_analyze   | formulas/functions-reference.md |

### Automatic Context Loading

When using tools, relevant knowledge is automatically:

1. Identified based on action
2. Retrieved from knowledge base
3. Included in LLM context
4. Used to inform suggestions

## Knowledge Best Practices

### For Users

1. **Reference knowledge first** before asking questions
2. **Search by topic** rather than browsing all
3. **Bookmark frequently used** resources
4. **Suggest improvements** when gaps found

### For Developers

1. **Keep knowledge concise** - Focus on essentials
2. **Include examples** - Show don't just tell
3. **Update regularly** - Keep in sync with API
4. **Cross-reference** - Link related topics

## Knowledge vs Documentation

### Knowledge Base (Embedded)

- **Format**: Markdown in bundle
- **Access**: Via MCP resources
- **Purpose**: LLM context, quick reference
- **Scope**: Google Sheets API specifics
- **Audience**: Primarily LLMs, also developers

### Documentation (External)

- **Format**: VitePress site
- **Access**: Via web browser
- **Purpose**: Comprehensive guides, tutorials
- **Scope**: ServalSheets usage, patterns, examples
- **Audience**: Primarily users, also developers

## File Locations

Knowledge files are located in:

```
dist/knowledge/
├── api/
│   ├── batch-operations.md
│   ├── charts.md
│   ├── conditional-formatting.md
│   ├── data-validation.md
│   ├── named-ranges.md
│   └── pivot-tables.md
├── formulas/
│   └── functions-reference.md
└── README.md
```

**Note**: These files are copied into the runtime `dist/knowledge/` tree during build and can
then be staged into deployment bundles for offline access.

## Resource Metadata

Each knowledge resource includes:

- **Title**: Human-readable name
- **Category**: api, formulas, patterns, etc.
- **Version**: Applicable API/tool version
- **Updated**: Last modification date
- **Related**: Links to related resources

## Advanced Usage

### Programmatic Access

Access knowledge programmatically:

```typescript
import { getKnowledgeResource } from '@servalsheets/server';

const content = await getKnowledgeResource('api/charts');
// Use content for context or reference
```

### Custom Knowledge

Add custom knowledge resources:

```typescript
registerKnowledgeResource({
  path: 'custom/my-patterns',
  content: '...',
  category: 'custom',
});
```

### Knowledge Search

Search across all knowledge:

```
Search knowledge for: "pivot table aggregation"
```

## Related Resources

- [Resource Reference](./resources.md) - MCP resource system
- [Usage Guide](../guides/USAGE_GUIDE.md) - General usage
- [Action Reference](../guides/ACTION_REFERENCE.md) - Tool actions
- [Examples](../examples/) - Practical examples

## Support

For knowledge-related questions:

- Check existing knowledge resources first
- Review documentation examples
- Open GitHub issue for missing content
- Suggest improvements via pull request
