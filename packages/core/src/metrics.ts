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
  namespace: string,
  metric: string,
  at: Date,
  dimensions: Readonly<Record<string, string>> = {},
): string {
  const record = {
    _aws: {
      Timestamp: at.getTime(),
      CloudWatchMetrics: [
        {
          Namespace: namespace,
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
