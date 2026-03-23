import { describe, expect, it } from 'vitest';
import { buildSchema } from 'graphql';
import { typeDefs } from '../../src/graphql/schema.js';
import { resolvers } from '../../src/graphql/resolvers.js';

function getFieldNames(typeName: 'Query' | 'Mutation'): string[] {
  const schema = buildSchema(typeDefs);
  const type = schema.getType(typeName);
  if (!type || !('getFields' in type)) {
    return [];
  }
  return Object.keys(type.getFields()).sort();
}

describe('GraphQL schema alignment', () => {
  it('keeps Query fields aligned with resolvers', () => {
    const schemaFields = getFieldNames('Query');
    const resolverFields = Object.keys(resolvers.Query).sort();
    expect(schemaFields).toEqual(resolverFields);
  });

  it('keeps Mutation fields aligned with resolvers', () => {
    const schemaFields = getFieldNames('Mutation');
    const resolverFields = Object.keys(resolvers.Mutation).sort();
    expect(schemaFields).toEqual(resolverFields);
  });
});
