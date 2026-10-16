import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookingRow, createNotifier, SHEET_COLUMNS } from '../src/notify.js';

const booking = {
  name: 'Jane', role: 'PM', company: '', industry: 'Marine', email: 'j@example.com', phone: '+1 555 123 4567',
  preferredDate: '2027-01-05', preferredTime: '09:30', timezone: 'Europe/London', alternateAvailability: '', details: '=HYPERLINK("x")',
};

test('sheet row matches the header columns and keeps values as text', () => {
  const row = bookingRow(booking, 'abc', new Date('2026-10-14T10:00:00Z'));
  assert.equal(row.length, SHEET_COLUMNS.length);
  assert.equal(row[0], '2026-10-14 10:00:00');
  assert.equal(row[7], '+1 555 123 4567');
  assert.equal(row[12], '=HYPERLINK("x")'); // stored as plain text via valueInputOption=RAW
});

test('no channels are enabled without configuration', async () => {
  const n = createNotifier({});
  assert.deepEqual(n.channels, []);
  await n.notifyBooking(booking, 'abc'); // no-op, no throw
});

test('channels are enabled by their env vars', () => {
  const n = createNotifier({ SHEET_ID: 'x', SMTP_HOST: 'smtp.example.com', NOTIFY_TO: 'me@example.com' });
  assert.deepEqual(n.channels, ['sheet', 'email']);
});
