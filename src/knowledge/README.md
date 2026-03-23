# ServalSheets Knowledge Base

## Overview

This knowledge base powers the AI-driven features of ServalSheets. It provides the foundational intelligence for templates, formulas, and data schemas that enable the AI to make smart suggestions and help users work more effectively with Google Sheets.

## Purpose

The knowledge base serves three primary functions:

1. **Templates**: Pre-built spreadsheet structures for common use cases
2. **Formulas**: Curated collection of essential formulas with examples and context
3. **Schemas**: Data structure definitions for organizing business information

## Directory Structure

```
knowledge/
├── README.md                    # This file
├── DELIVERABLES.md              # Completion status
├── api/                         # Google Sheets API references
│   ├── charts.md                # Complete chart types guide
│   ├── pivot-tables.md          # Pivot table operations
│   ├── conditional-formatting.md # Conditional formatting patterns
│   ├── data-validation.md       # Data validation rules
│   ├── batch-operations.md      # Batch optimization guide
│   ├── named-ranges.md          # Named ranges & protection
│   └── limits/                  # API quotas & limits
├── formulas/                    # Formula knowledge base
│   └── functions-reference.md   # 100+ formula functions
├── templates/                   # Pre-built spreadsheet templates
│   ├── common-templates.json    # Template descriptions
│   ├── finance.json             # Financial/budget tracking
│   ├── project.json             # Project management
│   ├── sales.json               # Sales CRM
│   ├── inventory.json           # Inventory management
│   ├── crm.json                 # Customer relationship management
│   └── marketing.json           # Marketing campaigns
└── schemas/                     # Data structure definitions
    ├── crm.json                 # CRM data schema
    ├── inventory.json           # Inventory data schema
    └── project.json             # Project data schema
```

## API References

### Google Sheets API Documentation

Comprehensive references for advanced Google Sheets API operations:

| File                            | Description                                       | Size |
| ------------------------------- | ------------------------------------------------- | ---- |
| `api/charts.md`                 | Complete chart types, styling, axes configuration | 29KB |
| `api/pivot-tables.md`           | Pivot table creation, grouping, aggregations      | 20KB |
| `api/conditional-formatting.md` | Boolean conditions, gradients, custom formulas    | 24KB |
| `api/data-validation.md`        | 25+ validation types, form patterns, dropdowns    | 21KB |
| `api/batch-operations.md`       | Request batching, optimization, error handling    | 21KB |
| `api/named-ranges.md`           | Named ranges, protection, permissions             | 17KB |

### Formula Functions Reference

| File                              | Description                          | Size |
| --------------------------------- | ------------------------------------ | ---- |
| `formulas/functions-reference.md` | 100+ formula functions with examples | 15KB |

Categories covered: Lookup & Reference, Text, Math & Statistics, Date & Time, Logical, Array, Financial, Data Manipulation, Error Handling.

---

## Templates

### What Are Templates?

Templates are complete, production-ready spreadsheet structures. Each template includes:

- **Multiple related sheets**: Organized worksheets that work together
- **Pre-configured formulas**: Working calculations ready to use
- **Sample data**: Examples showing how to use the template
- **Formatting**: Professional styling and conditional formatting
- **Charts**: Pre-built visualizations where applicable
- **Data validation**: Dropdowns and input constraints

### Available Templates

1. **Finance Template** (`finance.json`) - Budget tracking with 4 sheets (Summary, Monthly, Projections, Transactions)
2. **Project Template** (`project.json`) - Project management with 6 sheets (Summary, Tasks, Timeline, Resources, Budget, Risks)
3. **Sales Template** (`sales.json`) - Sales CRM with 5 sheets (Dashboard, Pipeline, Contacts, Activities, Deals)
4. **Inventory Template** (`inventory.json`) - Inventory management with 4 sheets (Products, Transactions, Suppliers, Dashboard)
5. **CRM Template** (`crm.json`) - Customer relationship management with 4 sheets (Contacts, Opportunities, Activities, Dashboard)
6. **Marketing Template** (`marketing.json`) - Marketing campaign tracker with 4 sheets (Campaigns, Content Calendar, Metrics, Dashboard)
7. **Common Templates** (`common-templates.json`) - Template descriptions for quick reference

## Formulas

### Formula Categories

1. **Financial Formulas** (`formulas/financial.json`) - 12 essential financial calculations
2. **Date & Time Formulas** (`formulas/datetime.json`) - 12 date and time operations
3. **Lookup Formulas** (`formulas/lookup.json`) - 8 lookup and reference patterns
4. **Advanced Formulas** (`formulas/advanced.json`) - 10 power user formulas

Each formula includes:

- Syntax and parameters
- Examples
- Description
- Best practices
- Related formulas

## Schemas

### Available Schemas

1. **CRM Schema** (`schemas/crm.json`) - 4 tables (Contacts, Opportunities, Activities, Pipeline) with 40+ columns
2. **Inventory Schema** (`schemas/inventory.json`) - 6 tables (Products, Suppliers, Warehouses, StockLevels, Transactions, PurchaseOrders)
3. **Project Schema** (`schemas/project.json`) - 6 tables (Projects, Tasks, Milestones, Resources, TimeTracking, Risks)

## AI Integration

### How the AI Uses This Knowledge Base

The AI services use this knowledge base to:

1. **Suggest Templates**: When user describes a need, AI suggests matching template
2. **Recommend Formulas**: Based on user's goal, AI suggests appropriate formulas
3. **Design Data Structures**: AI proposes schemas for organizing user's data
4. **Provide Examples**: Real-world examples help users understand and adapt

### Context Matching

Each knowledge base item includes an `aiContext` section:

```json
"aiContext": {
  "when_to_suggest": [
    "User mentions X",
    "User asks about Y",
    "User needs Z"
  ],
  "key_features": [
    "Feature 1",
    "Feature 2"
  ]
}
```

The AI matches user queries against these contexts to make relevant suggestions.

---

**Built for ServalSheets V4**  
Version 1.0.0 | January 2026
