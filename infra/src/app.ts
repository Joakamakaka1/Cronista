/**
 * AWS CDK app. The CLI runs it with Node's native TypeScript support (see `cdk.json`).
 *
 * @packageDocumentation
 */
import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

import { AccessAnalyzerStack } from './access-analyzer-stack.ts';
import { AccountGuardsStack } from './account-guards-stack.ts';
import { AlertsStack } from './alerts-stack.ts';
import { AuditTrailStack } from './audit-trail-stack.ts';
import { DomainStack } from './domain-stack.ts';
import { EdgeStack } from './edge-stack.ts';
import { GitHubAccessStack } from './github-access-stack.ts';
import { ThreatDetectionStack } from './threat-detection-stack.ts';
import { WebAclStack } from './web-acl-stack.ts';
import { WorkersStack } from './workers-stack.ts';

// The CDK CLI sets it from the active AWS profile, so the account ID never lives in the repo.
const account = process.env.CDK_DEFAULT_ACCOUNT;
if (account === undefined) {
  throw new Error('CDK_DEFAULT_ACCOUNT is not set: run this app through the CDK CLI.');
}

const app = new App();

// eu-west-1 hosts the app; us-east-1 holds what CloudFront requires there (WAF, certificates).
const regions = ['eu-west-1', 'us-east-1'] as const;

// CronistaAlerts holds the alerts topic, so every analyzer's and detector's findings must reach its
// region. Every stack that publishes there lives in that region.
const alertsRegion = 'eu-west-1';

const accountGuards = new AccountGuardsStack(app, 'CronistaAccountGuards', {
  env: { account, region: alertsRegion },
});

// Deployed only from the owner's machine (see their TSDoc), like the analyzers and detectors below.
// CI deploys the stacks that `.github/workflows/deploy.yml` lists: a new stack goes there too, and a
// new owner-only one joins the denies in `github-access-stack.ts`.
new AlertsStack(app, 'CronistaAlerts', { env: { account, region: alertsRegion } });
new GitHubAccessStack(app, 'CronistaGitHubAccess', { env: { account, region: 'eu-west-1' } });
new AuditTrailStack(app, 'CronistaAuditTrail', { env: { account, region: 'eu-west-1' } });

for (const region of regions) {
  new AccessAnalyzerStack(app, `CronistaAccessAnalyzer-${region}`, {
    env: { account, region },
    alertsRegion,
  });
  new ThreatDetectionStack(app, `CronistaThreatDetection-${region}`, {
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

// Same region as the alerts topic, which its alarms publish to.
const workers = new WorkersStack(app, 'CronistaWorkers', {
  env: { account, region: alertsRegion },
  siteUrl: `https://${domain.hostedZone.zoneName}`,
});

// core-api queues "who played" by the queue's name alone, so the queue exists before it runs.
edge.addStackDependency(workers);

// Last, in case its update deletes a topic: an older version keeps its alerts topic here, so the
// stacks that publish to it must have moved away first, or a failed deploy would strand them.
accountGuards.addStackDependency(edge);
accountGuards.addStackDependency(workers);

// cdk-nag (AWS Solutions) on every stack. A violation stops `cdk synth`, `diff` and `deploy`.
// Acknowledgments are construct metadata: they never change a template.
Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
