import { ValidationError } from '../../core/errors.js';

export const MCP_TOOL_NAME_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

export function getToolNameValidationMessage(name: string): string {
  return (
    `Tool name "${name}" violates MCP naming rules: ` +
    'use only letters, numbers, hyphens, and underscores, with a maximum length of 64 characters'
  );
}

export function assertValidMcpToolNames(tools: readonly { name: string }[]): void {
  for (const tool of tools) {
    if (!MCP_TOOL_NAME_REGEX.test(tool.name)) {
      throw new ValidationError(getToolNameValidationMessage(tool.name), 'toolName');
    }
  }
}
