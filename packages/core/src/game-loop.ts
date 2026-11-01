/** Namespace of the custom metrics that tell whether the day opens and closes. */
export const GAME_LOOP_METRIC_NAMESPACE = 'Cronista/GameLoop';

/** Counts a job with a deadline that finished its work, by {@link JOB_DIMENSION}. */
export const JOB_COMPLETED_METRIC = 'JobCompleted';

/** The job of a {@link JOB_COMPLETED_METRIC} data point: `open-day` or `close-day`. */
export const JOB_DIMENSION = 'Job';

/** Counts each finished check of a deadline, so an alarm notices when the checks stop. */
export const DEADLINE_CHECKED_METRIC = 'DeadlineChecked';

/**
 * One count of `metric` as a line of CloudWatch embedded metric format.
 *
 * @remarks
 * Write it straight to stdout. With the JSON log format, Lambda wraps what `console` logs under a
 * `message` key, and CloudWatch no longer recognizes it as a metric.
 *
 * @param at - The time of the data point.
 * @param dimensions - The metric's dimensions, by name.
 */
export function embeddedMetricLine(
  metric: string,
  at: Date,
  dimensions: Readonly<Record<string, string>> = {},
): string {
  const record = {
    _aws: {
      Timestamp: at.getTime(),
      CloudWatchMetrics: [
        {
          Namespace: GAME_LOOP_METRIC_NAMESPACE,
          Dimensions: [Object.keys(dimensions)],
          Metrics: [{ Name: metric, Unit: 'Count' }],
        },
      ],
    },
    ...dimensions,
    [metric]: 1,
  };
  return `${JSON.stringify(record)}\n`;
}
