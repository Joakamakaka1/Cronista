import type { Stack } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

/**
 * The cdk-nag AWS Solutions findings a stack still has after its acknowledgments, one line per
 * finding so that a failed test assertion names each one.
 */
export function nagFindings(stack: Stack): string[] {
  return new AwsSolutionsChecks()
    .validateScope(stack)
    .violations.flatMap((violation) =>
      violation.violatingResources.map(
        (resource) =>
          `${violation.ruleName} on ${resource.constructPath ?? resource.resourceLogicalId ?? '?'}`,
      ),
    );
}
