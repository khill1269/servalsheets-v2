/**
 * Agent Engine — Workflow Templates
 *
 * Pre-built workflow templates for common spreadsheet automation patterns.
 * Templates are used by compileFromTemplate() to create plans without LLM.
 */

// ============================================================================
// Template type definitions
// ============================================================================

/** A standard tool-call step in a workflow template. */
export interface WorkflowTemplateToolStep {
  type?: 'tool_call';
  tool: string;
  action: string;
  description: string;
  paramTemplate: Record<string, unknown>;
}

/** An inject_cross_sheet_lookup step in a workflow template. */
export interface WorkflowTemplateLookupStep {
  type: 'inject_cross_sheet_lookup';
  description?: string;
  config: {
    sourceSheet: string;
    lookupCol: string;
    returnCol: string;
    targetSheet: string;
    targetCol: string;
    targetKeyCol: string;
    startRow: number;
  };
}

export type WorkflowTemplateStep = WorkflowTemplateToolStep | WorkflowTemplateLookupStep;

export interface WorkflowTemplate {
  name: string;
  description: string;
  steps: WorkflowTemplateStep[];
}

// ============================================================================
// Template registry
// ============================================================================

export const WORKFLOW_TEMPLATES: Record<string, WorkflowTemplate> = {
  'setup-new-sheet': {
    name: 'Setup New Sheet',
    description: 'Create a professional spreadsheet with headers, formatting, and frozen rows',
    steps: [
      {
        tool: 'sheets_data',
        action: 'write',
        description: 'Write headers',
        paramTemplate: { range: 'A1' },
      },
      {
        tool: 'sheets_format',
        action: 'set_format',
        description: 'Format header row bold',
        paramTemplate: { range: 'A1:Z1' },
      },
      {
        tool: 'sheets_dimensions',
        action: 'freeze',
        description: 'Freeze header row',
        paramTemplate: { position: '1', dimension: 'ROWS' },
      },
      {
        tool: 'sheets_dimensions',
        action: 'auto_resize',
        description: 'Auto-resize columns',
        paramTemplate: { dimension: 'COLUMNS' },
      },
    ],
  },
  'data-quality-check': {
    name: 'Data Quality Check',
    description: 'Run comprehensive data quality analysis and suggest fixes',
    steps: [
      {
        tool: 'sheets_analyze',
        action: 'scout',
        description: 'Quick scan of sheet structure',
        paramTemplate: {},
      },
      {
        tool: 'sheets_fix',
        action: 'suggest_cleaning',
        description: 'Detect data quality issues',
        paramTemplate: {},
      },
      {
        tool: 'sheets_fix',
        action: 'detect_anomalies',
        description: 'Find statistical outliers',
        paramTemplate: {},
      },
      {
        tool: 'sheets_analyze',
        action: 'suggest_next_actions',
        description: 'Recommend improvements',
        paramTemplate: {},
      },
    ],
  },
  'monthly-report': {
    name: 'Monthly Report',
    description: 'Generate a formatted monthly report with charts and summary',
    steps: [
      {
        tool: 'sheets_data',
        action: 'read',
        description: 'Read source data',
        paramTemplate: {},
      },
      {
        tool: 'sheets_compute',
        action: 'aggregate',
        description: 'Compute summary statistics',
        paramTemplate: {},
      },
      {
        tool: 'sheets_visualize',
        action: 'chart_create',
        description: 'Create summary chart',
        paramTemplate: { chartType: 'BAR' },
      },
      {
        tool: 'sheets_format',
        action: 'apply_preset',
        description: 'Apply professional formatting',
        paramTemplate: { preset: 'professional' },
      },
    ],
  },
  'import-and-clean': {
    name: 'Import and Clean',
    description: 'Import CSV data, clean it, and format for analysis',
    steps: [
      {
        tool: 'sheets_composite',
        action: 'import_csv',
        description: 'Import CSV data',
        paramTemplate: {},
      },
      {
        tool: 'sheets_fix',
        action: 'clean',
        description: 'Auto-clean common data issues',
        paramTemplate: {},
      },
      {
        tool: 'sheets_fix',
        action: 'standardize_formats',
        description: 'Standardize date and number formats',
        paramTemplate: {},
      },
      {
        tool: 'sheets_dimensions',
        action: 'auto_resize',
        description: 'Resize columns to fit',
        paramTemplate: { dimension: 'COLUMNS' },
      },
      {
        tool: 'sheets_dimensions',
        action: 'freeze',
        description: 'Freeze header row',
        paramTemplate: { position: '1', dimension: 'ROWS' },
      },
    ],
  },
  'scenario-analysis': {
    name: 'Scenario Analysis',
    description: 'Build dependency graph and model what-if scenarios',
    steps: [
      {
        tool: 'sheets_dependencies',
        action: 'build',
        description: 'Build formula dependency graph',
        paramTemplate: {},
      },
      {
        tool: 'sheets_dependencies',
        action: 'detect_cycles',
        description: 'Check for circular references',
        paramTemplate: {},
      },
      {
        tool: 'sheets_dependencies',
        action: 'model_scenario',
        description: 'Model scenario impact',
        paramTemplate: {},
      },
    ],
  },
  'multi-sheet-crm': {
    name: 'Multi-Sheet CRM',
    description: 'Customers + Orders + Products sheets with XLOOKUP cross-references',
    steps: [
      {
        type: 'tool_call',
        tool: 'sheets_core',
        action: 'add_sheet',
        description: 'Create Customers sheet',
        paramTemplate: { title: 'Customers' },
      },
      {
        type: 'tool_call',
        tool: 'sheets_core',
        action: 'add_sheet',
        description: 'Create Products sheet',
        paramTemplate: { title: 'Products' },
      },
      {
        type: 'tool_call',
        tool: 'sheets_core',
        action: 'add_sheet',
        description: 'Create Orders sheet',
        paramTemplate: { title: 'Orders' },
      },
      {
        type: 'tool_call',
        tool: 'sheets_data',
        action: 'write',
        description: 'Write Customers headers',
        paramTemplate: {
          range: 'Customers!A1:D1',
          values: [['CustomerID', 'Name', 'Email', 'Region']],
          valueInputOption: 'USER_ENTERED',
        },
      },
      {
        type: 'tool_call',
        tool: 'sheets_data',
        action: 'write',
        description: 'Write Products headers',
        paramTemplate: {
          range: 'Products!A1:D1',
          values: [['ProductID', 'Name', 'Price', 'Category']],
          valueInputOption: 'USER_ENTERED',
        },
      },
      {
        type: 'tool_call',
        tool: 'sheets_data',
        action: 'write',
        description: 'Write Orders headers',
        paramTemplate: {
          range: 'Orders!A1:F1',
          values: [
            ['OrderID', 'CustomerID', 'ProductID', 'Quantity', 'CustomerName', 'ProductName'],
          ],
          valueInputOption: 'USER_ENTERED',
        },
      },
      {
        type: 'inject_cross_sheet_lookup' as const,
        config: {
          sourceSheet: 'Customers',
          lookupCol: 'A',
          returnCol: 'B',
          targetSheet: 'Orders',
          targetCol: 'E',
          targetKeyCol: 'B',
          startRow: 2,
        },
      },
      {
        type: 'inject_cross_sheet_lookup' as const,
        config: {
          sourceSheet: 'Products',
          lookupCol: 'A',
          returnCol: 'B',
          targetSheet: 'Orders',
          targetCol: 'F',
          targetKeyCol: 'C',
          startRow: 2,
        },
      },
    ],
  },
  'budget-vs-actuals': {
    name: 'Budget vs Actuals',
    description: 'Budget, Actuals, and auto-computed Variance sheet',
    steps: [
      {
        type: 'tool_call',
        tool: 'sheets_core',
        action: 'add_sheet',
        description: 'Create Budget sheet',
        paramTemplate: { title: 'Budget' },
      },
      {
        type: 'tool_call',
        tool: 'sheets_core',
        action: 'add_sheet',
        description: 'Create Actuals sheet',
        paramTemplate: { title: 'Actuals' },
      },
      {
        type: 'tool_call',
        tool: 'sheets_core',
        action: 'add_sheet',
        description: 'Create Variance sheet',
        paramTemplate: { title: 'Variance' },
      },
      {
        type: 'tool_call',
        tool: 'sheets_data',
        action: 'write',
        description: 'Write Budget headers',
        paramTemplate: {
          range: 'Budget!A1:E1',
          values: [['Category', 'Q1', 'Q2', 'Q3', 'Q4']],
          valueInputOption: 'USER_ENTERED',
        },
      },
      {
        type: 'tool_call',
        tool: 'sheets_data',
        action: 'write',
        description: 'Write Actuals headers',
        paramTemplate: {
          range: 'Actuals!A1:E1',
          values: [['Category', 'Q1', 'Q2', 'Q3', 'Q4']],
          valueInputOption: 'USER_ENTERED',
        },
      },
      {
        type: 'tool_call',
        tool: 'sheets_data',
        action: 'write',
        description: 'Write Variance headers',
        paramTemplate: {
          range: 'Variance!A1:E1',
          values: [['Category', 'Q1 Variance', 'Q2 Variance', 'Q3 Variance', 'Q4 Variance']],
          valueInputOption: 'USER_ENTERED',
        },
      },
      {
        type: 'tool_call',
        tool: 'sheets_data',
        action: 'write',
        description: 'Write Variance formulas',
        paramTemplate: {
          range: 'Variance!A2:E11',
          values: Array.from({ length: 10 }, (_, i) => [
            `=Budget!A${i + 2}`,
            `=Actuals!B${i + 2}-Budget!B${i + 2}`,
            `=Actuals!C${i + 2}-Budget!C${i + 2}`,
            `=Actuals!D${i + 2}-Budget!D${i + 2}`,
            `=Actuals!E${i + 2}-Budget!E${i + 2}`,
          ]),
          valueInputOption: 'USER_ENTERED',
        },
      },
    ],
  },
  'project-tracker': {
    name: 'Project Tracker',
    description: 'Tasks + Resources + Timeline with XLOOKUP resource assignments',
    steps: [
      {
        type: 'tool_call',
        tool: 'sheets_core',
        action: 'add_sheet',
        description: 'Create Resources sheet',
        paramTemplate: { title: 'Resources' },
      },
      {
        type: 'tool_call',
        tool: 'sheets_core',
        action: 'add_sheet',
        description: 'Create Tasks sheet',
        paramTemplate: { title: 'Tasks' },
      },
      {
        type: 'tool_call',
        tool: 'sheets_core',
        action: 'add_sheet',
        description: 'Create Timeline sheet',
        paramTemplate: { title: 'Timeline' },
      },
      {
        type: 'tool_call',
        tool: 'sheets_data',
        action: 'write',
        description: 'Write Resources headers',
        paramTemplate: {
          range: 'Resources!A1:C1',
          values: [['ResourceID', 'Name', 'Role']],
          valueInputOption: 'USER_ENTERED',
        },
      },
      {
        type: 'tool_call',
        tool: 'sheets_data',
        action: 'write',
        description: 'Write Tasks headers',
        paramTemplate: {
          range: 'Tasks!A1:F1',
          values: [['TaskID', 'Title', 'ResourceID', 'Start', 'End', 'AssigneeName']],
          valueInputOption: 'USER_ENTERED',
        },
      },
      {
        type: 'inject_cross_sheet_lookup' as const,
        config: {
          sourceSheet: 'Resources',
          lookupCol: 'A',
          returnCol: 'B',
          targetSheet: 'Tasks',
          targetCol: 'F',
          targetKeyCol: 'C',
          startRow: 2,
        },
      },
    ],
  },
  'inventory-with-lookups': {
    name: 'Inventory with Lookups',
    description: 'Inventory + Suppliers + Categories with cross-sheet XLOOKUP',
    steps: [
      {
        type: 'tool_call',
        tool: 'sheets_core',
        action: 'add_sheet',
        description: 'Create Categories sheet',
        paramTemplate: { title: 'Categories' },
      },
      {
        type: 'tool_call',
        tool: 'sheets_core',
        action: 'add_sheet',
        description: 'Create Suppliers sheet',
        paramTemplate: { title: 'Suppliers' },
      },
      {
        type: 'tool_call',
        tool: 'sheets_core',
        action: 'add_sheet',
        description: 'Create Inventory sheet',
        paramTemplate: { title: 'Inventory' },
      },
      {
        type: 'tool_call',
        tool: 'sheets_data',
        action: 'write',
        description: 'Write Categories headers',
        paramTemplate: {
          range: 'Categories!A1:B1',
          values: [['CategoryID', 'Name']],
          valueInputOption: 'USER_ENTERED',
        },
      },
      {
        type: 'tool_call',
        tool: 'sheets_data',
        action: 'write',
        description: 'Write Suppliers headers',
        paramTemplate: {
          range: 'Suppliers!A1:C1',
          values: [['SupplierID', 'Name', 'ContactEmail']],
          valueInputOption: 'USER_ENTERED',
        },
      },
      {
        type: 'tool_call',
        tool: 'sheets_data',
        action: 'write',
        description: 'Write Inventory headers',
        paramTemplate: {
          range: 'Inventory!A1:G1',
          values: [
            ['SKU', 'Name', 'CategoryID', 'SupplierID', 'Stock', 'CategoryName', 'SupplierName'],
          ],
          valueInputOption: 'USER_ENTERED',
        },
      },
      {
        type: 'inject_cross_sheet_lookup' as const,
        config: {
          sourceSheet: 'Categories',
          lookupCol: 'A',
          returnCol: 'B',
          targetSheet: 'Inventory',
          targetCol: 'F',
          targetKeyCol: 'C',
          startRow: 2,
        },
      },
      {
        type: 'inject_cross_sheet_lookup' as const,
        config: {
          sourceSheet: 'Suppliers',
          lookupCol: 'A',
          returnCol: 'B',
          targetSheet: 'Inventory',
          targetCol: 'G',
          targetKeyCol: 'D',
          startRow: 2,
        },
      },
    ],
  },
  'dedup-and-sort': {
    name: 'Deduplicate and Sort',
    description: 'Remove duplicates, sort data, and apply formatting',
    steps: [
      {
        tool: 'sheets_composite',
        action: 'deduplicate',
        description: 'Remove duplicate rows',
        paramTemplate: {},
      },
      {
        tool: 'sheets_dimensions',
        action: 'sort_range',
        description: 'Sort data by key column',
        paramTemplate: {},
      },
      {
        tool: 'sheets_format',
        action: 'apply_preset',
        description: 'Apply clean formatting',
        paramTemplate: { preset: 'clean' },
      },
    ],
  },
};
