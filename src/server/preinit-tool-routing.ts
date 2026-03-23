import { AuthHandler } from '../handlers/auth.js';
import { parseWithCache } from '../utils/schema-cache.js';

export async function handleSheetsAuthToolCall(
  authHandler: AuthHandler | null,
  args: Record<string, unknown>
): Promise<{ authHandler: AuthHandler; result: unknown }> {
  const activeAuthHandler = authHandler ?? new AuthHandler({});
  const { SheetsAuthInputSchema } = await import('../schemas/auth.js');
  const result = await activeAuthHandler.handle(
    parseWithCache(SheetsAuthInputSchema, args, 'SheetsAuthInput')
  );

  return { authHandler: activeAuthHandler, result };
}

export async function handlePreInitExemptToolCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown | null> {
  if (toolName === 'sheets_session') {
    const { SessionHandler } = await import('../handlers/session.js');
    const { SheetsSessionInputSchema } = await import('../schemas/session.js');
    const handler = new SessionHandler();
    return await handler.handle(
      parseWithCache(SheetsSessionInputSchema, args, 'SheetsSessionInput')
    );
  }

  if (toolName === 'sheets_history') {
    const { HistoryHandler } = await import('../handlers/history.js');
    const { SheetsHistoryInputSchema } = await import('../schemas/history.js');
    const handler = new HistoryHandler({});
    return await handler.handle(
      parseWithCache(SheetsHistoryInputSchema, args, 'SheetsHistoryInput')
    );
  }

  if (toolName === 'sheets_composite') {
    const { CompositeInputSchema } = await import('../schemas/composite.js');
    const { handleGenerateTemplateAction, handlePreviewGenerationAction } =
      await import('../handlers/composite-actions/generation.js');

    const parsed = parseWithCache(CompositeInputSchema, args, 'CompositeInput');
    const request = parsed.request;

    if (request.action === 'generate_template') {
      return {
        response: await handleGenerateTemplateAction(request, {}),
      };
    }

    if (request.action === 'preview_generation') {
      return {
        response: await handlePreviewGenerationAction(request, {}),
      };
    }
  }

  return null;
}
