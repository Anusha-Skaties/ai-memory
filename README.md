# Groundwork AI: website + booking backend

Marketing site and booking form for a hands-on AI setup service aimed at project managers and leaders in
mechanical, electrical, aviation and marine. Built to run on **Google Cloud Run**, with bookings stored in
**Firestore** (free tier).

## What's inside

```
public/            Static site (no build step)
  index.html       Home: hero, About us (click-to-play session animation), Services (live pipeline), Security, How to book
  book.html        Booking form: name, role, company, industry, email, phone, date/time/time zone, details
  styles.css       Theme ("engineering drawing": drafting paper, navy ink, safety orange)
  main.js          Nav, scroll reveals, animation controls
  book.js          Form validation + submit to /api/bookings
src/
  server.js        Entry point, graceful shutdown on SIGTERM
  app.js           Express app: security headers/CSP, rate limiting, API, static files
  validation.js    Server-side validation (zod)
  db.js            Storage: Firestore in production, in-memory for local dev
  notify.js        After a booking: append to Google Sheet + email you (both optional)
  stats.js         Anonymous visit/click stats helpers (no cookies, no IPs stored)
  admin/           Private stats page served at /admin (password protected)
test/              API, stats and notification tests (node:test)
Dockerfile         Production image (Node 22 alpine, non-root)
deploy.ps1         One-command Cloud Run + Firestore deploy
```

### Production features
- Strict Content-Security-Policy, HSTS and other headers (helmet). No inline scripts.
- Rate limiting on bookings (5 per 15 min per IP), 16 KB body limit, honeypot spam trap.
- Validation runs in the browser and again on the server.
- Structured JSON logs that show up properly in Cloud Logging.
- `/healthz` (liveness) and `/readyz` (checks Firestore) endpoints.
- Accessible: skip link, labelled fields, keyboard focus styles, `prefers-reduced-motion` support.

## Run locally

```bash
npm install
npm start          # http://localhost:8080 (data kept in memory)
npm test
```

To try the stats page locally, copy `.env.example` to `.env`, set `ADMIN_PASSWORD`, run `npm run dev`
and open http://localhost:8080/admin to log in.

## Where the data goes (all free tiers)

| What | Where | How you see it |
|---|---|---|
| Booking details | Firestore `bookings` collection (source of truth) | `/admin` page, or Cloud Console → Firestore |
| Copy of each booking | Google Sheet (optional) | Open the sheet |
| New-booking alert | Email to you (optional) | Your inbox; *Reply* goes straight to the visitor |
| Anonymous visits & clicks | Firestore `stats_daily` (one doc per day) | `/admin` page |

**Visitor stats are anonymous.** No cookies and no IP addresses are stored. A visitor is counted once per
day using a salted one-way hash that changes daily, and those markers are auto-deleted after 2 days.
Bots, Do Not Track and Global Privacy Control are skipped. That's why the site needs no cookie banner.
Mention this in your privacy policy.

### Set up the Google Sheet (optional)
1. Create a Google Sheet and name the first tab **Bookings**.
2. Put these headers in row 1: `Received (UTC) | Reference | Name | Role | Company | Industry | Email | Phone |
   Preferred date | Preferred time | Time zone | Other availability | Details`
3. **Share** the sheet with the service account `groundwork-site-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com`
   as **Editor**. It's created by the first deploy, so you can share after that and redeploy.
4. Copy the sheet ID from its URL (`docs.google.com/spreadsheets/d/<SHEET_ID>/edit`).

### Set up email alerts (optional)
Any SMTP account works. With Gmail: turn on 2-step verification, create an **App password**
(Google Account → Security → App passwords) and use `smtp.gmail.com`, port `587`, your Gmail address and
that app password. Free alternatives with SMTP: Brevo (300 emails/day), Resend (3,000/month).

## Deploy to Cloud Run

1. Install the [gcloud CLI](https://cloud.google.com/sdk/docs/install), then run `gcloud auth login`.
2. Create a Google Cloud project and link a billing account. Cloud Run needs billing enabled, but a
   low-traffic site like this normally stays inside the free tiers.
3. From this folder, in PowerShell:

```powershell
.\deploy.ps1 -ProjectId YOUR_PROJECT_ID -AdminPassword "a-long-password" `
  -SheetId YOUR_SHEET_ID -NotifyTo you@gmail.com `
  -SmtpHost smtp.gmail.com -SmtpUser you@gmail.com -SmtpPassword "your-gmail-app-password"
```

Leave out the Sheet or email parameters if you don't want them. Later deploys only need
`.\deploy.ps1 -ProjectId YOUR_PROJECT_ID`; earlier settings and passwords are kept.

The script:
- enables the APIs it needs
- creates the Firestore `(default)` database (the free tier only applies to that one)
- turns on auto-delete for the daily visitor markers
- creates a least-privilege service account (`roles/datastore.user`)
- stores the passwords in Secret Manager, so they're never in the code
- builds and deploys with Cloud Build (you don't need Docker installed locally)

### Viewing bookings and stats
Open `https://YOUR-SITE/admin` and log in with your admin password (you stay logged in for 12 hours; use *Log out* on shared computers). It shows visits per day, unique
visitors, bookings, which buttons people click, where visitors came from, devices, and the latest 25
bookings. The raw data is also in Cloud Console → **Firestore**.

### Custom domain
Cloud Run → your service → **Manage custom domains**, or put it behind a global HTTPS load balancer.

## Before going live: replace placeholders
- Brand name **Groundwork AI** (HTML titles, header, footer).
- `hello@example.com` in `index.html` and `book.html`.
- Add a privacy policy page. You collect names, emails and phone numbers.
