import { z } from 'zod';

/**
 * What the deploy workflows send `core-api` with `aws lambda invoke` to check the public site from
 * inside AWS. A Function URL request never has this shape, so the check has no public surface.
 */
export const siteCheckEventSchema = z.strictObject({ check: z.literal('site') });

/** The site check event, validated by {@link siteCheckEventSchema}. */
export type SiteCheckEvent = z.infer<typeof siteCheckEventSchema>;
