import assert from 'node:assert/strict';

const base = new URL(process.argv[2] || 'http://127.0.0.1:5088');
const password = process.env.DEMO_PASSWORD || 'NexoDemo-2026!';
let cookie = '';

async function request(path, { method = 'GET', body, status = 200, authenticated = true } = {}) {
  const headers = {};
  if (authenticated && cookie) headers.cookie = cookie;
  if (method !== 'GET') headers['X-Nexo-Request'] = '1';
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(path, base), {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8_000),
  });
  assert.equal(response.status, status, method + ' ' + path);
  return response;
}

const health = await (await request('/api/health')).json();
assert.equal(health.database, 'PostgreSQL');
await request('/api/clientes', { status: 401 });
const response = await request('/api/auth/login', {
  method: 'POST', body: { email: 'admin@nexo.test', password },
});
cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
assert.ok(cookie.startsWith('NexoCrm.Session='));
const profile = await response.json();
assert.equal(profile.role, 'Administrador');
assert.equal(profile.modules.length, 5);

const collections = await Promise.all(
  ['clientes', 'marketing', 'cotizaciones', 'ventas'].map(async name => {
    if (!profile.modules.some(module => module.key === name && module.enabled)) return;
    const rows = await (await request('/api/' + name)).json();
    assert.ok(Array.isArray(rows), name);
    return rows;
  })
);
assert.equal(collections.length, 4);
if (profile.modules.some(module => module.key === 'estadisticas' && module.enabled)) {
  const statistics = await (await request('/api/estadisticas')).json();
  assert.ok(Array.isArray(statistics.months));
  assert.ok(Number.isFinite(statistics.revenue));
}
await request('/api/auth/logout', { method: 'POST', status: 204 });

const view = await (await request('/cotizaciones', { authenticated: false })).text();
assert.match(view, /<crm-root/);
assert.match(view, /rel="manifest"/);
const manifestResponse = await request('/manifest.webmanifest', { authenticated: false });
assert.match(manifestResponse.headers.get('content-type'), /application\/manifest\+json/);
const manifest = await manifestResponse.json();
assert.equal(manifest.display, 'standalone');
for (const icon of manifest.icons) {
  const image = await request(icon.src, { authenticated: false });
  assert.equal(image.headers.get('content-type'), 'image/png');
}
const offline = await (await request('/sin-conexion.html', { authenticated: false })).text();
assert.match(offline, /<h1>Sin conexión<\/h1>/);
await request('/sw.js', { authenticated: false });
console.log('Verificados PostgreSQL, autenticación, API, rutas web y recursos de instalación móvil.');
