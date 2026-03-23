#!/usr/bin/env tsx
/**
 * Checks all tool descriptions for instruction-injection patterns.
 * Exit: 0 = clean, 1 = found patterns
 */
import { TOOL_DEFINITIONS } from '../src/mcp/registration/tool-definitions.js';

const INJECTION_PATTERNS = [
  /ignore previous/i,
  /system:/i,
  /assistant:/i,
  /do not tell/i,
  /\boverride\b.*\binstruction/i,
  /follow this instruction/i,
  /you are now/i,
  /pretend to be/i,
  /disregard/i,
];

const errors: string[] = [];

for (const tool of TOOL_DEFINITIONS) {
  // Check tool description
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(tool.description ?? '')) {
      errors.push(`Tool ${tool.name}: description matches injection pattern /${pattern.source}/`);
    }
  }
  // Check each input schema property description
  const props = ((tool.inputSchema as Record<string, unknown>)?.properties ?? {}) as Record<
    string,
    { description?: string }
  >;
  for (const [key, val] of Object.entries(props)) {
    if (val?.description) {
      for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(val.description)) {
          errors.push(
            `Tool ${tool.name}.${key}: parameter description matches /${pattern.source}/`
          );
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error('Tool description injection patterns found:');
  errors.forEach((e) => console.error(`  ${e}`));
  process.exit(1);
} else {
  console.log(`All ${TOOL_DEFINITIONS.length} tool descriptions clean`);
  process.exit(0);
}
