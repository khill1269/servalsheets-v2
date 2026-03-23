/**
 * ServalSheets - Validation Resources
 *
 * Exposes validation engine capabilities as MCP resources for discovery and reference.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getValidationEngine } from '../services/validation-engine.js';

/**
 * Register validation resources with the MCP server
 */
export function registerValidationResources(server: McpServer): number {
  const validationEngine = getValidationEngine();

  // Resource 1: validation://stats - Validation engine statistics
  server.registerResource(
    'Validation Engine Statistics',
    'validation://stats',
    {
      description:
        'Validation engine statistics: total validations, success rate, error counts by type and severity',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const stats = validationEngine.getStats();

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  stats: {
                    totalValidations: stats.totalValidations,
                    passedValidations: stats.passedValidations,
                    failedValidations: stats.failedValidations,
                    successRate: `${(stats.successRate * 100).toFixed(1)}%`,
                    avgValidationTime: `${stats.avgValidationTime.toFixed(2)}ms`,
                    errorsByType: stats.errorsByType,
                    errorsBySeverity: stats.errorsBySeverity,
                    cacheHitRate: stats.cacheHitRate
                      ? `${(stats.cacheHitRate * 100).toFixed(1)}%`
                      : 'N/A',
                  },
                  summary: `Validated ${stats.totalValidations} value(s), ${stats.passedValidations} passed, ${stats.failedValidations} failed (${(stats.successRate * 100).toFixed(1)}% success rate)`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  error: 'Failed to fetch validation statistics',
                  message: errorMessage,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // Resource 2: validation://help - Validation capabilities documentation
  server.registerResource(
    'Validation Engine Help',
    'validation://help',
    {
      description:
        'Documentation for the validation engine: data types, formats, custom rules, business logic',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      try {
        const helpText = `# Validation Engine

## Overview
The validation engine provides comprehensive data validation for spreadsheet operations with support for data types, formats, ranges, uniqueness, custom rules, and business logic.

## Key Features

### 1. Data Type Validation
Validates that values match expected data types:
- String, Number, Integer, Boolean
- Date, Time, DateTime
- Email, URL, Phone
- Currency, Percentage

### 2. Range Validation
Validates that numeric values fall within specified ranges:
- Minimum/maximum values
- Exclusive/inclusive boundaries
- Positive/non-negative constraints

### 3. Format Validation
Validates that values match expected formats:
- Regex patterns
- Email format
- URL format
- Phone number format
- Custom format validators

### 4. Uniqueness Validation
Ensures values are unique within a scope:
- Column-level uniqueness
- Sheet-level uniqueness
- Spreadsheet-level uniqueness
- Case-sensitive/insensitive options

### 5. Required Field Validation
Ensures required fields are not empty:
- Not null/undefined
- Not empty string
- Not whitespace-only

### 6. Custom Validation Rules
Define custom validation logic:
- Synchronous validators
- Asynchronous validators
- Custom error messages
- Context-aware validation

### 7. Business Rule Validation
Implement complex business logic:
- Cross-field validation
- Conditional rules
- Workflow-based validation
- Domain-specific rules

## Builtin Validators

### Data Types
- \`builtin_string\`: Validates string type
- \`builtin_number\`: Validates number type
- \`builtin_boolean\`: Validates boolean type
- \`builtin_date\`: Validates date format

### Ranges
- \`builtin_positive\`: Validates positive numbers
- \`builtin_non_negative\`: Validates non-negative numbers

### Formats
- \`builtin_email\`: Validates email format
- \`builtin_url\`: Validates URL format
- \`builtin_phone\`: Validates phone number format

### Required
- \`builtin_required\`: Validates non-empty values
- \`builtin_non_empty_string\`: Validates non-empty strings

## Usage

### Register Custom Rule
\`\`\`typescript
validationEngine.registerRule({
  id: 'custom_age_range',
  name: 'Age Range',
  type: 'range',
  description: 'Validates age is between 0 and 120',
  validator: (value) => {
    const age = Number(value);
    return {
      valid: age >= 0 && age <= 120,
      message: age < 0 ? 'Age cannot be negative' : 'Age must be 120 or less'
    };
  },
  severity: 'error',
  errorMessage: 'Age must be between 0 and 120',
  enabled: true
});
\`\`\`

### Validate Single Value
\`\`\`typescript
const report = await validationEngine.validate(
  'user@example.com',
  {
    spreadsheetId: 'abc123',
    sheetName: 'Users',
    range: 'A1',
    operationType: 'write'
  }
);

if (!report.valid) {
  console.log('Validation failed:');
  report.errors.forEach(err => {
    console.log(\`- \${err.message} (severity: \${err.severity})\`);
  });
}
\`\`\`

### Validate Batch
\`\`\`typescript
const values = ['user1@example.com', 'invalid-email', 'user2@example.com'];
const reports = await validationEngine.validateBatch(values, context);

const invalidValues = reports.filter(r => !r.valid);
console.log(\`\${invalidValues.length} of \${values.length} values failed validation\`);
\`\`\`

### Enable/Disable Rules
\`\`\`typescript
// Disable a specific rule
validationEngine.setRuleEnabled('builtin_email', false);

// Re-enable it
validationEngine.setRuleEnabled('builtin_email', true);
\`\`\`

### Get All Rules
\`\`\`typescript
const rules = validationEngine.getRules();
console.log(\`Total rules: \${rules.length}\`);
rules.forEach(rule => {
  console.log(\`- \${rule.name} (\${rule.type}): \${rule.enabled ? 'enabled' : 'disabled'}\`);
});
\`\`\`

## Validation Report

Each validation returns a comprehensive report:

\`\`\`typescript
{
  id: 'validation-report-uuid',
  valid: false,
  totalChecks: 10,
  passedChecks: 8,
  failedChecks: 2,
  errors: [
    {
      id: 'error-uuid',
      rule: { /* rule that failed */ },
      value: 'invalid-value',
      message: 'Email format is invalid',
      severity: 'error',
      cell: 'A1',
      timestamp: 1234567890,
      suggestions: ['Check for missing @ symbol', 'Verify domain name']
    }
  ],
  warnings: [],
  infoMessages: [],
  duration: 15, // ms
  timestamp: 1234567890,
  context: { /* validation context */ }
}
\`\`\`

## Statistics
View validation statistics at: validation://stats

## Configuration
Set environment variables:
- \`VALIDATION_ENABLED\`: Enable/disable validation (default: true)
- \`VALIDATION_BEFORE_OPERATIONS\`: Validate before operations (default: true)
- \`VALIDATION_STOP_ON_FIRST_ERROR\`: Stop on first error (default: false)
- \`VALIDATION_MAX_ERRORS\`: Max errors to collect (default: 100)
- \`VALIDATION_ASYNC_TIMEOUT\`: Async validation timeout in ms (default: 5000)
- \`VALIDATION_ENABLE_CACHING\`: Enable result caching (default: true)
- \`VALIDATION_CACHE_TTL\`: Cache TTL in ms (default: 300000 = 5 minutes)
- \`VALIDATION_VERBOSE\`: Verbose logging (default: false)

## Performance Features

### Result Caching
Validation results are cached to avoid redundant checks:
- Configurable TTL (default: 5 minutes)
- Automatic cache cleanup
- Cache hit rate tracking

### Async Validation with Timeout
Asynchronous validators have timeout protection:
- Default timeout: 5 seconds
- Prevents hanging validation
- Graceful error handling

### Batch Validation
Validate multiple values efficiently:
- Parallel validation where possible
- Single report per value
- Aggregate statistics

## Error Severity Levels

### Error
Critical validation failures that should block operations:
- Invalid data types
- Required field missing
- Format violations

### Warning
Issues that should be reviewed but may not block operations:
- Suspicious patterns
- Best practice violations
- Potential data issues

### Info
Informational messages:
- Data quality suggestions
- Optional improvements
- Advisory notices

## Example: Pre-Operation Validation

\`\`\`typescript
// Before writing values to a spreadsheet
const values = [
  ['john@example.com', 25, 'Active'],
  ['invalid-email', -5, 'Inactive'],
  ['jane@example.com', 30, 'Active']
];

// Validate each row
for (const [index, row] of values.entries()) {
  const [email, age, status] = row;

  // Validate email
  const emailReport = await validationEngine.validate(email, {
    spreadsheetId: 'abc123',
    sheetName: 'Users',
    range: \`A\${index + 2}\`,
    operationType: 'write'
  });

  // Validate age
  const ageReport = await validationEngine.validate(age, {
    spreadsheetId: 'abc123',
    sheetName: 'Users',
    range: \`B\${index + 2}\`,
    operationType: 'write'
  });

  if (!emailReport.valid || !ageReport.valid) {
    console.log(\`Row \${index + 1} failed validation:\`);
    emailReport.errors.forEach(err => console.log(\`  - \${err.message}\`));
    ageReport.errors.forEach(err => console.log(\`  - \${err.message}\`));
  }
}
\`\`\`

## Cache Management

\`\`\`typescript
// Clear validation cache
validationEngine.clearCache();

// Reset statistics
validationEngine.resetStats();
\`\`\`
`;

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'text/markdown',
              text: helpText,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'text/plain',
              text: `Error fetching validation help: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  // Note: Using console.error for MCP server startup output (visible to user)
  console.error('[ServalSheets] Registered 2 validation resources:');
  console.error('  - validation://stats (validation engine statistics)');
  console.error('  - validation://help (validation engine documentation)');

  return 2;
}
