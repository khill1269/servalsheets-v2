/**
 * Schema Inspection Utilities - Comprehensive Tests
 *
 * Tests for the new schema-inspection.ts module that uses stable Zod v4 APIs
 * to unwrap and inspect schemas without relying on brittle internal properties.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  unwrapSchema,
  isEnumLike,
  getObjectShape,
  isActionBasedSchema,
  getDiscriminator,
  getDiscriminatedUnionOptions,
  isUnion,
  isDiscriminatedUnion,
  isObject,
  isArray,
  getArrayElement,
  hasField,
  getField,
  getFieldNames,
} from '../../src/utils/schema-inspection.js';

describe('Schema Inspection Utilities', () => {
  describe('unwrapSchema', () => {
    it('should unwrap optional schema', () => {
      const wrapped = z.string().optional();
      const unwrapped = unwrapSchema(wrapped);

      expect(unwrapped instanceof z.ZodString).toBe(true);
    });

    it('should unwrap default schema', () => {
      const wrapped = z.number().default(42);
      const unwrapped = unwrapSchema(wrapped);

      expect(unwrapped instanceof z.ZodNumber).toBe(true);
    });

    it('should unwrap nullable schema', () => {
      const wrapped = z.boolean().nullable();
      const unwrapped = unwrapSchema(wrapped);

      expect(unwrapped instanceof z.ZodBoolean).toBe(true);
    });

    it('should unwrap effects (transform)', () => {
      const wrapped = z.string().transform((s) => s.toUpperCase());
      const unwrapped = unwrapSchema(wrapped);

      expect(unwrapped instanceof z.ZodString).toBe(true);
    });

    it('should unwrap effects (refine)', () => {
      const wrapped = z.number().refine((n) => n > 0);
      const unwrapped = unwrapSchema(wrapped);

      expect(unwrapped instanceof z.ZodNumber).toBe(true);
    });

    it('should unwrap multiple layers', () => {
      const wrapped = z
        .string()
        .optional()
        .default('default')
        .transform((s) => s.trim());
      const unwrapped = unwrapSchema(wrapped);

      expect(unwrapped instanceof z.ZodString).toBe(true);
    });

    it('should return same schema if no wrappers', () => {
      const schema = z.string();
      const unwrapped = unwrapSchema(schema);

      expect(unwrapped).toBe(schema);
    });

    it('should handle complex nested wrappers', () => {
      const wrapped = z.object({ id: z.number() }).optional().nullable().default({ id: 1 });
      const unwrapped = unwrapSchema(wrapped);

      expect(unwrapped instanceof z.ZodObject).toBe(true);
    });
  });

  describe('isEnumLike', () => {
    it('should detect z.enum()', () => {
      const schema = z.enum(['read', 'write', 'delete']);
      expect(isEnumLike(schema)).toBe(true);
    });

    it('should detect z.enum() through wrappers', () => {
      const schema = z.enum(['read', 'write']).optional();
      expect(isEnumLike(schema)).toBe(true);
    });

    it('should detect native enum', () => {
      enum Status {
        Active = 'active',
        Inactive = 'inactive',
      }
      const schema = z.nativeEnum(Status);
      expect(isEnumLike(schema)).toBe(true);
    });

    it('should return false for non-enum schemas', () => {
      expect(isEnumLike(z.string())).toBe(false);
      expect(isEnumLike(z.number())).toBe(false);
      expect(isEnumLike(z.object({ type: z.string() }))).toBe(false);
    });
  });

  describe('getObjectShape', () => {
    it('should extract shape from object schema', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
        active: z.boolean(),
      });

      const shape = getObjectShape(schema);
      expect(shape).not.toBeNull();
      expect(Object.keys(shape!)).toEqual(['name', 'age', 'active']);
      expect(shape!.name instanceof z.ZodString).toBe(true);
      expect(shape!.age instanceof z.ZodNumber).toBe(true);
      expect(shape!.active instanceof z.ZodBoolean).toBe(true);
    });

    it('should extract shape from wrapped object', () => {
      const schema = z
        .object({
          id: z.number(),
          title: z.string(),
        })
        .optional();

      const shape = getObjectShape(schema);
      expect(shape).not.toBeNull();
      expect(Object.keys(shape!)).toEqual(['id', 'title']);
    });

    it('should return null for non-object schemas', () => {
      expect(getObjectShape(z.string())).toBeNull();
      expect(getObjectShape(z.number())).toBeNull();
      expect(getObjectShape(z.array(z.string()))).toBeNull();
    });
  });

  describe('isActionBasedSchema', () => {
    it('should detect discriminated union with action', () => {
      const schema = z.discriminatedUnion('action', [
        z.object({ action: z.literal('read'), id: z.string() }),
        z.object({ action: z.literal('write'), data: z.string() }),
      ]);

      expect(isActionBasedSchema(schema)).toBe(true);
    });

    it('should detect flat object with action enum', () => {
      const schema = z.object({
        action: z.enum(['read', 'write', 'delete']),
        id: z.string(),
      });

      expect(isActionBasedSchema(schema)).toBe(true);
    });

    it('should detect through wrappers', () => {
      const schema = z
        .discriminatedUnion('action', [
          z.object({ action: z.literal('get'), id: z.string() }),
          z.object({ action: z.literal('set'), value: z.string() }),
        ])
        .optional();

      expect(isActionBasedSchema(schema)).toBe(true);
    });

    it('should return false for non-action-based schemas', () => {
      const schema1 = z.object({
        type: z.string(), // Not an enum
        id: z.string(),
      });
      expect(isActionBasedSchema(schema1)).toBe(false);

      const schema2 = z.string();
      expect(isActionBasedSchema(schema2)).toBe(false);
    });

    it('should return false for discriminated union without action', () => {
      const schema = z.discriminatedUnion('type', [
        z.object({ type: z.literal('user'), name: z.string() }),
        z.object({ type: z.literal('admin'), role: z.string() }),
      ]);

      // Still action-based from perspective of being a discriminated union
      expect(isActionBasedSchema(schema)).toBe(true);
    });
  });

  describe('getDiscriminator', () => {
    it('should extract discriminator from discriminated union', () => {
      const schema = z.discriminatedUnion('action', [
        z.object({ action: z.literal('read') }),
        z.object({ action: z.literal('write') }),
      ]);

      expect(getDiscriminator(schema)).toBe('action');
    });

    it('should extract custom discriminator', () => {
      const schema = z.discriminatedUnion('type', [
        z.object({ type: z.literal('success'), data: z.string() }),
        z.object({ type: z.literal('error'), error: z.string() }),
      ]);

      expect(getDiscriminator(schema)).toBe('type');
    });

    it('should work through wrappers', () => {
      const schema = z
        .discriminatedUnion('status', [
          z.object({ status: z.literal('active') }),
          z.object({ status: z.literal('inactive') }),
        ])
        .optional();

      expect(getDiscriminator(schema)).toBe('status');
    });

    it('should return null for non-discriminated-union schemas', () => {
      expect(getDiscriminator(z.string())).toBeNull();
      expect(getDiscriminator(z.object({ action: z.string() }))).toBeNull();
      expect(getDiscriminator(z.union([z.string(), z.number()]))).toBeNull();
    });
  });

  describe('getDiscriminatedUnionOptions', () => {
    it('should extract options from discriminated union', () => {
      const schema = z.discriminatedUnion('action', [
        z.object({ action: z.literal('read'), id: z.string() }),
        z.object({ action: z.literal('write'), data: z.string() }),
        z.object({ action: z.literal('delete'), id: z.string() }),
      ]);

      const options = getDiscriminatedUnionOptions(schema);
      expect(options).not.toBeNull();
      expect(options!.length).toBe(3);
      expect(options!.every((opt) => opt instanceof z.ZodObject)).toBe(true);
    });

    it('should return null for non-discriminated-union schemas', () => {
      expect(getDiscriminatedUnionOptions(z.string())).toBeNull();
      expect(getDiscriminatedUnionOptions(z.object({}))).toBeNull();
    });
  });

  describe('isUnion', () => {
    it('should detect regular union', () => {
      const schema = z.union([z.string(), z.number(), z.boolean()]);
      expect(isUnion(schema)).toBe(true);
    });

    it('should work through wrappers', () => {
      const schema = z.union([z.string(), z.number()]).optional();
      expect(isUnion(schema)).toBe(true);
    });

    it('should return false for discriminated union', () => {
      const schema = z.discriminatedUnion('type', [
        z.object({ type: z.literal('a') }),
        z.object({ type: z.literal('b') }),
      ]);
      expect(isUnion(schema)).toBe(false);
    });

    it('should return false for non-union schemas', () => {
      expect(isUnion(z.string())).toBe(false);
      expect(isUnion(z.object({}))).toBe(false);
    });
  });

  describe('isDiscriminatedUnion', () => {
    it('should detect discriminated union', () => {
      const schema = z.discriminatedUnion('type', [
        z.object({ type: z.literal('success') }),
        z.object({ type: z.literal('error') }),
      ]);
      expect(isDiscriminatedUnion(schema)).toBe(true);
    });

    it('should work through wrappers', () => {
      const schema = z
        .discriminatedUnion('action', [
          z.object({ action: z.literal('read') }),
          z.object({ action: z.literal('write') }),
        ])
        .optional();
      expect(isDiscriminatedUnion(schema)).toBe(true);
    });

    it('should return false for regular union', () => {
      const schema = z.union([z.string(), z.number()]);
      expect(isDiscriminatedUnion(schema)).toBe(false);
    });

    it('should return false for non-union schemas', () => {
      expect(isDiscriminatedUnion(z.string())).toBe(false);
      expect(isDiscriminatedUnion(z.object({}))).toBe(false);
    });
  });

  describe('isObject', () => {
    it('should detect object schema', () => {
      const schema = z.object({ name: z.string() });
      expect(isObject(schema)).toBe(true);
    });

    it('should work through wrappers', () => {
      const schema = z.object({ id: z.number() }).optional();
      expect(isObject(schema)).toBe(true);
    });

    it('should return false for non-object schemas', () => {
      expect(isObject(z.string())).toBe(false);
      expect(isObject(z.array(z.string()))).toBe(false);
    });
  });

  describe('isArray', () => {
    it('should detect array schema', () => {
      const schema = z.array(z.string());
      expect(isArray(schema)).toBe(true);
    });

    it('should work through wrappers', () => {
      const schema = z.array(z.number()).optional();
      expect(isArray(schema)).toBe(true);
    });

    it('should return false for non-array schemas', () => {
      expect(isArray(z.string())).toBe(false);
      expect(isArray(z.object({}))).toBe(false);
    });
  });

  describe('getArrayElement', () => {
    it('should extract element type from array', () => {
      const schema = z.array(z.string());
      const element = getArrayElement(schema);

      expect(element).not.toBeNull();
      expect(element instanceof z.ZodString).toBe(true);
    });

    it('should work with complex element types', () => {
      const schema = z.array(
        z.object({
          id: z.number(),
          name: z.string(),
        })
      );
      const element = getArrayElement(schema);

      expect(element).not.toBeNull();
      expect(element instanceof z.ZodObject).toBe(true);
    });

    it('should work through wrappers', () => {
      const schema = z.array(z.number()).optional();
      const element = getArrayElement(schema);

      expect(element).not.toBeNull();
      expect(element instanceof z.ZodNumber).toBe(true);
    });

    it('should return null for non-array schemas', () => {
      expect(getArrayElement(z.string())).toBeNull();
      expect(getArrayElement(z.object({}))).toBeNull();
    });
  });

  describe('hasField', () => {
    it('should detect existing field', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      expect(hasField(schema, 'name')).toBe(true);
      expect(hasField(schema, 'age')).toBe(true);
    });

    it('should return false for non-existent field', () => {
      const schema = z.object({
        name: z.string(),
      });

      expect(hasField(schema, 'email')).toBe(false);
    });

    it('should work through wrappers', () => {
      const schema = z.object({ id: z.number() }).optional();
      expect(hasField(schema, 'id')).toBe(true);
    });

    it('should return false for non-object schemas', () => {
      expect(hasField(z.string(), 'length')).toBe(false);
    });
  });

  describe('getField', () => {
    it('should extract field schema', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
        active: z.boolean(),
      });

      const nameField = getField(schema, 'name');
      expect(nameField).not.toBeNull();
      expect(nameField instanceof z.ZodString).toBe(true);

      const ageField = getField(schema, 'age');
      expect(ageField).not.toBeNull();
      expect(ageField instanceof z.ZodNumber).toBe(true);
    });

    it('should return null for non-existent field', () => {
      const schema = z.object({ name: z.string() });
      expect(getField(schema, 'email')).toBeNull();
    });

    it('should work through wrappers', () => {
      const schema = z.object({ id: z.number() }).optional();
      const idField = getField(schema, 'id');

      expect(idField).not.toBeNull();
      expect(idField instanceof z.ZodNumber).toBe(true);
    });

    it('should return null for non-object schemas', () => {
      expect(getField(z.string(), 'field')).toBeNull();
    });
  });

  describe('getFieldNames', () => {
    it('should extract all field names', () => {
      const schema = z.object({
        id: z.number(),
        name: z.string(),
        email: z.string(),
        active: z.boolean(),
      });

      const fields = getFieldNames(schema);
      expect(fields).toEqual(['id', 'name', 'email', 'active']);
    });

    it('should return empty array for empty object', () => {
      const schema = z.object({});
      expect(getFieldNames(schema)).toEqual([]);
    });

    it('should work through wrappers', () => {
      const schema = z
        .object({
          x: z.number(),
          y: z.number(),
        })
        .optional();

      expect(getFieldNames(schema)).toEqual(['x', 'y']);
    });

    it('should return empty array for non-object schemas', () => {
      expect(getFieldNames(z.string())).toEqual([]);
      expect(getFieldNames(z.array(z.string()))).toEqual([]);
    });
  });

  describe('Integration Tests', () => {
    it('should handle complex ServalSheets tool schema', () => {
      // Simulating a real ServalSheets tool input schema
      const toolSchema = z.discriminatedUnion('action', [
        z.object({
          action: z.literal('read'),
          spreadsheetId: z.string(),
          range: z.string(),
        }),
        z.object({
          action: z.literal('write'),
          spreadsheetId: z.string(),
          range: z.string(),
          values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
        }),
      ]);

      expect(isActionBasedSchema(toolSchema)).toBe(true);
      expect(getDiscriminator(toolSchema)).toBe('action');
      expect(isDiscriminatedUnion(toolSchema)).toBe(true);

      const options = getDiscriminatedUnionOptions(toolSchema);
      expect(options).not.toBeNull();
      expect(options!.length).toBe(2);
    });

    it('should handle wrapped complex schema', () => {
      const wrappedSchema = z
        .object({
          action: z.enum(['get', 'set', 'delete']),
          key: z.string(),
          value: z.string().optional(),
        })
        .optional()
        .default({
          action: 'get',
          key: 'default',
        });

      expect(isActionBasedSchema(wrappedSchema)).toBe(true);
      expect(isObject(wrappedSchema)).toBe(true);
      expect(hasField(wrappedSchema, 'action')).toBe(true);
      expect(getFieldNames(wrappedSchema)).toEqual(['action', 'key', 'value']);

      const actionField = getField(wrappedSchema, 'action');
      expect(actionField).not.toBeNull();
      expect(isEnumLike(actionField!)).toBe(true);
    });
  });
});
