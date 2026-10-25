import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  Certificate,
  CertificateValidation,
  type ICertificate,
} from 'aws-cdk-lib/aws-certificatemanager';
import { CaaRecord, CaaTag, type IHostedZone, PublicHostedZone } from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';

// The public address of the app, delegated from the jcvstro.dev zone in Cloudflare.
const domainName = 'cronista.jcvstro.dev';

/**
 * The app's domain: the Route 53 zone Cloudflare delegates to, and the CloudFront certificate,
 * which CloudFront only accepts from us-east-1.
 *
 * @remarks
 * The NS records in Cloudflare point at this zone's name servers, so replacing the zone breaks the
 * delegation until they change. Replacing the certificate needs the edge on the new one first: the
 * old one cannot be deleted while the distribution uses it.
 */
export class DomainStack extends Stack {
  /** The delegated zone, for the distribution's alias records and the flat-rate plan. */
  readonly hostedZone: IHostedZone;

  /** Certificate for the domain, for the distribution. */
  readonly certificate: ICertificate;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const zone = new PublicHostedZone(this, 'Zone', {
      zoneName: domainName,
      comment: 'Cronista, delegated from Cloudflare (jcvstro.dev)',
    });
    zone.applyRemovalPolicy(RemovalPolicy.RETAIN);

    // jcvstro.dev has Cloudflare's CAA records, which leave Amazon out: without its own, the
    // subdomain would inherit them and ACM could not issue. No wildcard certificate is ever needed.
    const caa = new CaaRecord(this, 'CaaAmazon', {
      zone,
      values: [
        { flag: 0, tag: CaaTag.ISSUE, value: 'amazon.com' },
        { flag: 0, tag: CaaTag.ISSUEWILD, value: ';' },
      ],
    });

    const certificate = new Certificate(this, 'Certificate', {
      domainName,
      validation: CertificateValidation.fromDns(zone),
    });
    // ACM checks CAA when it issues: before the record exists, it would read the parent's.
    certificate.node.addDependency(caa);

    this.hostedZone = zone;
    this.certificate = certificate;
  }
}
