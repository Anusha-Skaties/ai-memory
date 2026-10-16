(() => {
  const form = document.getElementById('booking-form');
  if (!form) return;

  const card = document.getElementById('form-card');
  const statusEl = document.getElementById('form-status');
  const submitBtn = document.getElementById('submit-btn');
  const dateInput = document.getElementById('preferredDate');
  const tzInput = document.getElementById('timezone');
  const details = document.getElementById('details');
  const detailsCount = document.getElementById('details-count');

  // Date limits: today through 12 months ahead (local time)
  const toISODate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date();
  const maxDate = new Date(today);
  maxDate.setFullYear(maxDate.getFullYear() + 1);
  dateInput.min = toISODate(today);
  dateInput.max = toISODate(maxDate);

  // Time zone: taken from the visitor's device and shown as a note, e.g.
  // "Times are in your local time zone: Pacific Daylight Time (America/Los_Angeles)."
  let tzId = 'UTC';
  try {
    tzId = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    /* very old browsers fall back to UTC */
  }
  tzInput.value = tzId;
  const tzName = (() => {
    try {
      const part = new Intl.DateTimeFormat(undefined, { timeZoneName: 'long' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName');
      return part ? part.value : '';
    } catch {
      return '';
    }
  })();
  document.getElementById('tz-note').textContent =
    `Times are in your local time zone: ${tzName ? `${tzName} (${tzId})` : tzId}.`;

  details.addEventListener('input', () => {
    detailsCount.textContent = String(details.value.length);
  });

  const messages = {
    name: 'Please enter your name.',
    role: 'Please tell us your role.',
    industry: 'Please choose an industry.',
    email: 'Please enter a valid email address.',
    phone: 'Please enter a valid phone number.',
    preferredDate: 'Please pick a date from today onwards.',
    preferredTime: 'Please pick a time.',
    details: 'Please add a few words (at least 10 characters).',
    consent: 'Please agree so we can contact you.',
  };
  const phonePattern = /^\+?[0-9 ()\-.]{7,20}$/;

  function setError(name, msg) {
    const err = form.querySelector(`.err[data-for="${name}"]`);
    const field = err && err.closest('.field');
    if (err) err.textContent = msg || '';
    if (field) field.classList.toggle('has-error', Boolean(msg));
    const input = form.elements[name];
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function clearErrors() {
    form.querySelectorAll('.err').forEach((el) => (el.textContent = ''));
    form.querySelectorAll('.has-error').forEach((el) => el.classList.remove('has-error'));
    statusEl.textContent = '';
  }

  function validate() {
    const errors = {};
    for (const name of Object.keys(messages)) {
      const el = form.elements[name];
      if (!el) continue;
      if (el.type === 'checkbox' ? !el.checked : !el.checkValidity()) errors[name] = messages[name];
    }
    if (!errors.phone && !phonePattern.test(form.elements.phone.value.trim())) errors.phone = messages.phone;
    if (!errors.details && form.elements.details.value.trim().length < 10) errors.details = messages.details;
    return errors;
  }

  // Clear a field's error as soon as the user fixes it
  form.addEventListener('input', (e) => {
    if (e.target.name) setError(e.target.name, '');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const errors = validate();
    const names = Object.keys(errors);
    if (names.length) {
      names.forEach((n) => setError(n, errors[n]));
      form.elements[names[0]].focus();
      statusEl.textContent = 'Please check the highlighted fields.';
      return;
    }

    const data = Object.fromEntries(new FormData(form).entries());
    data.consent = form.elements.consent.checked;

    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');
    submitBtn.querySelector('.label').textContent = 'Sending…';

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok && body.ok) {
        showSuccess(data, body.id);
        return;
      }
      if (body.errors) {
        Object.entries(body.errors).forEach(([n, m]) => setError(n, m));
      }
      statusEl.textContent = body.message || 'Something went wrong. Please try again.';
    } catch {
      statusEl.textContent = 'Network error. Check your connection and try again.';
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('is-loading');
      submitBtn.querySelector('.label').textContent = 'Request my call';
    }
  });

  function showSuccess(data, id) {
    const when = new Date(`${data.preferredDate}T${data.preferredTime}`);
    const nice = Number.isNaN(when.getTime())
      ? `${data.preferredDate} ${data.preferredTime}`
      : when.toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

    const wrap = document.createElement('div');
    wrap.className = 'success';
    wrap.setAttribute('tabindex', '-1');
    wrap.innerHTML = `
      <span class="stamp"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L19 7"/></svg></span>
      <h2>Thanks, <span data-k="name"></span>. You're booked in.</h2>
      <p>We've received your request for <strong data-k="when"></strong> (<span data-k="tz"></span>). A member of our team will confirm by email or phone, usually within one business day.</p>
      <span class="ref mono">Ref: <span data-k="id"></span></span>
      <div><a class="btn btn--ghost" href="/">Back to home</a></div>`;
    // Insert user-provided values as text, never as HTML
    wrap.querySelector('[data-k="name"]').textContent = data.name.split(' ')[0];
    wrap.querySelector('[data-k="when"]').textContent = nice;
    wrap.querySelector('[data-k="tz"]').textContent = data.timezone;
    wrap.querySelector('[data-k="id"]').textContent = String(id).slice(0, 12).toUpperCase();

    card.replaceChildren(wrap);
    wrap.focus();
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
})();
