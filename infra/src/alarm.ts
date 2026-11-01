import { Duration } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  type IMetric,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';

/** Period of the alarms that count failures. */
export const alarmPeriod = Duration.minutes(5);

/**
 * An alarm that emails the alerts topic as soon as `metric` reaches 1 in a period, and stays quiet
 * while the metric has no data.
 */
export function alarmOnAny(
  scope: Construct,
  id: string,
  description: string,
  metric: IMetric,
  alerts: ITopic,
): void {
  new Alarm(scope, id, {
    alarmDescription: description,
    metric,
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new SnsAction(alerts));
}
