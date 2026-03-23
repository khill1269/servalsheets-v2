/**
 * GraphQL Server Setup
 *
 * Configures Apollo Server with schema, resolvers, and authentication.
 */

import { ApolloServer } from '@apollo/server';
import type { Express } from 'express';
import { json } from 'express';
import { typeDefs } from './schema.js';
import { resolvers, type GraphQLContext } from './resolvers.js';
import type { HandlerContext } from '../handlers/index.js';
import { logger } from '../utils/logger.js';

/**
 * Create and configure Apollo Server
 */
export function createApolloServer(): ApolloServer<GraphQLContext> {
  const server = new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    formatError: (formattedError) => {
      // Log errors for debugging
      logger.error('GraphQL Error', {
        message: formattedError.message,
        path: formattedError.path,
        extensions: formattedError.extensions,
      });

      // Don't expose internal error details in production
      if (process.env['NODE_ENV'] === 'production') {
        return {
          message: formattedError.message,
          extensions: {
            code: formattedError.extensions?.['code'] || 'INTERNAL_SERVER_ERROR',
          },
        };
      }

      return formattedError;
    },
    introspection: process.env['NODE_ENV'] !== 'production',
  });

  return server;
}

/**
 * Add GraphQL endpoint to Express app using manual integration
 * (Simpler than using express middleware package)
 */
export async function addGraphQLEndpoint(
  app: Express,
  getHandlerContext: (authToken?: string) => Promise<HandlerContext>
): Promise<void> {
  const server = createApolloServer();
  await server.start();

  // Handle GraphQL requests manually
  app.post('/graphql', json(), async (req, res) => {
    try {
      // Extract auth token from Authorization header
      const authHeader = req.headers['authorization'];
      const token = authHeader?.replace('Bearer ', '');

      // Get handler context for this request
      const handlerContext = await getHandlerContext(token);

      // Execute GraphQL query
      const response = await server.executeOperation(
        {
          query: req.body['query'],
          variables: req.body['variables'],
          operationName: req.body['operationName'],
        },
        {
          contextValue: {
            handlerContext,
            userId: token,
          },
        }
      );

      // Send response
      if (response.body.kind === 'single') {
        res.status(200).json(response.body.singleResult);
      } else {
        res.status(200).json({ errors: [{ message: 'Incremental delivery not supported' }] });
      }
    } catch (error) {
      logger.error('GraphQL request failed', { error });
      res.status(500).json({
        errors: [
          {
            message: 'Internal server error',
            extensions: {
              code: 'INTERNAL_SERVER_ERROR',
            },
          },
        ],
      });
    }
  });

  // GraphQL Playground (GET requests)
  app.get('/graphql', (_req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>ServalSheets GraphQL</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: #f5f5f5;
            }
            .container {
              text-align: center;
              padding: 40px;
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            h1 { margin-bottom: 20px; }
            a {
              display: inline-block;
              margin: 10px;
              padding: 12px 24px;
              background: #2563eb;
              color: white;
              text-decoration: none;
              border-radius: 6px;
            }
            a:hover { background: #1d4ed8; }
            code {
              background: #f3f4f6;
              padding: 2px 6px;
              border-radius: 4px;
              font-family: monospace;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🐆 ServalSheets GraphQL API</h1>
            <p>POST requests to <code>/graphql</code> with queries/mutations</p>
            <a href="https://studio.apollographql.com/sandbox/explorer" target="_blank">
              Open Apollo Sandbox
            </a>
            <p style="margin-top: 20px; font-size: 14px; color: #666;">
              Use endpoint: <code>http://localhost:3000/graphql</code><br>
              Add Authorization header: <code>Bearer YOUR_TOKEN</code>
            </p>
          </div>
        </body>
      </html>
    `);
  });

  logger.info('GraphQL endpoint enabled at /graphql', {
    introspection: process.env['NODE_ENV'] !== 'production',
    playground: 'Apollo Sandbox (studio.apollographql.com/sandbox)',
  });
}
