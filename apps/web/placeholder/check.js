// Connection check until the real front exists: signs in with Google through Supabase Auth and calls
// both APIs the way the app will (session JWT in X-Session-Token, body hash for CloudFront's OAC).

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
    label: 'Una acción válida llega y se valida',
    method: 'POST',
    path: '/api/actions',
    body: { text: 'Prueba de conexión.' },
    expected: [501],
    signed: true,
  },
  {
    label: 'Una acción de 1001 caracteres se rechaza',
    method: 'POST',
    path: '/api/actions',
    body: { text: 'a'.repeat(1001) },
    expected: [400],
    signed: true,
  },
  {
    label: 'La IA lee sus claves',
    method: 'POST',
    path: '/api/ai/hint',
    expected: [501],
    signed: true,
    hints: { 503: 'faltan claves de los proveedores en SSM' },
  },
];

const signIn = document.querySelector('#sign-in');
const status = document.querySelector('#status');
const results = document.querySelector('#results');

signIn.addEventListener('click', () => {
  const query = new URLSearchParams({ provider: 'google', redirect_to: `${location.origin}/` });
  location.assign(`${supabaseUrl}/auth/v1/authorize?${query.toString()}`);
});

// Supabase Auth returns the session (or the error) in the fragment; it never reaches a server.
const fragment = new URLSearchParams(location.hash.slice(1));
const query = new URLSearchParams(location.search);
if (location.hash !== '' || query.has('error')) {
  history.replaceState(null, '', location.pathname);
}

const accessToken = fragment.get('access_token');
const signInFailed = fragment.has('error') || query.has('error');

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
