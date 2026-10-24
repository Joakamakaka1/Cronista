import { Stack, type StackProps } from 'aws-cdk-lib';
import { CfnAnalyzer } from 'aws-cdk-lib/aws-accessanalyzer';
import type { Construct } from 'constructs';

/**
 * IAM Access Analyzer for external access. Analyzers are regional, so the app deploys one in
 * every region it uses.
 */
export class AccessAnalyzerStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    // A region allows one account analyzer and CloudFormation creates the replacement first, so
    // replacing it takes two deploys (remove, then add): keep its logical ID and properties.
    new CfnAnalyzer(this, 'ExternalAccess', { type: 'ACCOUNT' });
  }
}
