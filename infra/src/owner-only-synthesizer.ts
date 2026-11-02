import { type IStackSynthesizer, LegacyStackSynthesizer } from 'aws-cdk-lib';

/**
 * Synthesizer of the stacks only the owner deploys: the CLI runs them with the credentials of the
 * owner's machine, with no service role, and sends the template inline.
 *
 * @remarks
 * The template must stay out of the CDK assets bucket, so `CliCredentialsStackSynthesizer` does not
 * fit. A deploy can write there through the file publishing role, and the CLI skips a hash that
 * already exists, so a template planted under the next hash would run with the owner's credentials.
 * It only stays inline while it is under 50 KiB and the stack has no assets, which a test checks.
 */
export const ownerOnlySynthesizer = (): IStackSynthesizer =>
  // CDK types bootstrapQualifier as `string | undefined`, which IStackSynthesizer rejects under
  // exactOptionalPropertyTypes; the object is a plain synthesizer.
  new LegacyStackSynthesizer() as IStackSynthesizer;
