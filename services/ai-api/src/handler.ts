import { type HintRejection, hintRequestSchema } from '@cronista/core';
import type { HintResult } from '@cronista/engine';
import {
  authenticate,
  type FunctionUrlHandler,
  jsonResponse,
  readJsonBody,
  type RequestLogEntry,
  type SessionVerifier,
  withRequestLog,
} from '@cronista/http';

/** The AI providers whose API key the provider check reads from SSM. */
export type Provider = 'anthropic' | 'voyage' | 'langfuse';

/** A hint, or why there is none, including the keys for making one not being readable. */
export type HintAnswer =
  HintResult | { readonly ok: false; readonly error: 'providers_not_configured' };

/** What the ai-api handler depends on, so tests can replace it. */
export interface AiApiDependencies {
  readonly verifySession: SessionVerifier;
  /** The game engine's `requestHint`, with its store, narrator and bible. */
  readonly requestHint: (userId: string) => Promise<HintAnswer>;
  /** Sends the traces still waiting: the environment may freeze as soon as the handler returns. */
  readonly flushTraces: () => Promise<void>;
  readonly log?: (entry: RequestLogEntry) => void;
}

const hintPath = '/api/ai/hint';

// The request is an empty object; anything near this size is not a hint request.
const maxBodyBytes = 1024;

const rejectionStatus: Readonly<Record<HintRejection | 'providers_not_configured', number>> = {
  no_character: 403,
  no_action: 409,
  day_not_open: 409,
  day_closed: 409,
  hint_unavailable: 503,
  providers_not_configured: 503,
};

/**
 * Creates the ai-api handler at `/api/ai/*`: one hint per player and day, on their own action. A
 * technical failure answers 503 and spends no quota, so the player can ask again.
 */
export function createHandler(dependencies: AiApiDependencies): FunctionUrlHandler {
  return withRequestLog(async (event) => {
    const session = await authenticate(event, dependencies.verifySession);
    if (!session.ok) return session.error;

    if (event.rawPath !== hintPath) return jsonResponse(404, { error: 'not_found' });
    if (event.requestContext.http.method !== 'POST') {
      return jsonResponse(405, { error: 'method_not_allowed' });
    }
    const request = readJsonBody(event, hintRequestSchema, maxBodyBytes);
    if (!request.ok) {
      return request.error === 'too_large'
        ? jsonResponse(413, { error: 'too_large' })
        : jsonResponse(400, { error: 'invalid_body' });
    }

    let hint: HintAnswer;
    try {
      hint = await dependencies.requestHint(session.value.userId);
    } finally {
      await dependencies.flushTraces();
    }

    if (hint.ok) return jsonResponse(200, { ...hint.value });
    // A throw becomes a 500, which the alarm on this API's 5xx sees.
    if (hint.error === 'store_unavailable') throw new Error('The game store is unavailable.');
    return jsonResponse(rejectionStatus[hint.error], { error: hint.error });
  }, dependencies.log);
}
