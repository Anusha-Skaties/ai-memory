import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal signed-cookie session for the single admin user.
 * Cookie value: "<expiresAtMs>.<hmac>". The HMAC key is derived from ADMIN_PASSWORD,
 * so changing the password logs out every existing session.
 */
export const COOKIE = 'admin_session';
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const keyFor = (password) => createHash('sha256').update(`admin-session|${password}`).digest();
const sign = (password, exp) => createHmac('sha256', keyFor(password)).update(String(exp)).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkPassword(given, password) {
  // Compare fixed-length digests so the check takes the same time for any input length.
  const h = (s) => createHash('sha256').update(String(s)).digest();
  return Boolean(password) && timingSafeEqual(h(given), h(password));
}

export function createSessionValue(password, now = Date.now()) {
  const exp = now + TTL_MS;
  return `${exp}.${sign(password, exp)}`;
}

export function isValidSession(value, password, now = Date.now()) {
  if (!value || !password) return false;
  const [exp, mac] = String(value).split('.');
  if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  return safeEqual(mac, sign(password, exp));
}

export function readCookie(req, name) {
  for (const part of String(req.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

export function sessionCookie(value, { secure, maxAgeMs = TTL_MS }) {
  return [
    `${COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}
