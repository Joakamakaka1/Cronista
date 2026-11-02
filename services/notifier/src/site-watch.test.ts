import type { SiteCheckReport } from '@cronista/http/site-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSiteWatch } from './site-watch.ts';

const healthy: SiteCheckReport = {
  root: { status: 200, cacheControl: 'no-cache', contentType: 'text/html', sha256: 'abc' },
  me: { status: 401 },
  hint: { status: 401 },
};
const broken: SiteCheckReport = { root: { status: 503 }, me: { status: 0 }, hint: { status: 401 } };

afterEach(() => {
  vi.restoreAllMocks();
});

function watchWith(...reports: SiteCheckReport[]) {
  const checkSite = vi.fn<() => Promise<SiteCheckReport>>();
  for (const report of reports) checkSite.mockResolvedValueOnce(report);
  const reportFailure = vi.fn<() => void>();
  const watch = createSiteWatch({ checkSite, reportFailure, retryDelayMs: 0 });
  const logs = {
    info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
  };
  return { watch, checkSite, reportFailure, logs };
}

describe('createSiteWatch', () => {
  it('logs a healthy site once, without a retry or a metric', async () => {
    const { watch, checkSite, reportFailure, logs } = watchWith(healthy);

    await watch();

    expect(checkSite).toHaveBeenCalledOnce();
    expect(reportFailure).not.toHaveBeenCalled();
    expect(logs.info).toHaveBeenCalledExactlyOnceWith({ message: 'site check', ...healthy });
    expect(logs.error).not.toHaveBeenCalled();
  });

  it('tries once more, so that a network blip writes no metric', async () => {
    const { watch, checkSite, reportFailure, logs } = watchWith(broken, healthy);

    await watch();

    expect(checkSite).toHaveBeenCalledTimes(2);
    expect(reportFailure).not.toHaveBeenCalled();
    expect(logs.warn).toHaveBeenCalledExactlyOnceWith({
      message: 'site check will retry',
      ...broken,
    });
    expect(logs.info).toHaveBeenCalledExactlyOnceWith({ message: 'site check', ...healthy });
    expect(logs.error).not.toHaveBeenCalled();
  });

  it('logs the report and writes one metric when the retry fails too, without throwing', async () => {
    const { watch, checkSite, reportFailure, logs } = watchWith(broken, broken);

    await expect(watch()).resolves.toBeUndefined();

    expect(checkSite).toHaveBeenCalledTimes(2);
    expect(reportFailure).toHaveBeenCalledOnce();
    expect(logs.error).toHaveBeenCalledExactlyOnceWith({
      message: 'site check failed',
      ...broken,
    });
    expect(logs.info).not.toHaveBeenCalled();
  });
});
