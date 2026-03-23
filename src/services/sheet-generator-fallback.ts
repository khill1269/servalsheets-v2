import type { GenerateOptions, SheetDefinition } from './sheet-generator-types.js';

export function generateFallback(description: string, options: GenerateOptions): SheetDefinition {
  // Extract key terms to build a reasonable template
  const lower = description.toLowerCase();
  const title = extractTitle(description);

  const isFinancial = /budget|revenue|expense|cost|profit|financial|invoice|sales/.test(lower);
  const isTracker = /track|log|schedule|timeline|plan|project/.test(lower);
  const isInventory = /inventory|stock|product|catalog|item/.test(lower);
  const isDashboard = /dashboard|kpi|metric|scorecard/.test(lower);
  const isHR = /\b(hr|headcount|employee|personnel|staff|team|hiring|attrition)\b/.test(lower);
  const isBudgetActuals = /budget.*actual|actual.*budget|variance/.test(lower);

  if (isBudgetActuals) return buildBudgetActualsTemplate(title, options);
  if (isFinancial) return buildFinancialTemplate(title, options);
  if (isDashboard) return buildDashboardTemplate(title, options);
  if (isHR) return buildHRTemplate(title, options);
  if (isTracker) return buildTrackerTemplate(title, options);
  if (isInventory) return buildInventoryTemplate(title, options);

  // Generic table
  return buildGenericTemplate(title, description, options);
}

function extractTitle(description: string): string {
  // Take first 50 chars, capitalize words
  const raw = description
    .slice(0, 50)
    .replace(/[^\w\s]/g, '')
    .trim();
  return raw
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildFinancialTemplate(title: string, _options: GenerateOptions): SheetDefinition {
  return {
    title,
    sheets: [
      {
        name: 'Financial Data',
        columns: [
          { header: 'Category', type: 'text', width: 180 },
          { header: 'Jan', type: 'currency', width: 120 },
          { header: 'Feb', type: 'currency', width: 120 },
          { header: 'Mar', type: 'currency', width: 120 },
          { header: 'Q1 Total', type: 'formula', width: 130, formula: '=SUM(B{row}:D{row})' },
          {
            header: 'Avg Monthly',
            type: 'formula',
            width: 130,
            formula: '=AVERAGE(B{row}:D{row})',
          },
        ],
        rows: [
          { values: ['Revenue', 50000, 55000, 60000, null, null] },
          { values: ['COGS', 20000, 22000, 24000, null, null] },
          {
            values: ['Gross Profit', null, null, null, null, null],
            formulas: ['=B2-B3', '=C2-C3', '=D2-D3', null, null],
          },
          { values: ['Operating Expenses', 15000, 16000, 17000, null, null] },
          {
            values: ['Net Income', null, null, null, null, null],
            formulas: ['=B4-B5', '=C4-C5', '=D4-D5', null, null],
          },
        ],
        formatting: {
          headerStyle: 'bold_blue_background',
          numberFormat: '$#,##0',
          freezeRows: 1,
          freezeColumns: 0,
          alternatingRows: true,
          conditionalRules: [{ range: 'E2:F100', rule: 'negative_red' }],
        },
      },
    ],
  };
}

function buildTrackerTemplate(title: string, _options: GenerateOptions): SheetDefinition {
  return {
    title,
    sheets: [
      {
        name: 'Tracker',
        columns: [
          { header: 'ID', type: 'number', width: 60 },
          { header: 'Item', type: 'text', width: 250 },
          { header: 'Status', type: 'text', width: 120 },
          { header: 'Priority', type: 'text', width: 100 },
          { header: 'Start Date', type: 'date', width: 120 },
          { header: 'Due Date', type: 'date', width: 120 },
          { header: 'Owner', type: 'text', width: 150 },
          { header: 'Notes', type: 'text', width: 250 },
        ],
        rows: [
          {
            values: [
              1,
              'Sample task 1',
              'In Progress',
              'High',
              '2026-01-15',
              '2026-02-15',
              'Alice',
              '',
            ],
          },
          {
            values: [
              2,
              'Sample task 2',
              'Not Started',
              'Medium',
              '2026-01-20',
              '2026-03-01',
              'Bob',
              '',
            ],
          },
          {
            values: [
              3,
              'Sample task 3',
              'Complete',
              'Low',
              '2026-01-10',
              '2026-01-30',
              'Carol',
              '',
            ],
          },
        ],
        formatting: {
          headerStyle: 'bold_blue_background',
          freezeRows: 1,
          freezeColumns: 0,
          alternatingRows: true,
        },
      },
    ],
  };
}

function buildInventoryTemplate(title: string, _options: GenerateOptions): SheetDefinition {
  return {
    title,
    sheets: [
      {
        name: 'Inventory',
        columns: [
          { header: 'SKU', type: 'text', width: 100 },
          { header: 'Product Name', type: 'text', width: 250 },
          { header: 'Category', type: 'text', width: 130 },
          { header: 'Unit Price', type: 'currency', width: 110 },
          { header: 'Qty In Stock', type: 'number', width: 110 },
          { header: 'Reorder Level', type: 'number', width: 110 },
          { header: 'Total Value', type: 'formula', width: 120, formula: '=D{row}*E{row}' },
          {
            header: 'Needs Reorder',
            type: 'formula',
            width: 120,
            formula: '=IF(E{row}<=F{row},"YES","")',
          },
        ],
        rows: [
          { values: ['SKU-001', 'Widget A', 'Hardware', 12.99, 150, 50, null, null] },
          { values: ['SKU-002', 'Widget B', 'Hardware', 24.99, 30, 25, null, null] },
          { values: ['SKU-003', 'Gadget C', 'Electronics', 89.99, 75, 20, null, null] },
        ],
        formatting: {
          headerStyle: 'bold_blue_background',
          numberFormat: '$#,##0.00',
          freezeRows: 1,
          freezeColumns: 0,
          alternatingRows: true,
          conditionalRules: [{ range: 'H2:H100', rule: 'negative_red' }],
        },
      },
    ],
  };
}

function buildDashboardTemplate(title: string, _options: GenerateOptions): SheetDefinition {
  return {
    title,
    sheets: [
      {
        name: 'Dashboard',
        columns: [
          { header: 'KPI', type: 'text', width: 200 },
          { header: 'Target', type: 'number', width: 110 },
          { header: 'Actual', type: 'number', width: 110 },
          { header: 'Variance', type: 'formula', width: 110, formula: '=C{row}-B{row}' },
          {
            header: 'Variance %',
            type: 'formula',
            width: 110,
            formula: '=IF(B{row}<>0,(C{row}-B{row})/B{row},0)',
          },
          {
            header: 'Trend',
            type: 'formula',
            width: 120,
            formula: '=SPARKLINE({C{row}},{"charttype","bar"})',
          },
        ],
        rows: [
          { values: ['Revenue', 100000, 95000, null, null, null] },
          { values: ['New Customers', 500, 520, null, null, null] },
          { values: ['Churn Rate', 0.05, 0.04, null, null, null] },
          { values: ['NPS Score', 70, 75, null, null, null] },
        ],
        formatting: {
          headerStyle: 'bold_gray_background',
          numberFormat: '#,##0',
          freezeRows: 1,
          freezeColumns: 1,
          alternatingRows: true,
          conditionalRules: [{ range: 'E2:E100', rule: 'negative_red' }],
        },
      },
    ],
  };
}

function buildHRTemplate(title: string, _options: GenerateOptions): SheetDefinition {
  return {
    title,
    sheets: [
      {
        name: 'Headcount',
        columns: [
          { header: 'Employee Name', type: 'text', width: 180 },
          { header: 'Department', type: 'text', width: 140 },
          { header: 'Title', type: 'text', width: 180 },
          { header: 'Start Date', type: 'date', width: 120 },
          {
            header: 'Tenure (months)',
            type: 'formula',
            width: 130,
            formula: '=DATEDIF(D{row},TODAY(),"M")',
          },
          { header: 'Status', type: 'text', width: 100 },
          { header: 'Manager', type: 'text', width: 150 },
        ],
        rows: [
          {
            values: [
              'Alice Johnson',
              'Engineering',
              'Senior Engineer',
              '2023-03-15',
              null,
              'Active',
              'Bob Smith',
            ],
          },
          {
            values: [
              'Carol Williams',
              'Marketing',
              'Marketing Manager',
              '2024-01-10',
              null,
              'Active',
              'Dave Brown',
            ],
          },
          {
            values: [
              'Eve Davis',
              'Engineering',
              'Junior Engineer',
              '2025-06-01',
              null,
              'Active',
              'Alice Johnson',
            ],
          },
        ],
        formatting: {
          headerStyle: 'bold_blue_background',
          freezeRows: 1,
          freezeColumns: 0,
          alternatingRows: true,
        },
      },
    ],
  };
}

function buildBudgetActualsTemplate(title: string, _options: GenerateOptions): SheetDefinition {
  return {
    title,
    sheets: [
      {
        name: 'Budget vs Actuals',
        columns: [
          { header: 'Category', type: 'text', width: 180 },
          { header: 'Budget', type: 'currency', width: 120 },
          { header: 'Actual', type: 'currency', width: 120 },
          { header: 'Variance', type: 'formula', width: 120, formula: '=C{row}-B{row}' },
          {
            header: 'Variance %',
            type: 'formula',
            width: 110,
            formula: '=IF(B{row}<>0,(C{row}-B{row})/B{row},0)',
          },
          {
            header: 'Status',
            type: 'formula',
            width: 100,
            formula: '=IF(ABS(E{row})>0.1,"Over","On Track")',
          },
        ],
        rows: [
          { values: ['Revenue', 100000, 105000, null, null, null] },
          { values: ['Salaries', 50000, 52000, null, null, null] },
          { values: ['Marketing', 15000, 18000, null, null, null] },
          { values: ['Operations', 20000, 19000, null, null, null] },
          {
            values: ['Total', null, null, null, null, null],
            formulas: ['=SUM(B2:B5)', '=SUM(C2:C5)', null, null, null],
          },
        ],
        formatting: {
          headerStyle: 'bold_blue_background',
          numberFormat: '$#,##0',
          freezeRows: 1,
          freezeColumns: 1,
          alternatingRows: true,
          conditionalRules: [{ range: 'D2:D100', rule: 'negative_red' }],
        },
      },
    ],
  };
}

function buildGenericTemplate(
  title: string,
  description: string,
  _options: GenerateOptions
): SheetDefinition {
  // Extract potential column names from the description
  const words = description
    .replace(/[^\w\s,]/g, '')
    .split(/[\s,]+/)
    .filter(
      (w) => w.length > 2 && !/^(and|the|for|with|from|that|this|will|have|been|each)$/i.test(w)
    );

  const columnHeaders = words.slice(0, Math.min(6, words.length));
  if (columnHeaders.length < 2) {
    columnHeaders.push('Name', 'Value', 'Notes');
  }

  return {
    title,
    sheets: [
      {
        name: 'Sheet1',
        columns: columnHeaders.map((h) => ({
          header: h.charAt(0).toUpperCase() + h.slice(1),
          type: 'text' as const,
          width: 150,
        })),
        rows: [],
        formatting: {
          headerStyle: 'bold_blue_background',
          freezeRows: 1,
          freezeColumns: 0,
          alternatingRows: false,
        },
      },
    ],
  };
}
