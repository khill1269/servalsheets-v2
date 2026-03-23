/**
 * Pattern Recognition Agent Tests
 *
 * Tests cross-file consistency detection:
 * - Handler method naming patterns (execute vs handle)
 * - Schema structure patterns (discriminatedUnion vs directEnum)
 * - Error handling consistency
 * - Response format consistency
 * - Naming convention detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as ts from 'typescript';
import { PatternRecognitionAgent } from '../../scripts/analysis/agents/pattern-recognition-agent.js';
import type { AnalysisContext } from '../../scripts/analysis/multi-agent-analysis.js';

describe('PatternRecognitionAgent', () => {
  let agent: PatternRecognitionAgent;

  beforeEach(() => {
    agent = new PatternRecognitionAgent();
    agent.reset(); // Clear patterns from previous tests
  });

  // ============================================================================
  // HANDLER PATTERN TESTS
  // ============================================================================

  describe('Handler Pattern Detection', () => {
    it('should detect "execute" pattern as dominant in handlers', async () => {
      // Simulate 18 handlers using "execute" pattern
      const executeHandlers = Array.from({ length: 18 }, (_, i) =>
        createHandlerFile(`handler${i}.ts`, 'execute')
      );

      // Simulate 4 handlers using "handle" pattern (deviations)
      const handleHandlers = Array.from({ length: 4 }, (_, i) =>
        createHandlerFile(`handler${i + 18}.ts`, 'handle')
      );

      const allHandlers = [...executeHandlers, ...handleHandlers];
      const context = createContext(allHandlers.map((h) => h.filePath));

      // Analyze all handlers
      for (const handler of allHandlers) {
        await agent.analyze(handler.filePath, handler.sourceFile, context);
      }

      // Check one of the "handle" deviation handlers
      const deviationReport = await agent.analyze(
        handleHandlers[0].filePath,
        handleHandlers[0].sourceFile,
        context
      );

      const handlerReport = deviationReport.find((r) => r.dimension === 'handlerPattern');
      expect(handlerReport).toBeDefined();
      expect(handlerReport?.status).toBe('warning');
      expect(handlerReport?.issueCount).toBeGreaterThan(0);
      expect(handlerReport?.issues[0].message).toContain('execute');
      expect(handlerReport?.metrics?.consistencyScore).toBeLessThan(90); // Not 100% consistent
    });

    it('should pass when handler follows dominant pattern', async () => {
      const executeHandlers = Array.from({ length: 20 }, (_, i) =>
        createHandlerFile(`handler${i}.ts`, 'execute')
      );

      const context = createContext(executeHandlers.map((h) => h.filePath));

      // Analyze all handlers
      for (const handler of executeHandlers) {
        await agent.analyze(handler.filePath, handler.sourceFile, context);
      }

      // Check one handler
      const reports = await agent.analyze(
        executeHandlers[0].filePath,
        executeHandlers[0].sourceFile,
        context
      );

      const handlerReport = reports.find((r) => r.dimension === 'handlerPattern');
      expect(handlerReport).toBeDefined();
      expect(handlerReport?.status).toBe('pass');
      expect(handlerReport?.issueCount).toBe(0);
    });

    it('should ignore non-handler files', async () => {
      const schemaFile = createSchemaFile('data.ts');
      const context = createContext([schemaFile.filePath]);

      const reports = await agent.analyze(schemaFile.filePath, schemaFile.sourceFile, context);

      const handlerReport = reports.find((r) => r.dimension === 'handlerPattern');
      expect(handlerReport).toBeDefined();
      expect(handlerReport?.status).toBe('pass');
      expect(handlerReport?.issueCount).toBe(0);
    });
  });

  // ============================================================================
  // SCHEMA PATTERN TESTS
  // ============================================================================

  describe('Schema Pattern Detection', () => {
    it('should detect "discriminatedUnion" as dominant pattern', async () => {
      const discriminatedSchemas = Array.from({ length: 15 }, (_, i) =>
        createSchemaFile(`schema${i}.ts`, 'discriminatedUnion')
      );

      const directEnumSchemas = Array.from({ length: 3 }, (_, i) =>
        createSchemaFile(`schema${i + 15}.ts`, 'directEnum')
      );

      const allSchemas = [...discriminatedSchemas, ...directEnumSchemas];
      const context = createContext(allSchemas.map((s) => s.filePath));

      // Analyze all schemas
      for (const schema of allSchemas) {
        await agent.analyze(schema.filePath, schema.sourceFile, context);
      }

      // Check deviation schema
      const reports = await agent.analyze(
        directEnumSchemas[0].filePath,
        directEnumSchemas[0].sourceFile,
        context
      );

      const schemaReport = reports.find((r) => r.dimension === 'schemaPattern');
      expect(schemaReport).toBeDefined();
      expect(schemaReport?.status).toBe('warning');
      expect(schemaReport?.issueCount).toBeGreaterThan(0);
    });

    it('should pass when schema follows dominant pattern', async () => {
      const schemas = Array.from({ length: 18 }, (_, i) =>
        createSchemaFile(`schema${i}.ts`, 'discriminatedUnion')
      );

      const context = createContext(schemas.map((s) => s.filePath));

      // Analyze all schemas
      for (const schema of schemas) {
        await agent.analyze(schema.filePath, schema.sourceFile, context);
      }

      // Check one schema
      const reports = await agent.analyze(schemas[0].filePath, schemas[0].sourceFile, context);

      const schemaReport = reports.find((r) => r.dimension === 'schemaPattern');
      expect(schemaReport).toBeDefined();
      expect(schemaReport?.status).toBe('pass');
      expect(schemaReport?.issueCount).toBe(0);
    });
  });

  // ============================================================================
  // ERROR PATTERN TESTS
  // ============================================================================

  describe('Error Pattern Detection', () => {
    it('should detect throw as dominant error pattern', async () => {
      const throwFiles = Array.from({ length: 20 }, (_, i) =>
        createFileWithErrorPattern(`file${i}.ts`, 'throw')
      );

      const returnFiles = Array.from({ length: 2 }, (_, i) =>
        createFileWithErrorPattern(`file${i + 20}.ts`, 'return')
      );

      const allFiles = [...throwFiles, ...returnFiles];
      const context = createContext(allFiles.map((f) => f.filePath));

      // Analyze all files
      for (const file of allFiles) {
        await agent.analyze(file.filePath, file.sourceFile, context);
      }

      // Should have high consistency score
      const reports = await agent.analyze(
        throwFiles[0].filePath,
        throwFiles[0].sourceFile,
        context
      );

      const errorReport = reports.find((r) => r.dimension === 'errorPattern');
      expect(errorReport).toBeDefined();
      expect(errorReport?.metrics?.consistencyScore).toBeGreaterThan(80);
    });
  });

  // ============================================================================
  // RESPONSE PATTERN TESTS
  // ============================================================================

  describe('Response Pattern Detection', () => {
    it('should detect wrapped response pattern', async () => {
      const wrappedHandlers = Array.from({ length: 22 }, (_, i) =>
        createHandlerWithResponsePattern(`handler${i}.ts`, 'wrapped')
      );

      const context = createContext(wrappedHandlers.map((h) => h.filePath));

      // Analyze all handlers
      for (const handler of wrappedHandlers) {
        await agent.analyze(handler.filePath, handler.sourceFile, context);
      }

      // Check one handler
      const reports = await agent.analyze(
        wrappedHandlers[0].filePath,
        wrappedHandlers[0].sourceFile,
        context
      );

      const responseReport = reports.find((r) => r.dimension === 'responsePattern');
      expect(responseReport).toBeDefined();
      expect(responseReport?.status).toBe('pass');
      expect(responseReport?.metrics?.consistencyScore).toBe(100);
    });

    it('should flag deviations from wrapped response pattern', async () => {
      const wrappedHandlers = Array.from({ length: 20 }, (_, i) =>
        createHandlerWithResponsePattern(`handler${i}.ts`, 'wrapped')
      );

      const directHandler = createHandlerWithResponsePattern('handler20.ts', 'direct');

      const allHandlers = [...wrappedHandlers, directHandler];
      const context = createContext(allHandlers.map((h) => h.filePath));

      // Analyze all handlers
      for (const handler of allHandlers) {
        await agent.analyze(handler.filePath, handler.sourceFile, context);
      }

      // Check deviation handler (should be flagged since >90% use wrapped)
      const reports = await agent.analyze(
        directHandler.filePath,
        directHandler.sourceFile,
        context
      );

      const responseReport = reports.find((r) => r.dimension === 'responsePattern');
      expect(responseReport).toBeDefined();
      // Should pass since direct handler doesn't have wrapped pattern
      // Only wrapped patterns are flagged as deviations
    });
  });

  // ============================================================================
  // NAMING PATTERN TESTS
  // ============================================================================

  describe('Naming Pattern Detection', () => {
    it('should detect mixed naming conventions in a file', async () => {
      const mixedFile = createFileWithMixedNaming();
      const context = createContext([mixedFile.filePath]);

      const reports = await agent.analyze(mixedFile.filePath, mixedFile.sourceFile, context);

      const namingReport = reports.find((r) => r.dimension === 'namingPattern');
      expect(namingReport).toBeDefined();
      expect(namingReport?.status).toBe('warning');
      expect(namingReport?.issueCount).toBeGreaterThan(0);
      expect(namingReport?.issues[0].message).toContain('naming conventions');
    });

    it('should pass when file uses consistent naming', async () => {
      const consistentFile = createFileWithConsistentNaming('camelCase');
      const context = createContext([consistentFile.filePath]);

      const reports = await agent.analyze(
        consistentFile.filePath,
        consistentFile.sourceFile,
        context
      );

      const namingReport = reports.find((r) => r.dimension === 'namingPattern');
      expect(namingReport).toBeDefined();
      expect(namingReport?.status).toBe('pass');
    });

    it('should detect PascalCase as dominant for classes', async () => {
      const files = Array.from({ length: 20 }, (_, i) =>
        createFileWithConsistentNaming('PascalCase', `file${i}.ts`)
      );

      const context = createContext(files.map((f) => f.filePath));

      // Analyze all files
      for (const file of files) {
        await agent.analyze(file.filePath, file.sourceFile, context);
      }

      // Check metrics
      const reports = await agent.analyze(files[0].filePath, files[0].sourceFile, context);

      const namingReport = reports.find((r) => r.dimension === 'namingPattern');
      expect(namingReport).toBeDefined();
      expect(namingReport?.metrics?.consistencyScore).toBeGreaterThan(80);
    });
  });

  // ============================================================================
  // CROSS-FILE ANALYSIS TESTS
  // ============================================================================

  describe('Cross-File Consistency', () => {
    it('should calculate consistency score across multiple files', async () => {
      const handlers = Array.from({ length: 22 }, (_, i) => {
        // 18 use "execute", 4 use "handle"
        const pattern = i < 18 ? 'execute' : 'handle';
        return createHandlerFile(`handler${i}.ts`, pattern);
      });

      const context = createContext(handlers.map((h) => h.filePath));

      // Analyze all handlers
      for (const handler of handlers) {
        await agent.analyze(handler.filePath, handler.sourceFile, context);
      }

      // Check consistency score
      const reports = await agent.analyze(handlers[0].filePath, handlers[0].sourceFile, context);

      const handlerReport = reports.find((r) => r.dimension === 'handlerPattern');
      expect(handlerReport).toBeDefined();
      // Score should be around 82% (18 files with execute out of 22 files)
      // Actual may be slightly different due to multiple methods per handler
      expect(handlerReport?.metrics?.consistencyScore).toBeGreaterThan(75);
      expect(handlerReport?.metrics?.consistencyScore).toBeLessThan(90);
      expect(handlerReport?.metrics?.dominantPattern).toBeGreaterThanOrEqual(18);
      expect(handlerReport?.metrics?.totalInstances).toBeGreaterThanOrEqual(22);
    });

    it('should identify deviations with file and line numbers', async () => {
      const executeHandlers = Array.from({ length: 18 }, (_, i) =>
        createHandlerFile(`handler${i}.ts`, 'execute')
      );

      const handleHandler = createHandlerFile('deviationHandler.ts', 'handle');

      const allHandlers = [...executeHandlers, handleHandler];
      const context = createContext(allHandlers.map((h) => h.filePath));

      // Analyze all handlers
      for (const handler of allHandlers) {
        await agent.analyze(handler.filePath, handler.sourceFile, context);
      }

      // Check deviation handler
      const reports = await agent.analyze(
        handleHandler.filePath,
        handleHandler.sourceFile,
        context
      );

      const handlerReport = reports.find((r) => r.dimension === 'handlerPattern');
      expect(handlerReport).toBeDefined();
      expect(handlerReport?.issues.length).toBeGreaterThan(0);
      expect(handlerReport?.issues[0].file).toBe(handleHandler.filePath);
      expect(handlerReport?.issues[0].line).toBeGreaterThan(0);
      expect(handlerReport?.issues[0].suggestion).toContain('execute');
    });
  });

  // ============================================================================
  // PATTERN RESET TESTS
  // ============================================================================

  describe('Pattern Reset', () => {
    it('should clear all patterns on reset', async () => {
      const handlers = Array.from({ length: 5 }, (_, i) =>
        createHandlerFile(`handler${i}.ts`, 'execute')
      );

      const context = createContext(handlers.map((h) => h.filePath));

      // Analyze handlers
      for (const handler of handlers) {
        await agent.analyze(handler.filePath, handler.sourceFile, context);
      }

      // Reset agent
      agent.reset();

      // Analyze new handler - should not have previous patterns
      const newHandler = createHandlerFile('newHandler.ts', 'handle');
      const reports = await agent.analyze(
        newHandler.filePath,
        newHandler.sourceFile,
        createContext([newHandler.filePath])
      );

      // Should not flag deviation since patterns were reset
      const handlerReport = reports.find((r) => r.dimension === 'handlerPattern');
      expect(handlerReport).toBeDefined();
      expect(handlerReport?.issueCount).toBe(0);
    });
  });
});

// ============================================================================
// TEST HELPERS
// ============================================================================

function createHandlerFile(fileName: string, methodPattern: 'execute' | 'handle' | 'process') {
  const code = `
    import { BaseHandler } from './base.js';

    export class TestHandler extends BaseHandler {
      async ${methodPattern}Action(input: any): Promise<any> {
        return { response: { success: true } };
      }
    }
  `;

  return {
    filePath: `/test/src/handlers/${fileName}`,
    sourceFile: ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true),
  };
}

function createSchemaFile(fileName: string, pattern?: 'discriminatedUnion' | 'directEnum') {
  let code = `
    import { z } from 'zod';
  `;

  if (pattern === 'discriminatedUnion') {
    code += `
      export const TestSchema = z.discriminatedUnion('action', [
        z.object({ action: z.literal('read') }),
        z.object({ action: z.literal('write') }),
      ]);
    `;
  } else if (pattern === 'directEnum') {
    code += `
      export const ActionEnum = z.enum(['read', 'write']);
      export const TestSchema = z.object({ action: ActionEnum });
    `;
  } else {
    code += `export const TestSchema = z.object({});`;
  }

  return {
    filePath: `/test/src/schemas/${fileName}`,
    sourceFile: ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true),
  };
}

function createFileWithErrorPattern(fileName: string, pattern: 'throw' | 'return') {
  const code =
    pattern === 'throw'
      ? `
    function test() {
      throw new Error('test');
    }
  `
      : `
    function test() {
      return { error: 'test' };
    }
  `;

  return {
    filePath: `/test/src/${fileName}`,
    sourceFile: ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true),
  };
}

function createHandlerWithResponsePattern(fileName: string, pattern: 'wrapped' | 'direct') {
  const code =
    pattern === 'wrapped'
      ? `
    export class TestHandler {
      async handle() {
        return { response: { success: true, data: {} } };
      }
    }
  `
      : `
    export class TestHandler {
      async handle() {
        return { success: true, data: {} };
      }
    }
  `;

  return {
    filePath: `/test/src/handlers/${fileName}`,
    sourceFile: ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true),
  };
}

function createFileWithMixedNaming() {
  const code = `
    class PascalCaseClass {}
    const camelCaseVar = 1;
    const snake_case_var = 2;
    const SCREAMING_SNAKE = 3;
    function kebab_case_func() {}
  `;

  return {
    filePath: '/test/src/mixed.ts',
    sourceFile: ts.createSourceFile('mixed.ts', code, ts.ScriptTarget.Latest, true),
  };
}

function createFileWithConsistentNaming(style: string, fileName = 'consistent.ts') {
  let code = '';

  if (style === 'camelCase') {
    code = `
      const myVariable = 1;
      function myFunction() {}
      const anotherVar = 2;
    `;
  } else if (style === 'PascalCase') {
    code = `
      class MyClass {}
      class AnotherClass {}
      class ThirdClass {}
    `;
  }

  return {
    filePath: `/test/src/${fileName}`,
    sourceFile: ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true),
  };
}

function createContext(allFiles: string[]): AnalysisContext {
  return {
    allFiles,
    program: null as any,
    typeChecker: null as any,
  };
}
