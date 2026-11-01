import { createHash } from 'node:crypto';

/** What the public site answered: 0 is a request that never got an answer. */
export interface SiteCheckReport {
  readonly root: {
    readonly status: number;
    readonly cacheControl?: string;
    readonly contentType?: string;
    /** Hash of the body, which the front's deploy compares with the `index.html` it uploaded. */
    readonly sha256?: string;
  };
  readonly me: { readonly status: number };
  readonly hint: { readonly status: number };
}

/** What the site check depends on. */
export interface SiteCheckOptions {
  /** Public origin of the site, without a trailing slash. */
  readonly siteUrl: string;
  /** Replaces the global `fetch` in tests. */
  readonly fetch?: typeof fetch;
}

// All three run at once, under the 10 s timeout of the Lambda, which a cold `ai-api` can take a while
// to answer. The workflows try again on a timeout.
const requestTimeoutMs = 8_000;

const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');

/**
 * Creates the check of the public site that the deploy workflows run after a deploy: the page, plus
 * a request to each API, which must answer 401.
 *
 * @remarks
 * Those answers prove the whole path, from CloudFront through origin access control to each Lambda
 * and its session check. It runs here because the geo restriction refuses GitHub's runners, which are hosted mostly in the
 * US. It sends no token, keeps only statuses, two headers and a hash, and never throws: a request
 * that fails reports status 0, so the workflow's log says which one.
 */
export function createSiteCheck(options: SiteCheckOptions): () => Promise<SiteCheckReport> {
  const send = options.fetch ?? fetch;
  const statusOf = async (path: string, init?: RequestInit) => {
    try {
      const reply = await send(`${options.siteUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      return { status: reply.status };
    } catch {
      return { status: 0 };
    }
  };
  const readRoot = async (): Promise<SiteCheckReport['root']> => {
    try {
      const reply = await send(`${options.siteUrl}/`, {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const cacheControl = reply.headers.get('cache-control');
      const contentType = reply.headers.get('content-type');
      return {
        status: reply.status,
        ...(cacheControl !== null && { cacheControl }),
        ...(contentType !== null && { contentType }),
        sha256: sha256(Buffer.from(await reply.arrayBuffer())),
      };
    } catch {
      return { status: 0 };
    }
  };

  return async () => {
    // Origin access control signs a POST only when the client sends the body's hash.
    const body = '{}';
    const [root, me, hint] = await Promise.all([
      readRoot(),
      statusOf('/api/me'),
      statusOf('/api/ai/hint', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-amz-content-sha256': sha256(body) },
      }),
    ]);
    return { root, me, hint };
  };
}
