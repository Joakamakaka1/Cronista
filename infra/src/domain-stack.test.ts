import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { DomainStack } from './domain-stack.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

let domain: Template;

beforeAll(() => {
  const app = new App({ context: cdkConfig.context });
  const stack = new DomainStack(app, 'Domain', { env: { account, region: 'us-east-1' } });
  domain = Template.fromStack(stack);
});

describe('DomainStack', () => {
  it('keeps the delegated zone if the stack goes, so Cloudflare never points at nothing', () => {
    domain.resourceCountIs('AWS::Route53::HostedZone', 1);
    domain.hasResource('AWS::Route53::HostedZone', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: { Name: 'cronista.jcvstro.dev.' },
    });
  });

  it('lets only Amazon issue certificates, instead of inheriting the parent CAA records', () => {
    domain.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'cronista.jcvstro.dev.',
      Type: 'CAA',
      ResourceRecords: ['0 issue "amazon.com"'],
    });
  });

  it('issues the CloudFront certificate in us-east-1 with DNS validation in the zone', () => {
    domain.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'cronista.jcvstro.dev',
      ValidationMethod: 'DNS',
      DomainValidationOptions: [
        Match.objectLike({
          DomainName: 'cronista.jcvstro.dev',
          HostedZoneId: { Ref: Match.anyValue() },
        }),
      ],
    });
  });
});
