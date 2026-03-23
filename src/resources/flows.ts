/**
 * ServalSheets Flow Catalog
 *
 * Canonical workflow metadata used by discovery surfaces such as the master
 * index. This is intentionally not an MCP resource registration layer: the
 * runtime exposes the flow information through servalsheets://index and the
 * executable actions live on sheets_analyze (`plan` and `execute_plan`).
 */

import { FlowOrchestrator, type FlowType } from '../analysis/flow-orchestrator.js';

export interface FlowCatalogEntry {
  type: FlowType;
  name: string;
  description: string;
  estimatedTotalMs: number;
  stepCount: number;
  hasMutatingSteps: boolean;
  useWhen: string;
}

const FLOW_DISCOVERY_METADATA: Record<
  FlowType,
  {
    name: string;
    description: string;
    useWhen: string;
  }
> = {
  deep_understanding: {
    name: 'Deep Understanding',
    description:
      'Scout the spreadsheet, score confidence, and build a deeper understanding before taking action.',
    useWhen:
      'Starting work on an unfamiliar spreadsheet or when the user request is broad or ambiguous.',
  },
  smart_cleanup: {
    name: 'Smart Cleanup',
    description:
      'Assess data quality, generate recommended fixes, and prepare a safe cleanup sequence.',
    useWhen: 'Cleaning messy data, resolving duplicates, or fixing inconsistent formatting.',
  },
  sheet_setup: {
    name: 'Sheet Setup',
    description:
      'Recommend structure, create foundational tabs or layout, and prepare a sheet for use.',
    useWhen:
      'Creating a new spreadsheet structure or reorganizing an existing workbook around a goal.',
  },
  data_import: {
    name: 'Data Import',
    description:
      'Ingest data, analyze what arrived, validate it, and prepare the next cleanup or reporting steps.',
    useWhen: 'Importing CSV/XLSX data or migrating data from another source into Sheets.',
  },
  visualization_builder: {
    name: 'Visualization Builder',
    description:
      'Inspect the data shape, choose a visualization approach, and prepare the chart-building path.',
    useWhen: 'Turning existing spreadsheet data into charts, pivots, or dashboards.',
  },
  audit_and_fix: {
    name: 'Audit and Fix',
    description:
      'Run a broader audit across structure, quality, and performance, then recommend remediation.',
    useWhen: 'Reviewing a production spreadsheet end-to-end before making targeted fixes.',
  },
  relationship_mapping: {
    name: 'Relationship Mapping',
    description:
      'Map sheet structure and dependencies to understand how formulas and references connect.',
    useWhen:
      'Debugging formulas, tracing dependencies, or understanding a complex workbook before edits.',
  },
};

const FLOW_TYPES = Object.keys(FLOW_DISCOVERY_METADATA) as FlowType[];
const FLOW_TEMPLATE_SPREADSHEET_ID = '__catalog__';

export function listFlowCatalogEntries(): FlowCatalogEntry[] {
  const orchestrator = new FlowOrchestrator();

  return FLOW_TYPES.map((type) => {
    const definition = orchestrator.buildFlow(type, FLOW_TEMPLATE_SPREADSHEET_ID);
    const metadata = FLOW_DISCOVERY_METADATA[type];

    return {
      type,
      name: metadata.name,
      description: metadata.description,
      estimatedTotalMs: definition.estimatedTotalMs,
      stepCount: definition.steps.length,
      hasMutatingSteps: definition.hasMutatingSteps,
      useWhen: metadata.useWhen,
    };
  });
}

export function getFlowCatalogCount(): number {
  return FLOW_TYPES.length;
}
