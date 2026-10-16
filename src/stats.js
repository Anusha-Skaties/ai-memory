import { createHash } from 'node:crypto';

// Only these values are accepted, so the stats can't be filled with junk.
export const PAGES = ['/', '/book'];
export const CLICK_LABELS = [
  'nav-book',
  'hero-book',
  'hero-services',
  'service-tell-us',
  'cta-book',
  'email',
  'video-play',
  'video-replay',
  'example-next',
];

const BOT_UA = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|httpclient/i;

/** True if this request should not be counted (bots, Do Not Track, Global Privacy Control). */
export function shouldSkip(req) {
  const ua = String(req.get('user-agent') || '');
  return !ua || BOT_UA.test(ua) || req.get('dnt') === '1' || req.get('sec-gpc') === '1';
}

export function deviceOf(ua) {
  return /Mobi|Android|iPhone|iPod/i.test(ua) ? 'mobile' : /iPad|Tablet/i.test(ua) ? 'tablet' : 'desktop';
}

/** Hostname of the referring site, "direct" if none, "other" if it looks odd. */
export function referrerHost(ref, ownHost) {
  if (!ref) return 'direct';
  try {
    const host = new URL(ref).hostname.replace(/^www\./, '').toLowerCase();
    if (!host || host === ownHost) return 'direct';
    return /^[a-z0-9.-]{1,60}$/.test(host) ? host : 'other';
  } catch {
    return 'other';
  }
}

/**
 * Anonymous daily visitor id: hash(salt, date, ip, user agent). It changes every day,
 * can't be reversed to an IP, and nothing is stored in the visitor's browser.
 */
export function visitorId(salt, date, ip, ua) {
  return createHash('sha256').update(`${salt}|${date}|${ip}|${ua}`).digest('hex').slice(0, 32);
}

/** Validate a raw event from the browser. Returns a clean event or null. */
export function parseEvent(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.type === 'pageview' && PAGES.includes(body.page)) {
    return { type: 'pageview', page: body.page, ref: typeof body.ref === 'string' ? body.ref.slice(0, 300) : '' };
  }
  if (body.type === 'click' && CLICK_LABELS.includes(body.label)) {
    return { type: 'click', label: body.label };
  }
  return null;
}

/** Roll daily docs up into totals for the admin dashboard. */
export function summarize(daysData) {
  const sum = (key) => daysData.reduce((n, d) => n + (d[key] || 0), 0);
  const merge = (key) => {
    const out = {};
    for (const d of daysData) for (const [k, v] of Object.entries(d[key] || {})) out[k] = (out[k] || 0) + v;
    return Object.entries(out)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  };
  return {
    totals: { views: sum('views'), uniques: sum('uniques'), bookings: sum('bookings') },
    daily: daysData.map((d) => ({ date: d.date, views: d.views, uniques: d.uniques, bookings: d.bookings })),
    pages: merge('pages'),
    clicks: merge('clicks'),
    referrers: merge('referrers'),
    devices: merge('devices'),
  };
}
