import { App, type Stack } from 'aws-cdk-lib';
import type { CloudFormationStackArtifact } from 'aws-cdk-lib/cx-api';
import { beforeAll, describe, expect, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { AccessAnalyzerStack } from './access-analyzer-stack.ts';
import { AlertsStack } from './alerts-stack.ts';
import { AuditTrailStack } from './audit-trail-stack.ts';
import { GitHubAccessStack } from './github-access-stack.ts';
import { ThreatDetectionStack } from './threat-detection-stack.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

// The CLI uploads a larger template to a bucket instead of sending it inline.
const largestInlineTemplate = 50 * 1024;

const env = { account, region: 'us-east-1' };

describe.each<[string, (app: App) => Stack]>([
  ['GitHubAccessStack', (app) => new GitHubAccessStack(app, 'Stack', { env })],
  ['AlertsStack', (app) => new AlertsStack(app, 'Stack', { env })],
  ['AuditTrailStack', (app) => new AuditTrailStack(app, 'Stack', { env })],
  [
    'AccessAnalyzerStack',
    (app) => new AccessAnalyzerStack(app, 'Stack', { env, alertsRegion: 'eu-west-1' }),
  ],
  [
    'ThreatDetectionStack',
    (app) => new ThreatDetectionStack(app, 'Stack', { env, alertsRegion: 'eu-west-1' }),
  ],
])('%s', (_name, create) => {
  let artifact: CloudFormationStackArtifact;

  beforeAll(() => {
    const app = new App({ context: cdkConfig.context });
    const stack = create(app);
    artifact = app.synth().getStackArtifact(stack.artifactId);
  });

  it('deploys with the credentials of the caller and no service role', () => {
    expect(artifact.assumeRoleArn).toBeUndefined();
    expect(artifact.cloudFormationExecutionRoleArn).toBeUndefined();
  });

  it('sends its template inline, never through the CDK assets bucket that CI can write to', () => {
    expect(artifact.stackTemplateAssetObjectUrl).toBeUndefined();
    expect(artifact.assets).toEqual([]);
    expect(JSON.stringify(artifact.template).length).toBeLessThan(largestInlineTemplate);
  });

  it('needs no bootstrap version', () => {
    expect(artifact.requiresBootstrapStackVersion).toBeUndefined();
    expect(artifact.template).not.toHaveProperty('Parameters.BootstrapVersion');
  });
});
