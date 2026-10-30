import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { DomainStack } from './domain-stack.ts';
import { nagFindings } from './nag-findings.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

let domainStack: DomainStack;
let domain: Template;

beforeAll(() => {
  const app = new App({ context: cdkConfig.context });
  domainStack = new DomainStack(app, 'Domain', { env: { account, region: 'us-east-1' } });
  domain = Template.fromStack(domainStack);
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

  it('lets only Amazon issue, and no wildcards, instead of inheriting the parent CAA', () => {
    domain.hasResourceProperties('AWS::Route53::RecordSet', {
      HostedZoneId: { Ref: Match.anyValue() },
      Name: 'cronista.jcvstro.dev.',
      Type: 'CAA',
      ResourceRecords: ['0 issue "amazon.com"', '0 issuewild ";"'],
    });
  });

  it('creates the certificate only after the CAA record exists', () => {
    const [caaId] = Object.keys(
      domain.findResources('AWS::Route53::RecordSet', { Properties: { Type: 'CAA' } }),
    );
    for (const certificate of Object.values(
      domain.findResources('AWS::CertificateManager::Certificate'),
    )) {
      expect(certificate.DependsOn).toContain(caaId);
    }
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

  it('passes the AWS Solutions checks', () => {
    expect(nagFindings(domainStack)).toEqual([]);
  });
});
