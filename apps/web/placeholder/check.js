// Connection check: signs in with Google through Supabase Auth and calls both APIs the way the app
// does (session JWT in X-Session-Token, body hash for CloudFront's OAC). Once signed in, it also
// reports the page's uncaught errors to core-api.

import { release } from './release.js';

// Public by design: it ships in every Supabase front end.
const supabaseUrl = 'https://crbkwqrqaogykugxhewy.supabase.co';

const checks = [
  { label: 'Sin sesión, la API te rechaza', method: 'GET', path: '/api/me', expected: [401] },
  {
    label: 'Con sesión, la API te reconoce',
    method: 'GET',
    path: '/api/me',
    expected: [200],
    signed: true,
  },
  {
    label: 'Sin temporada, una acción válida llega a la base de datos y se rechaza',
    method: 'POST',
    path: '/api/actions',
    body: { text: 'Prueba de conexión.', stake: 0 },
    // This page only lives until the app replaces it, before any season exists. With an open day,
    // it would send a real action.
    expected: [403],
    signed: true,
  },
  {
    label: 'Una acción de 1001 caracteres se rechaza',
    method: 'POST',
    path: '/api/actions',
    body: { text: 'a'.repeat(1001), stake: 0 },
    expected: [400],
    signed: true,
  },
  {
    label: 'Sin temporada, la pista lee sus claves y se rechaza',
    method: 'POST',
    path: '/api/ai/hint',
    body: {},
    expected: [403],
    signed: true,
    hints: { 503: 'faltan claves de los proveedores en SSM' },
  },
];

// The types `clientErrorSchema` names in `packages/core`, which this page has no build to import.
const reportedErrorTypes = new Set([
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
]);
const maxErrorReports = 5;

// Supabase Auth returns the session (or the error) in the fragment; it never reaches a server.
const fragment = new URLSearchParams(location.hash.slice(1));
const query = new URLSearchParams(location.search);
if (location.hash !== '' || query.has('error')) {
  history.replaceState(null, '', location.pathname);
}

const accessToken = fragment.get('access_token');
const signInFailed = fragment.has('error') || query.has('error');

// First, so that it sees the failures of everything below. Signing in reloads the page, and the
// route only accepts signed-in players.
if (accessToken !== null) reportErrors(accessToken);

const signIn = document.querySelector('#sign-in');
const status = document.querySelector('#status');
const results = document.querySelector('#results');

signIn.addEventListener('click', () => {
  const query = new URLSearchParams({ provider: 'google', redirect_to: `${location.origin}/` });
  location.assign(`${supabaseUrl}/auth/v1/authorize?${query.toString()}`);
});

// A fixed message: the URL is anyone's to craft, so its text is never shown.
if (signInFailed) {
  status.textContent = 'No se pudo entrar. ¿Es la cuenta de Google con la que juegas?';
} else if (accessToken !== null) {
  void runChecks(accessToken);
}

async function runChecks(token) {
  signIn.disabled = true;
  status.textContent = 'Comprobando…';
  results.replaceChildren();
  let passed = 0;
  for (const check of checks) {
    const item = document.createElement('li');
    try {
      const got = await call(check, token);
      const ok = check.expected.includes(got);
      if (ok) passed += 1;
      const hint = check.hints?.[got];
      item.className = ok ? 'ok' : 'fail';
      item.textContent = `${check.label}: ${got}${ok ? '' : ` (esperado ${check.expected.join(' o ')})`}${hint === undefined ? '' : `, ${hint}`}`;
    } catch {
      item.className = 'fail';
      item.textContent = `${check.label}: sin respuesta`;
    }
    results.append(item);
  }
  status.textContent = `${passed} de ${checks.length} comprobaciones correctas.`;
  signIn.disabled = false;
}

async function call(check, token) {
  const headers = {};
  if (check.signed) headers['x-session-token'] = token;
  let body;
  if (check.method === 'POST') {
    body = check.body === undefined ? '' : JSON.stringify(check.body);
    headers['content-type'] = 'application/json';
    // CloudFront's origin access control signs the payload, so it needs its hash up front.
    headers['x-amz-content-sha256'] = await sha256Hex(body);
  }
  const response = await fetch(check.path, {
    method: check.method,
    headers,
    body,
    cache: 'no-store',
    credentials: 'omit',
  });
  return response.status;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// A report has no free text: never the error's message, which can quote a player's text, or the
// page's URL, whose fragment held the token.
function reportErrors(token) {
  let reports = 0;
  const send = (report) => {
    if (report === undefined || reports >= maxErrorReports) return;
    reports += 1;
    // Never retried or shown: nothing a player can do about it, and it must not become an error.
    call(
      {
        method: 'POST',
        path: '/api/client-errors',
        body: { ...report, release },
        signed: true,
      },
      token,
    ).catch(() => undefined);
  };
  window.addEventListener('error', (event) => {
    const script = sameOriginPath(event.filename);
    if (script === undefined) return;
    send({ type: errorType(event.error), script, line: event.lineno, column: event.colno });
  });
  window.addEventListener('unhandledrejection', (event) => {
    send(rejectionReport(event.reason));
  });
}

function rejectionReport(reason) {
  const type = errorType(reason);
  // V8 opens the stack with the message, which must not pass for a frame.
  const frames = reason instanceof Error ? (reason.stack ?? '').replace(reason.message, '') : '';
  const frame = /([a-z-]+:\/\/[^\s()]+):(\d+):(\d+)/.exec(frames);
  // With no stack there is no telling where it came from, and a real failure beats an extra email.
  if (frame === null) return { type };
  const script = sameOriginPath(frame[1]);
  if (script === undefined) return undefined;
  return { type, script, line: Number(frame[2]), column: Number(frame[3]) };
}

// Other origins are browser extensions, and an empty filename is an error the browser hides from us.
function sameOriginPath(url) {
  try {
    const { origin, pathname } = new URL(url);
    return origin === location.origin ? pathname : undefined;
  } catch {
    return undefined;
  }
}

function errorType(error) {
  if (reportedErrorTypes.has(error?.name)) return error.name;
  return error instanceof DOMException ? 'DOMException' : 'other';
}
