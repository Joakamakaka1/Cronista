/**
 * AWS CDK app. The CLI runs it with Node's native TypeScript support (see `cdk.json`).
 *
 * @packageDocumentation
 */
import { App } from 'aws-cdk-lib';

import { EdgeStack } from './edge-stack.ts';
import { WebAclStack } from './web-acl-stack.ts';

// The CDK CLI sets it from the active AWS profile, so the account ID never lives in the repo.
const account = process.env.CDK_DEFAULT_ACCOUNT;
if (account === undefined) {
  throw new Error('CDK_DEFAULT_ACCOUNT is not set: run this app through the CDK CLI.');
}

const app = new App();

const webAcl = new WebAclStack(app, 'CronistaWebAcl', {
  env: { account, region: 'us-east-1' },
  crossRegionReferences: true,
});

new EdgeStack(app, 'CronistaEdge', {
  env: { account, region: 'eu-west-1' },
  crossRegionReferences: true,
  webAclArn: webAcl.webAclArn,
});
