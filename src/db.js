import { randomUUID } from 'node:crypto';
import { log } from './log.js';

/**
 * Storage for booking requests and anonymous visit stats.
 *  - "firestore": Google Cloud Firestore (free tier: 1 GiB, 20k writes/day).
 *    On Cloud Run, credentials come from the service account automatically.
 *  - "memory": in-process data, for local development and tests only.
 *
 * Stats are stored as one document per UTC day in `stats_daily`:
 *   { date, views, uniques, bookings, pages: {}, clicks: {}, referrers: {}, devices: {} }
 * Unique visitors are counted with a daily, salted, one-way hash (no IPs or cookies stored);
 * the hash markers live in `stats_visitors` and expire via a Firestore TTL policy.
 */
export function createStore(kind = process.env.STORAGE || 'memory') {
  if (kind === 'firestore') return createFirestoreStore();
  if (kind === 'memory') return createMemoryStore();
  throw new Error(`Unknown STORAGE "${kind}". Use "firestore" or "memory".`);
}

export const today = () => new Date().toISOString().slice(0, 10);

export function lastNDates(days) {
  const out = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) out.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
  return out;
}

// Firestore map keys can't safely hold "." in merges; encode it and decode on read.
const encodeKey = (k) => k.replace(/\./g, '%2E');
const decodeKey = (k) => k.replace(/%2E/g, '.');
const decodeMap = (m = {}) => Object.fromEntries(Object.entries(m).map(([k, v]) => [decodeKey(k), v]));

function emptyDay(date) {
  return { date, views: 0, uniques: 0, bookings: 0, pages: {}, clicks: {}, referrers: {}, devices: {} };
}

async function createFirestoreStore() {
  const { Firestore, FieldValue } = await import('@google-cloud/firestore');
  const db = new Firestore({ ignoreUndefinedProperties: true });
  const bookings = db.collection(process.env.FIRESTORE_COLLECTION || 'bookings');
  const daily = db.collection('stats_daily');
  const visitors = db.collection('stats_visitors');
  const inc = (n = 1) => FieldValue.increment(n);

  return {
    kind: 'firestore',

    async saveBooking(booking) {
      const ref = await bookings.add({ ...booking, status: 'new', createdAt: FieldValue.serverTimestamp() });
      const date = today();
      await daily.doc(date).set({ date, bookings: inc() }, { merge: true });
      return ref.id;
    },

    async recordEvent(event) {
      const date = today();
      const doc = daily.doc(date);
      if (event.type === 'pageview') {
        let unique = false;
        try {
          await visitors.doc(`${date}_${event.visitor}`).create({
            expireAt: new Date(Date.now() + 2 * 86400000),
          });
          unique = true;
        } catch (err) {
          if (err.code !== 6) throw err; // 6 = ALREADY_EXISTS: seen today
        }
        await doc.set(
          {
            date,
            views: inc(),
            ...(unique && { uniques: inc() }),
            pages: { [encodeKey(event.page)]: inc() },
            referrers: { [encodeKey(event.referrer)]: inc() },
            devices: { [event.device]: inc() },
          },
          { merge: true },
        );
      } else if (event.type === 'click') {
        await doc.set({ date, clicks: { [encodeKey(event.label)]: inc() } }, { merge: true });
      }
    },

    async getStats(days) {
      const dates = lastNDates(days);
      const snaps = await db.getAll(...dates.map((d) => daily.doc(d)));
      return snaps.map((s, i) => {
        if (!s.exists) return emptyDay(dates[i]);
        const d = s.data();
        return {
          ...emptyDay(dates[i]),
          views: d.views || 0,
          uniques: d.uniques || 0,
          bookings: d.bookings || 0,
          pages: decodeMap(d.pages),
          clicks: decodeMap(d.clicks),
          referrers: decodeMap(d.referrers),
          devices: decodeMap(d.devices),
        };
      });
    },

    async recentBookings(limit) {
      const snap = await bookings.orderBy('createdAt', 'desc').limit(limit).get();
      return snap.docs.map((doc) => {
        const d = doc.data();
        return { id: doc.id, ...d, createdAt: d.createdAt?.toDate?.().toISOString() ?? null };
      });
    },

    async ping() {
      // Cheap read that proves credentials + database exist.
      await bookings.limit(1).get();
    },
  };
}

function createMemoryStore() {
  const rows = [];
  const days = new Map();
  const seen = new Set();
  const day = (date) => {
    if (!days.has(date)) days.set(date, emptyDay(date));
    return days.get(date);
  };
  const bump = (map, key) => {
    map[key] = (map[key] || 0) + 1;
  };

  log.warn('Using in-memory storage. Data is lost on restart. Set STORAGE=firestore in production.');
  return {
    kind: 'memory',
    rows,

    async saveBooking(booking) {
      const id = randomUUID();
      rows.push({ id, ...booking, status: 'new', createdAt: new Date().toISOString() });
      day(today()).bookings += 1;
      return id;
    },

    async recordEvent(event) {
      const date = today();
      const d = day(date);
      if (event.type === 'pageview') {
        d.views += 1;
        const key = `${date}_${event.visitor}`;
        if (!seen.has(key)) {
          seen.add(key);
          d.uniques += 1;
        }
        bump(d.pages, event.page);
        bump(d.referrers, event.referrer);
        bump(d.devices, event.device);
      } else if (event.type === 'click') {
        bump(d.clicks, event.label);
      }
    },

    async getStats(n) {
      return lastNDates(n).map((date) => structuredClone(days.get(date) || emptyDay(date)));
    },

    async recentBookings(limit) {
      return rows.slice(-limit).reverse();
    },

    async ping() {},
  };
}
