/** The app's version, the root `package.json` version at build time. */
declare const __CRONISTA_RELEASE__: string;
/** The Supabase project the build talks to: production, or the local one in local mode. */
declare const __SUPABASE_URL__: string;
/** That project's publishable key, public by design. */
declare const __SUPABASE_PUBLISHABLE_KEY__: string;
/** The public half of the VAPID pair the build's pushes are signed with: public by design. */
declare const __VAPID_PUBLIC_KEY__: string;
