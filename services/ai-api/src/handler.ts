import {
  authenticate,
  type FunctionUrlHandler,
  jsonResponse,
  type RequestLogEntry,
  type SessionVerifier,
  withRequestLog,
} from '@cronista/http';

import type { ProviderKeysResult } from './provider-keys.ts';

/** What the ai-api handler depends on, so tests can replace it. */
export interface AiApiDependencies {
  readonly verifySession: SessionVerifier;
  readonly readProviderKeys: () => Promise<ProviderKeysResult>;
  readonly log?: (entry: RequestLogEntry) => void;
}

const hintPath = '/api/ai/hint';

/**
 * Creates the ai-api handler at `/api/ai/*`. The hint is not implemented: the handler checks the
 * session and that the provider keys are readable, and answers 501.
 */
export function createHandler(dependencies: AiApiDependencies): FunctionUrlHandler {
  return withRequestLog(async (event) => {
    const session = await authenticate(event, dependencies.verifySession);
    if (!session.ok) return session.error;

    if (event.rawPath !== hintPath) return jsonResponse(404, { error: 'not_found' });
    if (event.requestContext.http.method !== 'POST') {
      return jsonResponse(405, { error: 'method_not_allowed' });
    }

    const keys = await dependencies.readProviderKeys();
    if (!keys.ok) {
      console.warn({ message: 'provider keys unreadable', unreadable: keys.error.unreadable });
      return jsonResponse(503, { error: 'providers_not_configured' });
    }
    return jsonResponse(501, { error: 'not_implemented' });
  }, dependencies.log);
}
