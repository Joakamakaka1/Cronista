import { postToApi } from '../api/post-to-api.ts';
import { type ErrorReport, reportFromErrorEvent, reportFromStack } from './client-error-report.ts';

const maxReports = 5;
let reports = 0;

/**
 * Sends one report to `POST /api/client-errors`, at most five per page load. `postToApi` sends
 * nothing while signed out, since the route only accepts players. Never retried or shown: nothing a
 * player can do about it, and a failed report must not become an error itself.
 */
export function sendErrorReport(report: ErrorReport | undefined): void {
  if (report === undefined || reports >= maxReports) return;
  reports += 1;
  void postToApi(
    '/api/client-errors',
    { ...report, release: __CRONISTA_RELEASE__ },
    { retryAuth: false },
  );
}

/**
 * Reports what the error boundary cannot see, such as failures in event handlers and promises: the
 * listeners on `error` and `unhandledrejection`.
 */
export function listenForUncaughtErrors(): void {
  window.addEventListener('error', (event) => {
    sendErrorReport(reportFromErrorEvent(event, location.origin));
  });
  window.addEventListener('unhandledrejection', (event) => {
    sendErrorReport(reportFromStack(event.reason, location.origin));
  });
}
