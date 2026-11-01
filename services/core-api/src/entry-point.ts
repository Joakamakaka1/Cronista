import { type SiteCheckEvent, siteCheckEventSchema } from '@cronista/core';
import type { FunctionUrlHandler } from '@cronista/http';
import type { APIGatewayProxyStructuredResultV2, LambdaFunctionURLEvent } from 'aws-lambda';

import type { SiteCheckReport } from './site-check.ts';

/** The two ways `core-api` runs, so tests can replace them. */
export interface EntryPointHandlers {
  readonly http: FunctionUrlHandler;
  readonly checkSite: () => Promise<SiteCheckReport>;
}

/**
 * Creates the Lambda entry point: Function URL requests go to the HTTP handler, and a deploy
 * workflow's direct invocation (`{"check":"site"}`) runs the site check.
 *
 * @remarks
 * Only `lambda:InvokeFunction` reaches the check: a Function URL request always arrives wrapped in
 * its own event, with the body as a string. The deploy and web roles and the owner hold it; the
 * first two may also forge a Function URL event, which still needs a valid session token.
 */
export function createEntryPoint(
  handlers: EntryPointHandlers,
): (
  event: LambdaFunctionURLEvent | SiteCheckEvent,
) => Promise<APIGatewayProxyStructuredResultV2 | SiteCheckReport> {
  return async (event) => {
    if (!('check' in event)) return handlers.http(event);
    if (!siteCheckEventSchema.safeParse(event).success) {
      throw new Error('core-api received an invalid site check.');
    }
    const report = await handlers.checkSite();
    console.info({ message: 'site check', ...report });
    return report;
  };
}
