/**
 * ServalSheets Prompt Catalog
 *
 * Scenario-grouped prompt discovery data used by discovery surfaces such as the
 * master index and server card. The executable prompt surface remains
 * prompts/list and prompts/get; this module only provides metadata.
 */

export interface PromptEntry {
  name: string;
  description: string;
}

export interface PromptBucket {
  description: string;
  whenToUse: string;
  prompts: PromptEntry[];
}

export interface PromptCatalogBucketSummary extends PromptBucket {
  id: string;
  promptCount: number;
}

const PROMPT_CATALOG: Record<string, PromptBucket> = {
  first_time: {
    description: 'Onboarding and initial setup prompts',
    whenToUse:
      'When a user is new to ServalSheets and should be guided from readiness to first success',
    prompts: [
      {
        name: 'welcome',
        description: 'Guided introduction that starts with readiness and next-step routing',
      },
      {
        name: 'test_connection',
        description: 'Verify readiness, authentication, and a real public-sheet read',
      },
      {
        name: 'first_operation',
        description: 'Walk through the first useful task after readiness is verified',
      },
      {
        name: 'full_setup',
        description: 'End-to-end workspace setup using the canonical readiness-first ladder',
      },
    ],
  },
  analyze: {
    description: 'Spreadsheet analysis and insight extraction',
    whenToUse: 'When user wants to understand data, get summaries, or compare spreadsheets',
    prompts: [
      { name: 'analyze_spreadsheet', description: 'Comprehensive analysis of a spreadsheet' },
      { name: 'auto_analyze', description: 'Automated analysis with AI-generated insights' },
      {
        name: 'ultimate_analysis',
        description: 'Deep multi-pass analysis with scoring and recommendations',
      },
      { name: 'compare_spreadsheets', description: 'Side-by-side comparison of two spreadsheets' },
      {
        name: 'analyze_with_history',
        description: 'Analysis that includes version history and change tracking',
      },
      {
        name: 'performance_audit',
        description: 'Identify slow formulas, excess volatility, calculation bottlenecks',
      },
    ],
  },
  clean_data: {
    description: 'Data quality, cleaning, and normalization',
    whenToUse: 'When data has errors, inconsistencies, formatting issues, or duplicates',
    prompts: [
      { name: 'clean_data', description: 'Interactive guided data cleaning workflow' },
      {
        name: 'automated_data_cleaning',
        description: 'Fully automated cleaning with AI decisions',
      },
      {
        name: 'fix_data_quality',
        description: 'Target and fix specific quality issues (blanks, types, outliers)',
      },
      {
        name: 'masterclass_data_quality',
        description: 'Expert-level data quality standards and validation patterns',
      },
    ],
  },
  import_export: {
    description: 'Data import, export, and migration',
    whenToUse:
      'When moving data into or out of Google Sheets from CSV, Excel, databases, or other sheets',
    prompts: [
      { name: 'import_data', description: 'Import data from CSV, Excel, or external source' },
      { name: 'bulk_import', description: 'High-volume import with progress tracking' },
      {
        name: 'bulk_import_data',
        description: 'Bulk import with schema validation and error handling',
      },
      {
        name: 'advanced_data_migration',
        description: 'Complex migration with transformation rules and mapping',
      },
      { name: 'migrate_data', description: 'Migrate data between sheets or spreadsheets' },
      {
        name: 'migrate_spreadsheet',
        description: 'Full spreadsheet migration with structure and data',
      },
    ],
  },
  automate: {
    description: 'Automation, pipelines, and sheet generation',
    whenToUse:
      'When user wants to create automation, set up recurring workflows, or generate a sheet from a description',
    prompts: [
      {
        name: 'generate_sheet_from_description',
        description: 'Generate a complete sheet from a natural language description',
      },
      {
        name: 'full_setup',
        description: 'Complete project setup from scratch, including readiness verification',
      },
      { name: 'batch_optimizer', description: 'Optimize batch operations for quota efficiency' },
      {
        name: 'data_pipeline',
        description: 'Set up an automated data ingestion and processing pipeline',
      },
    ],
  },
  troubleshoot: {
    description: 'Debugging, error recovery, and undo',
    whenToUse:
      'When something went wrong: formula errors, data loss, performance issues, unexpected results',
    prompts: [
      {
        name: 'diagnose_errors',
        description: 'Find and diagnose formula and data errors (#REF!, #VALUE!, etc.)',
      },
      {
        name: 'recover_from_error',
        description: 'Step-by-step recovery from a specific error code',
      },
      { name: 'troubleshoot_performance', description: 'Debug slow spreadsheet performance' },
      {
        name: 'undo_changes',
        description: 'Safely undo recent operations with history inspection',
      },
    ],
  },
  formulas: {
    description: 'Formula generation, optimization, and education',
    whenToUse: 'When working with formulas: creating, debugging, optimizing, or learning',
    prompts: [
      {
        name: 'optimize_formulas',
        description: 'Reduce formula complexity and improve calculation speed',
      },
      {
        name: 'masterclass_formulas',
        description: 'Advanced formula patterns: LAMBDA, MAP, SCAN, array formulas',
      },
      {
        name: 'masterclass_performance',
        description: 'Formula performance tuning and volatile function reduction',
      },
    ],
  },
  collaborate: {
    description: 'Sharing, permissions, and team workflows',
    whenToUse:
      'When managing who can access or edit a spreadsheet, reviewing audit trails, or setting up safe-operation guidelines',
    prompts: [
      { name: 'setup_collaboration', description: 'Configure sharing, comments, and team access' },
      { name: 'audit_security', description: 'Audit current permissions and sharing settings' },
      {
        name: 'safe_operation',
        description: 'Guidelines for making changes safely in shared spreadsheets',
      },
      {
        name: 'audit_sheet',
        description: 'Full audit: data quality, formulas, permissions, history',
      },
      { name: 'publish_report', description: 'Prepare and publish a sheet as a shareable report' },
    ],
  },
  visualize: {
    description: 'Charts, dashboards, and pivot tables',
    whenToUse: 'When user wants to create visual representations of data',
    prompts: [
      {
        name: 'create_visualization',
        description: 'Create charts or pivot tables from sheet data',
      },
      {
        name: 'create_report',
        description: 'Generate a structured report with charts and formatting',
      },
      { name: 'analyze_with_history', description: 'Analysis with historical trend visualization' },
    ],
  },
  advanced: {
    description: 'Advanced workflows: scenarios, federation, templates, and AI assistance',
    whenToUse:
      'For power users: what-if modeling, cross-spreadsheet workflows, template management, or AI suggestions',
    prompts: [
      { name: 'what_if_scenario_modeling', description: 'Build and compare what-if scenarios' },
      {
        name: 'cross_spreadsheet_federation',
        description: 'Query and combine data across multiple spreadsheets',
      },
      {
        name: 'smart_suggestions_copilot',
        description: 'AI-powered suggestions for next actions based on current data',
      },
      { name: 'instantiate_template', description: 'Create a new sheet from a saved template' },
      { name: 'transform_data', description: 'Transform data structure, pivot, or reshape' },
      {
        name: 'setup_budget',
        description: 'Set up a budget tracking spreadsheet with formulas and charts',
      },
      {
        name: 'when_to_confirm',
        description: 'Learn when to use confirmation before destructive operations',
      },
      {
        name: 'confirmation_examples',
        description: 'Examples of confirmation workflows for safe mutations',
      },
      {
        name: 'scenario_multi_user',
        description: 'Multi-user scenario with concurrent editing patterns',
      },
      {
        name: 'challenge_quality_detective',
        description: 'Gamified data quality challenge workflow',
      },
      {
        name: 'challenge_performance_profiler',
        description: 'Performance profiling challenge workflow',
      },
    ],
  },
};

export function listPromptCatalogBuckets(): PromptCatalogBucketSummary[] {
  return Object.entries(PROMPT_CATALOG).map(([id, bucket]) => ({
    id,
    description: bucket.description,
    whenToUse: bucket.whenToUse,
    prompts: bucket.prompts.map((prompt) => ({ ...prompt })),
    promptCount: bucket.prompts.length,
  }));
}

export function getPromptsCatalogCount(): number {
  const promptNames = new Set<string>();
  for (const bucket of Object.values(PROMPT_CATALOG)) {
    for (const prompt of bucket.prompts) {
      promptNames.add(prompt.name);
    }
  }
  return promptNames.size;
}
