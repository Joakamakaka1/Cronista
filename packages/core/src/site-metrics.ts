/** Namespace of the custom metrics that tell whether the public site and its pages work. */
export const SITE_METRIC_NAMESPACE = 'Cronista/Site';

/** Counts each uncaught error that a player's browser reports. */
export const CLIENT_ERROR_METRIC = 'ClientError';

/** Counts each hourly check of the public site that failed, its retry included. */
export const SITE_CHECK_FAILED_METRIC = 'SiteCheckFailed';
