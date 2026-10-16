import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createStore } from '../src/db.js';

let server, base, store;
const notified = [];
const notifier = { channels: ['fake'], notifyBooking: async (booking, id) => notified.push({ booking, id }) };
const env = { ADMIN_PASSWORD: 'test-pass', STATS_SALT: 'salt' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0';

before(async () => {
  store = await createStore('memory');
  server = createApp(store, { notifier, env }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const tomorrow = () => {
  const d = new Date(Date.now() + 86400000);
  return d.toISOString().slice(0, 10);
};

const valid = () => ({
  name: 'Jane Engineer',
  role: 'Project Manager',
  company: 'Acme Marine',
  industry: 'Marine',
  email: 'jane@example.com',
  phone: '+1 555 123 4567',
  preferredDate: tomorrow(),
  preferredTime: '10:30',
  timezone: 'America/New_York',
  details: 'I need help automating my weekly status report.',
  consent: true,
  website: '',
});

const post = (body) =>
  fetch(`${base}/api/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('health check', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
});

test('serves home page with security headers', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await res.text(), /Groundwork/);
});

test('serves /book without extension', async () => {
  const res = await fetch(`${base}/book`);
  assert.equal(res.status, 200);
});

test('accepts a valid booking and stores it', async () => {
  const res = await post(valid());
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.id);
  const row = store.rows.find((r) => r.id === body.id);
  assert.equal(row.email, 'jane@example.com');
  assert.equal(notified.at(-1).id, body.id, 'sheet/email notifier is called with the saved booking');
  assert.equal(row.website, undefined);
});

test('rejects invalid fields with per-field errors', async () => {
  const res = await post({ ...valid(), email: 'nope', phone: 'abc', preferredDate: '2000-01-01', consent: false });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.errors.email && body.errors.phone && body.errors.preferredDate && body.errors.consent);
});

test('honeypot submissions are dropped silently', async () => {
  const before = store.rows.length;
  const res = await post({ ...valid(), website: 'http://spam' });
  assert.equal(res.status, 201);
  assert.equal(store.rows.length, before);
});

test('malformed JSON returns 400', async () => {
  const res = await fetch(`${base}/api/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(res.status, 400);
});

test('unknown route returns 404', async () => {
  const res = await fetch(`${base}/does-not-exist`);
  assert.equal(res.status, 404);
});

const event = (body, headers = {}) =>
  fetch(`${base}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA, ...headers }, body: JSON.stringify(body) });
const login = async (password) => {
  const res = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }),
    redirect: 'manual',
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { res, cookie };
};
const auth = async (pass) => ({ Cookie: (await login(pass)).cookie });

test('records anonymous page views, unique visitors and clicks', async () => {
  assert.equal((await event({ type: 'pageview', page: '/', ref: 'https://www.linkedin.com/feed' })).status, 204);
  await event({ type: 'pageview', page: '/book', ref: '' });
  await event({ type: 'click', label: 'hero-book' });
  // Ignored: unknown page/label, bots, Do Not Track
  await event({ type: 'pageview', page: '/evil' });
  await event({ type: 'click', label: 'whatever' });
  await event({ type: 'pageview', page: '/' }, { 'User-Agent': 'Googlebot/2.1' });
  await event({ type: 'pageview', page: '/' }, { DNT: '1' });

  const res = await fetch(`${base}/api/admin/stats?days=7`, { headers: await auth('test-pass') });
  assert.equal(res.status, 200);
  const stats = await res.json();
  assert.equal(stats.totals.views, 2);
  assert.equal(stats.totals.uniques, 1, 'same visitor twice in a day counts once');
  assert.deepEqual(stats.clicks, [{ name: 'hero-book', count: 1 }]);
  assert.ok(stats.referrers.some((r) => r.name === 'linkedin.com'));
  assert.ok(stats.referrers.some((r) => r.name === 'direct'));
  assert.ok(stats.totals.bookings >= 1);
  assert.ok(stats.bookings.length >= 1);
  assert.equal(stats.daily.length, 7);
});

test('admin area requires logging in', async () => {
  // Not logged in: pages redirect to the login form, the API answers 401.
  const page = await fetch(`${base}/admin/`, { redirect: 'manual' });
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('location'), '/admin/login');
  assert.equal((await fetch(`${base}/api/admin/stats`)).status, 401);
  assert.equal((await fetch(`${base}/admin/login`)).status, 200);

  // Wrong password: back to the form with an error, no cookie.
  const bad = await login('wrong');
  assert.equal(bad.res.headers.get('location'), '/admin/login?error=wrong');
  assert.equal(bad.cookie, '');

  // Right password: HttpOnly cookie, then the dashboard loads.
  const good = await login('test-pass');
  assert.equal(good.res.headers.get('location'), '/admin/');
  assert.match(good.res.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const ok = await fetch(`${base}/admin/`, { headers: { Cookie: good.cookie } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.match(await ok.text(), /Site stats/);

  // Tampered cookie is rejected.
  const forged = good.cookie.replace(/\.[^.]+$/, '.forged');
  assert.equal((await fetch(`${base}/api/admin/stats`, { headers: { Cookie: forged } })).status, 401);
});

test('admin area is disabled when no password is configured', async () => {
  const s2 = createApp(await createStore('memory'), { notifier, env: {} }).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${s2.address().port}/admin/`);
    assert.equal(res.status, 404);
  } finally {
    s2.closeAllConnections();
    s2.close();
  }
});
