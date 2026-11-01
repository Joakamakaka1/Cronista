import { describe, expect, it } from 'vitest';

import {
  DEADLINE_CHECKED_METRIC,
  embeddedMetricLine,
  GAME_LOOP_METRIC_NAMESPACE,
  JOB_COMPLETED_METRIC,
  JOB_DIMENSION,
} from './game-loop.ts';

const at = new Date('2026-11-02T07:00:05Z');

describe('embeddedMetricLine', () => {
  it('writes one count of a metric with its dimension, as CloudWatch embedded metric format', () => {
    const line = embeddedMetricLine(JOB_COMPLETED_METRIC, at, { [JOB_DIMENSION]: 'open-day' });

    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({
      _aws: {
        Timestamp: at.getTime(),
        CloudWatchMetrics: [
          {
            Namespace: GAME_LOOP_METRIC_NAMESPACE,
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
    const line = embeddedMetricLine(DEADLINE_CHECKED_METRIC, at);

    expect(JSON.parse(line)).toEqual({
      _aws: {
        Timestamp: at.getTime(),
        CloudWatchMetrics: [
          {
            Namespace: GAME_LOOP_METRIC_NAMESPACE,
            Dimensions: [[]],
            Metrics: [{ Name: 'DeadlineChecked', Unit: 'Count' }],
          },
        ],
      },
      DeadlineChecked: 1,
    });
  });

  it('stays on one line, since each line of stdout is one log event', () => {
    const line = embeddedMetricLine(JOB_COMPLETED_METRIC, at, { [JOB_DIMENSION]: 'close-day' });
    expect(line.trimEnd()).not.toContain('\n');
  });
});
