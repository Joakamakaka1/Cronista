import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  Certificate,
  CertificateValidation,
  type ICertificate,
} from 'aws-cdk-lib/aws-certificatemanager';
import { CaaAmazonRecord, type IHostedZone, PublicHostedZone } from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';

// The public address of the app, delegated from the jcvstro.dev zone in Cloudflare.
const domainName = 'cronista.jcvstro.dev';

/**
 * The app's domain: the Route 53 zone Cloudflare delegates to, and the CloudFront certificate,
 * which CloudFront only accepts from us-east-1.
 *
 * @remarks
 * The zone was created by hand and imported (`cdk import`), so it keeps the name servers that the
 * NS records in Cloudflare point at. Replacing it would break the delegation until those records
 * change.
 */
export class DomainStack extends Stack {
  /** The delegated zone, for the distribution's alias records and the flat-rate plan. */
  readonly hostedZone: IHostedZone;

  /** Certificate for the domain, for the distribution. */
  readonly certificate: ICertificate;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const zone = new PublicHostedZone(this, 'Zone', { zoneName: domainName });
    zone.applyRemovalPolicy(RemovalPolicy.RETAIN);

    // jcvstro.dev has Cloudflare's CAA records, which leave Amazon out: without its own, the
    // subdomain would inherit them and ACM could not issue.
    new CaaAmazonRecord(this, 'CaaAmazon', { zone });

    this.hostedZone = zone;
    this.certificate = new Certificate(this, 'Certificate', {
      domainName,
      validation: CertificateValidation.fromDns(zone),
    });
  }
}
