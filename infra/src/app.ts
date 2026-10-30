/**
 * AWS CDK app. The CLI runs it with Node's native TypeScript support (see `cdk.json`).
 *
 * @packageDocumentation
 */
import { App, type IPolicyValidationPlugin, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

import { AccessAnalyzerStack } from './access-analyzer-stack.ts';
import { AccountGuardsStack } from './account-guards-stack.ts';
import { DomainStack } from './domain-stack.ts';
import { EdgeStack } from './edge-stack.ts';
import { GitHubAccessStack } from './github-access-stack.ts';
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

// Deployed only from the owner's machine (see its TSDoc); CI deploys every other stack.
new GitHubAccessStack(app, 'CronistaGitHubAccess', { env: { account, region: 'eu-west-1' } });

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

const domain = new DomainStack(app, 'CronistaDomain', {
  env: { account, region: 'us-east-1' },
  crossRegionReferences: true,
});

const edge = new EdgeStack(app, 'CronistaEdge', {
  env: { account, region: 'eu-west-1' },
  crossRegionReferences: true,
  webAclArn: webAcl.webAclArn,
  hostedZone: domain.hostedZone,
  certificate: domain.certificate,
});

// cdk-nag (AWS Solutions) on the public edge. A violation stops `cdk synth`, `diff` and `deploy`.
// The other stacks stay out until their findings are reviewed.
const awsSolutions = new AwsSolutionsChecks();
const edgeChecks: IPolicyValidationPlugin = {
  name: 'cdk-nag-AwsSolutions',
  validate: () => {
    const reports = [webAcl, edge].map((stack) => awsSolutions.validateScope(stack));
    return {
      success: reports.every((report) => report.success),
      violations: reports.flatMap((report) => report.violations),
    };
  },
};
Validations.of(app).addPlugins(edgeChecks);
