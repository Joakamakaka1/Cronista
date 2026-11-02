import { describe, expect, it } from 'vitest';

import { embeddedMetricLine } from './metrics.ts';

const at = new Date('2026-11-02T07:00:05Z');

describe('embeddedMetricLine', () => {
  it('writes one count of a metric with its dimension, as CloudWatch embedded metric format', () => {
    const line = embeddedMetricLine('Cronista/Test', 'JobCompleted', at, { Job: 'open-day' });

    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({
      _aws: {
        Timestamp: at.getTime(),
        CloudWatchMetrics: [
          {
            Namespace: 'Cronista/Test',
            Dimensions: [['Job']],
            Metrics: [{ Name: 'JobCompleted', Unit: 'Count' }],
          },
        ],
      },
      Job: 'open-day',
      JobCompleted: 1,
    });
  });

  it('writes an empty dimension set for a metric without dimensions', () => {
    const line = embeddedMetricLine('Cronista/Test', 'DeadlineChecked', at);

    expect(JSON.parse(line)).toEqual({
      _aws: {
        Timestamp: at.getTime(),
        CloudWatchMetrics: [
          {
            Namespace: 'Cronista/Test',
            Dimensions: [[]],
            Metrics: [{ Name: 'DeadlineChecked', Unit: 'Count' }],
          },
        ],
      },
      DeadlineChecked: 1,
    });
  });

  it('stays on one line, since each line of stdout is one log event', () => {
    const line = embeddedMetricLine('Cronista/Test', 'JobCompleted', at, { Job: 'close-day' });
    expect(line.trimEnd()).not.toContain('\n');
  });
});
