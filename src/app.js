import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { bookingSchema, formatErrors } from './validation.js';
import { log } from './log.js';
import { today } from './db.js';
import { createNotifier } from './notify.js';
import { checkPassword, COOKIE, createSessionValue, isValidSession, readCookie, sessionCookie } from './session.js';
import { deviceOf, parseEvent, referrerHost, shouldSkip, summarize, visitorId } from './stats.js';

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(srcDir, '..', 'public');
const adminDir = path.join(srcDir, 'admin');
const loginDir = path.join(srcDir, 'admin-login');

export function createApp(store, { notifier = createNotifier(), env = process.env } = {}) {
  const app = express();

  const statsSalt = env.STATS_SALT || randomBytes(16).toString('hex');
  if (!env.STATS_SALT) log.warn('STATS_SALT not set; unique-visitor counts reset when the server restarts.');

  // Cloud Run sits behind one Google front-end proxy; needed for correct client IPs in rate limiting.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          upgradeInsecureRequests: [],
        },
      },
      strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(compression());

  app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));
  app.get('/readyz', async (_req, res) => {
    try {
      await store.ping();
      res.status(200).json({ ok: true, storage: store.kind });
    } catch (err) {
      log.error('Readiness check failed', { error: err.message });
      res.status(503).json({ ok: false });
    }
  });

  const bookingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, message: 'Too many requests. Please try again in a few minutes.' },
  });

  app.post('/api/bookings', bookingLimiter, express.json({ limit: '16kb' }), async (req, res) => {
    const body = req.body ?? {};

    // Bots that fill the hidden field get a fake success and nothing is stored.
    if (typeof body.website === 'string' && body.website.length > 0) {
      return res.status(201).json({ ok: true, id: 'received' });
    }

    const parsed = bookingSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, message: 'Please check the highlighted fields.', errors: formatErrors(parsed.error) });
    }

    const { website, consent, ...booking } = parsed.data;
    try {
      const id = await store.saveBooking({
        ...booking,
        consentAt: new Date().toISOString(),
        userAgent: String(req.get('user-agent') || '').slice(0, 300),
      });
      log.info('Booking received', { bookingId: id, industry: booking.industry });
      // Sheet + email. Awaited so Cloud Run doesn't pause the CPU mid-send; failures are only logged.
      await notifier.notifyBooking(booking, id);
      return res.status(201).json({ ok: true, id });
    } catch (err) {
      log.error('Failed to save booking', { error: err.message });
      return res.status(500).json({ ok: false, message: 'We could not save your request. Please try again shortly.' });
    }
  });

  // ---- Anonymous visit stats (no cookies, no IPs stored) ----
  const eventLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
  app.post(
    '/api/events',
    eventLimiter,
    express.json({ limit: '2kb', type: ['application/json', 'text/plain'] }),
    // Saved before replying: Cloud Run may pause the CPU once a response is sent.
    // Beacons are fire-and-forget in the browser, so visitors never wait on this.
    async (req, res) => {
      const event = shouldSkip(req) ? null : parseEvent(req.body);
      if (!event) return res.status(204).end();
      try {
        if (event.type === 'pageview') {
          const ua = String(req.get('user-agent') || '');
          await store.recordEvent({
            type: 'pageview',
            page: event.page,
            referrer: referrerHost(event.ref, req.hostname),
            device: deviceOf(ua),
            visitor: visitorId(statsSalt, today(), req.ip, ua),
          });
        } else {
          await store.recordEvent(event);
        }
      } catch (err) {
        log.error('Failed to record event', { error: err.message });
      }
      res.status(204).end();
    },
  );

  // ---- Private admin area: /admin (password from ADMIN_PASSWORD, login page + signed cookie) ----
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true, // only failed logins count toward the limit
    requestWasSuccessful: (_req, res) => !res.locals.loginFailed,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => res.redirect(303, '/admin/login?error=limit'),
  });
  const noIndex = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  };
  const adminEnabled = (_req, res, next) =>
    env.ADMIN_PASSWORD ? next() : res.status(404).sendFile(path.join(publicDir, '404.html'));

  app.get('/admin/login', adminEnabled, noIndex, (_req, res) => res.sendFile(path.join(loginDir, 'login.html')));
  app.get('/admin/login.js', adminEnabled, noIndex, (_req, res) => res.sendFile(path.join(loginDir, 'login.js')));
  app.post(
    '/admin/login',
    adminEnabled,
    loginLimiter,
    express.urlencoded({ extended: false, limit: '2kb' }),
    (req, res) => {
      if (!checkPassword(req.body?.password ?? '', env.ADMIN_PASSWORD)) {
        res.locals.loginFailed = true;
        return res.redirect(303, '/admin/login?error=wrong');
      }
      res.setHeader('Set-Cookie', sessionCookie(createSessionValue(env.ADMIN_PASSWORD), { secure: req.secure }));
      return res.redirect(303, '/admin/');
    },
  );
  app.post('/admin/logout', (req, res) => {
    res.setHeader('Set-Cookie', sessionCookie('', { secure: req.secure, maxAgeMs: 0 }));
    res.redirect(303, '/admin/login');
  });

  const requireAdmin = (req, res, next) => {
    if (isValidSession(readCookie(req, COOKIE), env.ADMIN_PASSWORD)) return noIndex(req, res, next);
    if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ ok: false, message: 'Login required' });
    return res.redirect(303, '/admin/login');
  };

  app.get('/api/admin/stats', adminEnabled, requireAdmin, async (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    try {
      const [daily, bookings] = await Promise.all([store.getStats(days), store.recentBookings(25)]);
      res.json({ ok: true, days, ...summarize(daily), bookings });
    } catch (err) {
      log.error('Failed to load stats', { error: err.message });
      res.status(500).json({ ok: false, message: 'Could not load stats.' });
    }
  });
  app.use('/admin', adminEnabled, requireAdmin, express.static(adminDir));

  app.use('/api', (_req, res) => res.status(404).json({ ok: false, message: 'Not found' }));

  app.use(
    express.static(publicDir, {
      extensions: ['html'],
      maxAge: '1h',
      setHeaders(res, filePath) {
        // Pages, scripts and styles revalidate (ETag) so a new deploy shows up immediately.
        if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  app.use((_req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));

  // Malformed JSON and other unexpected errors.
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      return res.status(400).json({ ok: false, message: 'Invalid request body.' });
    }
    log.error('Unhandled error', { error: err.message });
    res.status(500).json({ ok: false, message: 'Something went wrong.' });
  });

  return app;
}
