import { type ProviderCheckEvent, providerCheckEventSchema } from '@cronista/core';
import type { FunctionUrlHandler } from '@cronista/http';
import type { APIGatewayProxyStructuredResultV2, LambdaFunctionURLEvent } from 'aws-lambda';

import type { ProviderCheckReport } from './provider-check.ts';

/** The two ways `ai-api` runs, so tests can replace them. */
export interface EntryPointHandlers {
  readonly http: FunctionUrlHandler;
  readonly checkProviders: () => Promise<ProviderCheckReport>;
}

/**
 * Creates the Lambda entry point: Function URL requests go to the HTTP handler, and the owner's
 * direct invocation (`{"check":"providers"}`) runs the provider check.
 *
 * @remarks
 * Only `lambda:InvokeFunction` with the owner's credentials reaches the check: a Function URL
 * request always arrives wrapped in its own event, with the body as a string.
 */
export function createEntryPoint(
  handlers: EntryPointHandlers,
): (
  event: LambdaFunctionURLEvent | ProviderCheckEvent,
) => Promise<APIGatewayProxyStructuredResultV2 | ProviderCheckReport> {
  return async (event) => {
    if (!('check' in event)) return handlers.http(event);
    if (!providerCheckEventSchema.safeParse(event).success) {
      throw new Error('ai-api received an invalid provider check.');
    }
    const report = await handlers.checkProviders();
    console.info({ message: 'provider check', ...report });
    return report;
  };
}
