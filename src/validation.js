import { z } from 'zod';

const trimmed = (min, max) => z.string().trim().min(min).max(max);

export const INDUSTRIES = [
  'Mechanical',
  'Electrical',
  'Aviation',
  'Marine',
  'Construction',
  'Energy & Utilities',
  'Manufacturing',
  'Oil & Gas',
  'Other',
];

const DAY = 24 * 60 * 60 * 1000;

function isWithinNextYear(value) {
  const picked = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(picked)) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  // One day of slack either side so "today" is valid in every time zone.
  return picked >= today.getTime() - DAY && picked <= today.getTime() + 366 * DAY;
}

export const bookingSchema = z
  .object({
    name: trimmed(2, 100),
    role: trimmed(2, 100),
    company: z.string().trim().max(120).optional().default(''),
    industry: z.enum(INDUSTRIES),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()\-.]{7,20}$/, 'Enter a valid phone number'),
    preferredDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
      .refine(isWithinNextYear, 'Choose a date within the next 12 months'),
    preferredTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a time'),
    timezone: trimmed(1, 64),
    alternateAvailability: z.string().trim().max(300).optional().default(''),
    details: trimmed(10, 2000),
    consent: z.literal(true, {
      errorMap: () => ({ message: 'Please agree so we can contact you' }),
    }),
    // Honeypot: real users never see or fill this field.
    website: z.string().max(0).optional().default(''),
  });

export function formatErrors(zodError) {
  const errors = {};
  for (const issue of zodError.issues) {
    const key = issue.path[0] ?? 'form';
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}
