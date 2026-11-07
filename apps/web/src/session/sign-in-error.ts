// Read before the Supabase client starts, which only looks for a session in the fragment.
const fragment = new URLSearchParams(location.hash.slice(1));
const query = new URLSearchParams(location.search);

/**
 * Whether Supabase Auth came back from Google with an error, such as an email off the list. Its text
 * is never shown: the URL is anyone's to craft.
 */
export const signInFailed = fragment.has('error') || query.has('error');

if (signInFailed) history.replaceState(null, '', location.pathname);
