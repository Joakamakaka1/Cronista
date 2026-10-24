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
    new CfnAnalyzer(this, 'ExternalAccess', { type: 'ACCOUNT' });
  }
}
