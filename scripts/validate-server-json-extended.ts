#!/usr/bin/env tsx
/**
 * Extended server.json Validation
 *
 * Validates server.json beyond basic schema compliance:
 * 1. Metadata counts match source of truth (TOOL_COUNT/ACTION_COUNT)
 * 2. Tools array completeness and accuracy
 * 3. MCP protocol version correctness
 * 4. Required capabilities declared
 * 5. Package metadata fields (for Claude registry)
 *
 * This complements scripts/validate-server-json.mjs which checks JSON schema.
 *
 * Exit codes:
 * - 0: All validations passed
 * - 1: Validation errors detected
 */

import { readFileSync } from 'fs';
import { TOOL_COUNT, ACTION_COUNT } from '../src/schemas/index.js';

console.log('🔍 Running extended server.json validation...\n');

type ServerJsonTool = {
  name?: string;
  description?: string;
  actions?: unknown[];
};

type ServerJsonPackage = {
  registryType?: string;
  identifier?: string;
  version?: string;
  description?: string;
  [key: string]: unknown;
};

type ServerJsonMetadata = {
  toolCount?: number;
  actionCount?: number;
  description?: string;
  categories?: string[];
};

type ServerJson = {
  icons?: Array<{
    src?: string;
    mimeType?: string;
    sizes?: string[];
  }>;
  metadata?: ServerJsonMetadata;
  tools?: ServerJsonTool[];
  packages?: ServerJsonPackage[];
  capabilities?: string[];
  mcpProtocol?: string;
  name?: string;
  version?: string;
  [key: string]: unknown;
};

// ============================================================================
// LOAD server.json
// ============================================================================

let serverJson: ServerJson;

try {
  serverJson = JSON.parse(readFileSync('./server.json', 'utf-8'));
} catch (error) {
  console.error('❌ Failed to load server.json:', (error as Error).message);
  process.exit(1);
}

const errors: string[] = [];
const warnings: string[] = [];

function normalizeSvg(svg: string): string {
  return svg.replace(/>\s+</g, '><').trim();
}

const expectedServerIconDataUri = `data:image/svg+xml;base64,${Buffer.from(
  normalizeSvg(readFileSync('./assets/icon.svg', 'utf-8'))
).toString('base64')}`;

// ============================================================================
// VALIDATION 1: Metadata Section
// ============================================================================

console.log('Validating metadata section...');

if (!serverJson.metadata) {
  errors.push('Missing metadata section');
} else {
  // Tool count
  if (serverJson.metadata.toolCount !== TOOL_COUNT) {
    errors.push(
      `metadata.toolCount (${serverJson.metadata.toolCount}) !== TOOL_COUNT (${TOOL_COUNT})`
    );
  } else {
    console.log(`  ✅ toolCount: ${TOOL_COUNT}`);
  }

  // Action count
  if (serverJson.metadata.actionCount !== ACTION_COUNT) {
    errors.push(
      `metadata.actionCount (${serverJson.metadata.actionCount}) !== ACTION_COUNT (${ACTION_COUNT})`
    );
  } else {
    console.log(`  ✅ actionCount: ${ACTION_COUNT}`);
  }

  // Description should mention counts
  if (serverJson.metadata.description) {
    const hasToolCount = serverJson.metadata.description.includes(`${TOOL_COUNT} tools`);
    const hasActionCount = serverJson.metadata.description.includes(`${ACTION_COUNT} actions`);

    if (!hasToolCount || !hasActionCount) {
      warnings.push(
        `metadata.description should mention "${TOOL_COUNT} tools" and "${ACTION_COUNT} actions"`
      );
    }
  }
}

// ============================================================================
// VALIDATION 1B: Metadata Category Coverage
// ============================================================================

if (serverJson.metadata?.categories && Array.isArray(serverJson.metadata.categories)) {
  const categoryToolNames = serverJson.metadata.categories.flatMap((category: string) => {
    const separatorIndex = category.indexOf(':');
    if (separatorIndex === -1) {
      return [];
    }

    return category
      .slice(separatorIndex + 1)
      .split(',')
      .map((value: string) => value.trim())
      .filter(Boolean);
  });

  const declaredToolNames = (serverJson.tools ?? []).map((tool: ServerJsonTool) =>
    String(tool.name).replace(/^sheets_/, '')
  );
  const missingFromCategories = declaredToolNames.filter(
    (tool: string) => !categoryToolNames.includes(tool)
  );
  const extraInCategories = categoryToolNames.filter(
    (tool: string) => !declaredToolNames.includes(tool)
  );
  const duplicateCategoryTools = categoryToolNames.filter(
    (tool: string, index: number, array: string[]) => array.indexOf(tool) !== index
  );

  if (missingFromCategories.length > 0) {
    errors.push(`metadata.categories missing tools: ${missingFromCategories.join(', ')}`);
  }
  if (extraInCategories.length > 0) {
    errors.push(`metadata.categories references unknown tools: ${extraInCategories.join(', ')}`);
  }
  if (duplicateCategoryTools.length > 0) {
    errors.push(
      `metadata.categories duplicates tools: ${Array.from(new Set(duplicateCategoryTools)).join(', ')}`
    );
  }

  if (
    missingFromCategories.length === 0 &&
    extraInCategories.length === 0 &&
    duplicateCategoryTools.length === 0
  ) {
    console.log(
      `  ✅ metadata.categories covers all ${declaredToolNames.length} tools exactly once`
    );
  }
}

// ============================================================================
// VALIDATION 2: Tools Array
// ============================================================================

console.log('\nValidating tools array...');

if (!serverJson.tools || !Array.isArray(serverJson.tools)) {
  errors.push('Missing or invalid tools array');
} else {
  // Tool count matches
  if (serverJson.tools.length !== TOOL_COUNT) {
    errors.push(`tools array length (${serverJson.tools.length}) !== TOOL_COUNT (${TOOL_COUNT})`);
  } else {
    console.log(`  ✅ tools array length: ${TOOL_COUNT}`);
  }

  // Sum of actions matches
  const totalActionsInTools = serverJson.tools.reduce(
    (sum: number, tool: ServerJsonTool) => sum + (tool.actions?.length || 0),
    0
  );

  if (totalActionsInTools !== ACTION_COUNT) {
    errors.push(`Sum of tool actions (${totalActionsInTools}) !== ACTION_COUNT (${ACTION_COUNT})`);
  } else {
    console.log(`  ✅ total actions in tools: ${ACTION_COUNT}`);
  }

  // Each tool has required fields
  const requiredToolFields = ['name', 'description', 'actions'];
  let toolsWithMissingFields = 0;

  for (const tool of serverJson.tools) {
    for (const field of requiredToolFields) {
      if (!tool[field]) {
        errors.push(`Tool "${tool.name || 'unknown'}" missing required field: ${field}`);
        toolsWithMissingFields++;
      }
    }
  }

  if (toolsWithMissingFields === 0) {
    console.log(`  ✅ all tools have required fields`);
  }

  // Tool names follow convention
  const invalidToolNames = serverJson.tools.filter(
    (tool: ServerJsonTool) => !tool.name?.startsWith('sheets_')
  );

  if (invalidToolNames.length > 0) {
    errors.push(`${invalidToolNames.length} tools don't follow sheets_* naming convention`);
  } else {
    console.log(`  ✅ all tool names follow sheets_* convention`);
  }
}

// ============================================================================
// VALIDATION 3: MCP Protocol Version
// ============================================================================

console.log('\nValidating MCP protocol version...');

const expectedProtocolVersion = '2025-11-25';

if (serverJson.mcpProtocol !== expectedProtocolVersion) {
  errors.push(
    `Incorrect mcpProtocol version: "${serverJson.mcpProtocol}" (expected "${expectedProtocolVersion}")`
  );
} else {
  console.log(`  ✅ mcpProtocol: ${expectedProtocolVersion}`);
}

// ============================================================================
// VALIDATION 4: Required Capabilities
// ============================================================================

console.log('\nValidating capabilities...');

const requiredCapabilities = ['tools', 'resources', 'prompts', 'logging', 'completions'];

if (!serverJson.capabilities || !Array.isArray(serverJson.capabilities)) {
  errors.push('Missing or invalid capabilities array');
} else {
  const missingCapabilities = requiredCapabilities.filter(
    (cap) => !serverJson.capabilities.includes(cap)
  );

  if (missingCapabilities.length > 0) {
    errors.push(`Missing required capabilities: ${missingCapabilities.join(', ')}`);
  } else {
    console.log(`  ✅ all required capabilities present (${requiredCapabilities.length})`);
  }
}

// ============================================================================
// VALIDATION 4B: Inline Server Icon
// ============================================================================

console.log('\nValidating inline server icon...');

if (!serverJson.icons || !Array.isArray(serverJson.icons) || serverJson.icons.length === 0) {
  errors.push('Missing top-level server icons array');
} else {
  const [icon] = serverJson.icons;
  if (!icon?.src?.startsWith('data:image/svg+xml;base64,')) {
    errors.push('server.json icon must be an inline SVG data URI');
  } else if (icon.src !== expectedServerIconDataUri) {
    errors.push('server.json icon does not match assets/icon.svg');
  }

  if (icon?.mimeType !== 'image/svg+xml') {
    errors.push(`server.json icon mimeType must be "image/svg+xml" (got "${icon?.mimeType}")`);
  }

  if (!icon?.sizes?.includes('24x24')) {
    errors.push('server.json icon sizes must include 24x24');
  }

  if (icon?.src === expectedServerIconDataUri && icon?.mimeType === 'image/svg+xml') {
    console.log('  ✅ inline icon matches assets/icon.svg');
  }
}

// ============================================================================
// VALIDATION 5: Package Metadata (for Claude Registry)
// ============================================================================

console.log('\nValidating package metadata...');

if (!serverJson.packages || !Array.isArray(serverJson.packages)) {
  warnings.push('Missing packages array (recommended for Claude registry)');
} else {
  const requiredPackageFields = ['identifier', 'version', 'description'];

  for (const pkg of serverJson.packages) {
    for (const field of requiredPackageFields) {
      if (!pkg[field]) {
        warnings.push(`Package missing recommended field: ${field}`);
      }
    }

    // Check for registry-specific fields (optional but recommended)
    if (!pkg.registryType) {
      warnings.push(`Package "${pkg.identifier || 'unknown'}" missing registryType (e.g., "npm")`);
    }
    if (!pkg.identifier) {
      warnings.push(`Package "${pkg.identifier || 'unknown'}" missing identifier`);
    }
  }

  if (serverJson.packages.length > 0) {
    console.log(`  ✅ packages array present (${serverJson.packages.length} packages)`);
  }
}

// ============================================================================
// VALIDATION 6: Sanity Checks
// ============================================================================

console.log('\nRunning sanity checks...');

// Server info
if (!serverJson.name) {
  errors.push('Missing server name');
} else {
  console.log(`  ✅ server name: ${serverJson.name}`);
}

if (!serverJson.version) {
  errors.push('Missing server version');
} else {
  console.log(`  ✅ server version: ${serverJson.version}`);
}

// Schema size check
const serverJsonSize = JSON.stringify(serverJson).length;
const sizeKB = (serverJsonSize / 1024).toFixed(2);

console.log(`  ℹ️  server.json size: ${sizeKB} KB`);

if (serverJsonSize > 1024 * 1024) {
  // > 1MB
  warnings.push(`server.json is very large (${sizeKB} KB) - consider optimization`);
}

// ============================================================================
// SUMMARY AND EXIT
// ============================================================================

console.log('\n' + '='.repeat(70));

if (warnings.length > 0) {
  console.log('\n⚠️  WARNINGS:\n');
  warnings.forEach((w) => console.log(`  ${w}`));
}

if (errors.length === 0) {
  console.log('\n✅ EXTENDED VALIDATION PASSED');
  console.log(`\n   ${TOOL_COUNT} tools, ${ACTION_COUNT} actions`);
  console.log(`   MCP Protocol: ${expectedProtocolVersion}`);
  console.log(`   All metadata is accurate and complete.\n`);
  process.exit(0);
} else {
  console.log('\n❌ EXTENDED VALIDATION FAILED\n');
  console.log(`   Found ${errors.length} error(s):\n`);

  errors.forEach((e) => {
    console.error(`   - ${e}`);
  });

  console.log('\n   Run "npm run gen:metadata" to regenerate server.json.\n');
  process.exit(1);
}
