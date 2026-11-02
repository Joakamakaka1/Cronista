import { setTimeout as wait } from 'node:timers/promises';

import { isSiteHealthy, type SiteCheckReport } from '@cronista/http/site-check';

/** What the site watch depends on, so tests can replace it. */
export interface SiteWatchDependencies {
  readonly checkSite: () => Promise<SiteCheckReport>;
  /** Tells the alarm on the site that it failed its check. */
  readonly reportFailure: () => void;
  /** How long the check waits before its retry. */
  readonly retryDelayMs?: number;
}

const defaultRetryDelayMs = 5_000;

/**
 * Creates the hourly watch of the public site, which covers what the Lambda alarms never see:
 * CloudFront, DNS and the certificate between deploys.
 *
 * @remarks
 * It tries once more before reporting, so that a network blip sends no email. A failure writes a
 * metric instead of throwing: the queue would retry the check, and the dead-letter alarm would send
 * a second email for the same failure.
 */
export function createSiteWatch(dependencies: SiteWatchDependencies): () => Promise<void> {
  const { checkSite, reportFailure, retryDelayMs = defaultRetryDelayMs } = dependencies;
  return async () => {
    let report = await checkSite();
    if (!isSiteHealthy(report)) {
      console.warn({ message: 'site check will retry', ...report });
      await wait(retryDelayMs);
      report = await checkSite();
    }
    if (isSiteHealthy(report)) {
      console.info({ message: 'site check', ...report });
    } else {
      console.error({ message: 'site check failed', ...report });
      reportFailure();
    }
  };
}
