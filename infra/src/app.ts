/**
 * AWS CDK app. The CLI runs it with Node's native TypeScript support (see `cdk.json`).
 *
 * @packageDocumentation
 */
import { App } from 'aws-cdk-lib';

import { AccessAnalyzerStack } from './access-analyzer-stack.ts';
import { AccountGuardsStack } from './account-guards-stack.ts';
import { EdgeStack } from './edge-stack.ts';
import { WebAclStack } from './web-acl-stack.ts';

// The CDK CLI sets it from the active AWS profile, so the account ID never lives in the repo.
const account = process.env.CDK_DEFAULT_ACCOUNT;
if (account === undefined) {
  throw new Error('CDK_DEFAULT_ACCOUNT is not set: run this app through the CDK CLI.');
}

const app = new App();

// eu-west-1 hosts the app; us-east-1 holds what CloudFront requires there (WAF, certificates).
const regions = ['eu-west-1', 'us-east-1'] as const;

// CronistaAccountGuards sends the alerts, so every analyzer's findings must reach its region.
const alertsRegion = 'eu-west-1';

new AccountGuardsStack(app, 'CronistaAccountGuards', { env: { account, region: alertsRegion } });

for (const region of regions) {
  new AccessAnalyzerStack(app, `CronistaAccessAnalyzer-${region}`, {
    env: { account, region },
    alertsRegion,
  });
}

const webAcl = new WebAclStack(app, 'CronistaWebAcl', {
  env: { account, region: 'us-east-1' },
  crossRegionReferences: true,
});

new EdgeStack(app, 'CronistaEdge', {
  env: { account, region: 'eu-west-1' },
  crossRegionReferences: true,
  webAclArn: webAcl.webAclArn,
});
