/**
 * AST Schema Parser Utilities
 *
 * Shared TypeScript AST parsing utilities for extracting schema actions and handler cases.
 * Used by both validation scripts and contract tests to ensure single source of truth.
 *
 * Supports 4 schema patterns:
 * 1. Discriminated Union: z.discriminatedUnion('action', [Schema1, Schema2, ...])
 * 2. Direct Enum: action: z.enum(['action1', 'action2', ...])
 * 3. Standalone Enum: export const ActionSchema = z.enum([...])
 * 4. Nested Object: request: z.object({ action: z.enum([...]) })
 *
 * Supports 3 handler patterns:
 * 1. Direct switch: switch (req.action)
 * 2. Destructured: const { action } = req; switch (action)
 * 3. Type cast: switch ((req as Type).action)
 *
 * @module utils/ast-schema-parser
 */

import * as ts from 'typescript';
import * as fs from 'fs';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Extract action names from schema file
 * Returns sorted array of action strings
 */
export function extractSchemaActions(schemaPath: string): string[] {
  const content = fs.readFileSync(schemaPath, 'utf-8');
  const sourceFile = ts.createSourceFile(schemaPath, content, ts.ScriptTarget.Latest, true);

  const actions = new Set<string>();
  const schemaNames = new Set<string>();

  // Pattern 1: Find discriminated union
  findDiscriminatedUnion(sourceFile, schemaNames, actions);

  // Pattern 2: Find standalone action enum (federation.ts)
  findStandaloneActionEnum(sourceFile, actions);

  // Pattern 3: Find direct action enum (collaborate.ts, nested objects)
  findDirectActionEnum(sourceFile, actions);

  // Pattern 4: Extract action literals from schema definitions
  extractActionFromSchemas(sourceFile, schemaNames, actions);

  return Array.from(actions).sort();
}

/**
 * Extract top-level case statements from handler
 * Returns sorted array of case strings
 */
export function extractHandlerCases(handlerPath: string): string[] {
  const content = fs.readFileSync(handlerPath, 'utf-8');
  const sourceFile = ts.createSourceFile(handlerPath, content, ts.ScriptTarget.Latest, true);

  const cases = new Set<string>();
  let foundMainSwitch = false;

  function visitNode(node: ts.Node): void {
    // Look for method declarations that execute actions
    if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const methodName = node.name.text;

      // Pattern 1: executeAction, executeFormatAction, execute...Operation, etc.
      const isExecuteMethod =
        methodName.includes('execute') &&
        (methodName.includes('Action') ||
          methodName.includes('Operation') ||
          methodName === 'execute');

      // Pattern 2: handle method (for some handlers like fix, session)
      const isHandleMethod = methodName === 'handle';

      if (isExecuteMethod || isHandleMethod) {
        findActionSwitch(node);
      }
    }

    // Also check for standalone functions (session.ts uses handleSheetsSession function)
    if (ts.isFunctionDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const functionName = node.name.text;
      if (
        functionName.startsWith('handle') &&
        (functionName.includes('Sheets') || functionName.includes('Action'))
      ) {
        findActionSwitch(node);
      }
    }

    ts.forEachChild(node, visitNode);
  }

  function findActionSwitch(node: ts.Node): void {
    if (ts.isSwitchStatement(node) && !foundMainSwitch) {
      const expr = unwrapExpression(node.expression);

      let isActionSwitch = false;

      // Pattern 1: switch (req.action) or switch (request.action)
      if (
        ts.isPropertyAccessExpression(expr) &&
        ts.isIdentifier(expr.name) &&
        expr.name.text === 'action'
      ) {
        isActionSwitch = true;
      }

      // Pattern 2: const { action } = req; switch (action)
      // Switch directly on an identifier named 'action'
      if (ts.isIdentifier(expr) && expr.text === 'action') {
        isActionSwitch = true;
      }

      if (isActionSwitch) {
        foundMainSwitch = true;

        // Extract all case clauses
        for (const clause of node.caseBlock.clauses) {
          if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression)) {
            cases.add(clause.expression.text);
          }
        }
      }
    }

    ts.forEachChild(node, findActionSwitch);
  }

  visitNode(sourceFile);
  return Array.from(cases).sort();
}

/**
 * Unwrap type casts and parentheses to get the actual expression
 * Handles: (expr), expr as Type, <Type>expr
 */
export function unwrapExpression(expr: ts.Expression): ts.Expression {
  // Handle: expr as Type
  if (ts.isAsExpression(expr)) {
    return unwrapExpression(expr.expression);
  }
  // Handle: (expr)
  if (ts.isParenthesizedExpression(expr)) {
    return unwrapExpression(expr.expression);
  }
  // Handle: <Type>expr (TypeAssertion in older TS, NonNullExpression in newer)
  if ('expression' in expr && 'type' in expr) {
    return unwrapExpression((expr as { expression: ts.Expression; type: unknown }).expression);
  }
  return expr;
}

/**
 * Check if node is inside an output/result schema (to avoid false positives)
 */
export function isInsideOutputSchema(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    // Check if parent is a variable declaration with Output/Result/Response in name
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      (current.name.text.includes('Output') ||
        current.name.text.includes('Result') ||
        current.name.text.includes('Response') ||
        current.name.text.includes('Stats'))
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Check if this is a single-action tool (no switch statement needed)
 * Returns true if schema has 1 action and handler has 0 cases
 */
export function isSingleActionTool(schemaActions: string[], handlerCases: string[]): boolean {
  return schemaActions.length === 1 && handlerCases.length === 0;
}

// ============================================================================
// PRIVATE HELPERS - SCHEMA PARSING
// ============================================================================

/**
 * Pattern 1: Find discriminated union
 * z.discriminatedUnion('action', [Schema1, Schema2, ...])
 */
function findDiscriminatedUnion(
  sourceFile: ts.SourceFile,
  schemaNames: Set<string>,
  _actions: Set<string>
): void {
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'discriminatedUnion'
    ) {
      const firstArg = node.arguments[0];
      if (firstArg && ts.isStringLiteral(firstArg) && firstArg.text === 'action') {
        const secondArg = node.arguments[1];
        if (secondArg && ts.isArrayLiteralExpression(secondArg)) {
          secondArg.elements.forEach((element) => {
            if (ts.isIdentifier(element)) {
              schemaNames.add(element.text);
            }
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

/**
 * Pattern 2: Standalone exported enum (federation.ts)
 * export const FederationActionSchema = z.enum([...])
 */
function findStandaloneActionEnum(sourceFile: ts.SourceFile, actions: Set<string>): void {
  function visit(node: ts.Node): void {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isVariableDeclaration(declaration) &&
          ts.isIdentifier(declaration.name) &&
          declaration.name.text.includes('ActionSchema') &&
          declaration.initializer &&
          ts.isCallExpression(declaration.initializer)
        ) {
          const call = declaration.initializer;
          if (
            ts.isPropertyAccessExpression(call.expression) &&
            call.expression.name.text === 'enum'
          ) {
            const enumArg = call.arguments[0];
            if (enumArg && ts.isArrayLiteralExpression(enumArg)) {
              enumArg.elements.forEach((element) => {
                if (ts.isStringLiteral(element)) {
                  actions.add(element.text);
                }
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

/**
 * Pattern 3: Direct enum in action field
 * action: z.enum(['action1', 'action2', ...])
 * OR request: z.object({ action: z.enum([...]) })
 */
function findDirectActionEnum(sourceFile: ts.SourceFile, actions: Set<string>): void {
  function visit(node: ts.Node): void {
    // Look for any z.enum() call with a property named 'action'
    // BUT skip if inside output/result schemas (false positives)
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      if (node.name.text === 'action') {
        // Check if this is inside an output/result schema (skip if so)
        if (!isInsideOutputSchema(node)) {
          // Check if this property's value is a z.enum call or contains one
          extractEnumFromExpression(node.initializer, actions);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

/**
 * Helper to extract enum from expression (handles method chaining)
 */
function extractEnumFromExpression(expr: ts.Expression, actions: Set<string>): void {
  if (ts.isCallExpression(expr)) {
    // Check if this is a z.enum() call
    if (
      ts.isPropertyAccessExpression(expr.expression) &&
      ts.isIdentifier(expr.expression.name) &&
      expr.expression.name.text === 'enum'
    ) {
      const enumArg = expr.arguments[0];
      if (enumArg && ts.isArrayLiteralExpression(enumArg)) {
        enumArg.elements.forEach((element) => {
          if (ts.isStringLiteral(element)) {
            actions.add(element.text);
          }
        });
      }
    }

    // Also check method chaining: z.enum([...]).describe(...)
    if (ts.isPropertyAccessExpression(expr.expression)) {
      extractEnumFromExpression(expr.expression.expression, actions);
    }

    // Recursively check arguments for nested z.enum calls
    expr.arguments.forEach((arg) => {
      if (ts.isCallExpression(arg) || ts.isPropertyAccessExpression(arg)) {
        extractEnumFromExpression(arg as ts.Expression, actions);
      }
    });
  }
}

/**
 * Pattern 4: Extract action literals from schema definitions
 * const SomeActionSchema = z.object({ action: z.literal('name') })
 */
function extractActionFromSchemas(
  sourceFile: ts.SourceFile,
  schemaNames: Set<string>,
  actions: Set<string>
): void {
  function visit(node: ts.Node): void {
    // Look for variable declarations: const SomeActionSchema = ...
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isVariableDeclaration(declaration) &&
          ts.isIdentifier(declaration.name) &&
          schemaNames.has(declaration.name.text) &&
          declaration.initializer
        ) {
          const schemaName = declaration.name.text;
          const action = extractActionLiteral(declaration.initializer, schemaName);
          if (action) {
            actions.add(action);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

/**
 * Recursively extract z.literal('action_name') from schema expression
 * Handles:
 * - z.object({ action: z.literal('name') })
 * - CommonFields.extend({ action: z.literal('name') })
 * - Schema.refine(...)
 * - Nested method chains
 */
function extractActionLiteral(expr: ts.Expression, schemaName: string): string | null {
  // Handle method calls (.extend, .refine, .describe, etc.)
  if (ts.isCallExpression(expr)) {
    // Check arguments first (for .extend({ action: ... }))
    for (const arg of expr.arguments) {
      if (ts.isObjectLiteralExpression(arg)) {
        const action = findActionInObjectLiteral(arg);
        if (action) return action;
      }
    }

    // Recurse into the expression being called
    if (ts.isPropertyAccessExpression(expr.expression)) {
      const result = extractActionLiteral(expr.expression.expression, schemaName);
      if (result) return result;
    }
  }

  // Handle property access (z.object, z.literal, etc.)
  if (ts.isPropertyAccessExpression(expr)) {
    // For z.object() pattern, check the arguments
    const parent = findParentCallExpression(expr);
    if (parent) {
      for (const arg of parent.arguments) {
        if (ts.isObjectLiteralExpression(arg)) {
          const action = findActionInObjectLiteral(arg);
          if (action) return action;
        }
      }
    }
  }

  // Handle direct object literals
  if (ts.isObjectLiteralExpression(expr)) {
    return findActionInObjectLiteral(expr);
  }

  return null;
}

/**
 * Find z.literal('action_name') in object literal
 */
function findActionInObjectLiteral(obj: ts.ObjectLiteralExpression): string | null {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'action'
    ) {
      return extractLiteralValue(prop.initializer);
    }
  }
  return null;
}

/**
 * Extract string value from z.literal('value') call
 */
function extractLiteralValue(expr: ts.Expression): string | null {
  // Direct string literal
  if (ts.isStringLiteral(expr)) {
    return expr.text;
  }

  // z.literal('value') call
  if (ts.isCallExpression(expr)) {
    if (ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === 'literal') {
      const arg = expr.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        return arg.text;
      }
    }

    // Handle chained methods (.describe(), etc.)
    if (ts.isPropertyAccessExpression(expr.expression)) {
      return extractLiteralValue(expr.expression.expression);
    }
  }

  // Handle property access chains
  if (ts.isPropertyAccessExpression(expr)) {
    return extractLiteralValue(expr.expression);
  }

  return null;
}

/**
 * Find parent CallExpression for a property access
 */
function findParentCallExpression(expr: ts.Expression): ts.CallExpression | null {
  let current: ts.Node = expr;
  while (current.parent) {
    if (ts.isCallExpression(current.parent) && current.parent.expression === current) {
      return current.parent;
    }
    current = current.parent;
  }
  return null;
}
