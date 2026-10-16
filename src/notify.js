import { log } from './log.js';

/**
 * After a booking is saved: append it to a Google Sheet and email the owner.
 * Each channel is optional and only runs when its env vars are set:
 *   Sheet: SHEET_ID (share the sheet with the Cloud Run service account as Editor), SHEET_TAB (default "Bookings")
 *   Email: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, NOTIFY_TO, NOTIFY_FROM (optional)
 * Failures are logged and never block the booking itself.
 */
export const SHEET_COLUMNS = [
  'Received (UTC)',
  'Reference',
  'Name',
  'Role',
  'Company',
  'Industry',
  'Email',
  'Phone',
  'Preferred date',
  'Preferred time',
  'Time zone',
  'Other availability',
  'Details',
];

const TIMEOUT_MS = 8000;

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function bookingRow(booking, id, receivedAt = new Date()) {
  return [
    receivedAt.toISOString().replace('T', ' ').slice(0, 19),
    id,
    booking.name,
    booking.role,
    booking.company,
    booking.industry,
    booking.email,
    booking.phone,
    booking.preferredDate,
    booking.preferredTime,
    booking.timezone,
    booking.alternateAvailability,
    booking.details,
  ].map((v) => String(v ?? ''));
}

function createSheetChannel(env) {
  if (!env.SHEET_ID) return null;
  const tab = env.SHEET_TAB || 'Bookings';
  let clientPromise;
  const getClient = () => {
    clientPromise ??= import('google-auth-library').then(({ GoogleAuth }) =>
      new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] }).getClient(),
    );
    return clientPromise;
  };
  return async (booking, id) => {
    const client = await getClient();
    const range = encodeURIComponent(`${tab}!A1`);
    // RAW: Sheets stores values as plain text and never evaluates them as formulas.
    await client.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      method: 'POST',
      data: { values: [bookingRow(booking, id)] },
    });
  };
}

function createEmailChannel(env) {
  if (!env.SMTP_HOST || !env.NOTIFY_TO) return null;
  let transportPromise;
  const getTransport = () => {
    transportPromise ??= import('nodemailer').then(({ default: nodemailer }) =>
      nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT) || 587,
        secure: Number(env.SMTP_PORT) === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      }),
    );
    return transportPromise;
  };
  return async (booking, id) => {
    const transport = await getTransport();
    const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
    const lines = SHEET_COLUMNS.slice(1).map((label, i) => `${label}: ${bookingRow(booking, id)[i + 1] || '-'}`);
    await transport.sendMail({
      from: env.NOTIFY_FROM || env.SMTP_USER,
      to: env.NOTIFY_TO,
      replyTo: booking.email,
      subject: oneLine(`New booking: ${booking.name} (${booking.role}) for ${booking.preferredDate} ${booking.preferredTime}`).slice(0, 180),
      text: `A new call was requested on your website.\n\n${lines.join('\n')}\n\nReply to this email to answer ${oneLine(booking.name)} directly.`,
    });
  };
}

export function createNotifier(env = process.env) {
  const channels = [
    ['sheet', createSheetChannel(env)],
    ['email', createEmailChannel(env)],
  ].filter(([, fn]) => fn);

  if (channels.length) log.info('Booking notifications enabled', { channels: channels.map(([n]) => n) });

  return {
    channels: channels.map(([n]) => n),
    async notifyBooking(booking, id) {
      const results = await Promise.allSettled(channels.map(([name, fn]) => withTimeout(fn(booking, id), name)));
      results.forEach((r, i) => {
        if (r.status === 'rejected') log.error('Booking notification failed', { channel: channels[i][0], bookingId: id, error: r.reason?.message });
      });
    },
  };
}
