(() => {
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const nf = new Intl.NumberFormat();

  const PAGE_NAMES = { '/': 'Home page', '/book': 'Booking page' };
  const CLICK_NAMES = {
    'nav-book': '“Book a call” (top menu)',
    'hero-book': '“Book a free discovery call” (top of page)',
    'hero-services': '“See what we set up”',
    'service-tell-us': '“Tell us about it” (services)',
    'cta-book': '“Book your call” (bottom of page)',
    email: 'Email link',
    'video-play': 'Video: play button',
    'video-replay': 'Video: replay',
    'example-next': 'Example automations: next',
  };
  const REF_NAMES = { direct: 'Direct / typed the address', other: 'Other' };

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text; // always text, never HTML
    if (className) node.className = className;
    return node;
  }

  function fillRank(id, items, names = {}) {
    const list = $(id);
    list.replaceChildren();
    if (!items.length) {
      list.append(el('li', 'No data yet', 'empty'));
      return;
    }
    for (const { name, count } of items.slice(0, 10)) {
      const li = el('li');
      li.append(el('span', names[name] || name), el('b', nf.format(count)));
      list.append(li);
    }
  }

  const shortDate = (iso) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

  // Single-series bar chart: rounded top ends, 2px gaps, recessive grid, per-bar tooltip.
  function drawChart(daily) {
    const box = $('chart');
    const tip = $('tooltip');
    const W = Math.max(box.clientWidth, 320);
    const H = 240;
    const pad = { top: 10, right: 6, bottom: 24, left: 36 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;
    const max = Math.max(4, ...daily.map((d) => d.views));
    const step = Math.ceil(max / 4);
    const top = step * 4;
    const slot = innerW / daily.length;
    const barW = Math.max(2, slot - 2);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Visits per day over the last ${daily.length} days`);

    const make = (name, attrs, text) => {
      const n = document.createElementNS(ns, name);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text != null) n.textContent = text;
      svg.append(n);
      return n;
    };

    for (let i = 0; i <= 4; i++) {
      const y = pad.top + innerH - (innerH * i) / 4;
      make('line', { class: 'grid-line', x1: pad.left, x2: W - pad.right, y1: y, y2: y });
      make('text', { class: 'axis-label', x: pad.left - 8, y: y + 4, 'text-anchor': 'end' }, nf.format(step * i));
    }

    const labelEvery = Math.ceil(daily.length / 8);
    daily.forEach((d, i) => {
      const x = pad.left + i * slot + 1;
      const h = (d.views / top) * innerH;
      const y = pad.top + innerH - h;
      const hit = make('rect', { class: 'hit', x: pad.left + i * slot, y: pad.top, width: slot, height: innerH });
      let bar = null;
      if (h > 0) {
        const r = Math.min(4, barW / 2, h);
        // Rounded data-end at the top, square at the baseline.
        bar = make('path', {
          class: 'bar',
          d: `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${y + h}Z`,
        });
      }
      if (i % labelEvery === 0) {
        make('text', { class: 'axis-label', x: x + barW / 2, y: H - 6, 'text-anchor': 'middle' }, shortDate(d.date));
      }
      hit.addEventListener('mouseenter', () => {
        bar?.classList.add('is-hover');
        tip.replaceChildren(
          el('strong', shortDate(d.date)),
          el('div', `${nf.format(d.views)} visits · ${nf.format(d.uniques)} unique`),
          el('div', `${nf.format(d.bookings)} booking${d.bookings === 1 ? '' : 's'}`),
        );
        tip.hidden = false;
        const boxRect = box.getBoundingClientRect();
        const panelRect = box.parentElement.getBoundingClientRect();
        const scale = boxRect.width / W;
        tip.style.left = `${boxRect.left - panelRect.left + (x + barW / 2) * scale}px`;
        tip.style.top = `${boxRect.top - panelRect.top + Math.min(y, pad.top + innerH - 4) * scale - 8}px`;
      });
      hit.addEventListener('mouseleave', () => {
        bar?.classList.remove('is-hover');
        tip.hidden = true;
      });
    });

    box.replaceChildren(svg);
  }

  function fillDailyTable(daily) {
    const tbody = $('daily-table').querySelector('tbody');
    tbody.replaceChildren(
      ...daily
        .slice()
        .reverse()
        .map((d) => {
          const tr = el('tr');
          tr.append(el('td', shortDate(d.date)), el('td', nf.format(d.views)), el('td', nf.format(d.uniques)), el('td', nf.format(d.bookings)));
          return tr;
        }),
    );
  }

  function fillBookings(rows) {
    const tbody = $('bookings').querySelector('tbody');
    tbody.replaceChildren();
    if (!rows.length) {
      const tr = el('tr');
      const td = el('td', 'No bookings yet');
      td.colSpan = 9;
      tr.append(td);
      tbody.append(tr);
      return;
    }
    for (const b of rows) {
      const tr = el('tr');
      const received = b.createdAt ? new Date(b.createdAt).toLocaleString() : '–';
      const email = el('td');
      const link = el('a', b.email);
      link.href = `mailto:${b.email}`;
      email.append(link);
      tr.append(
        el('td', received),
        el('td', b.name),
        el('td', b.role),
        el('td', b.company || '–'),
        el('td', b.industry),
        email,
        el('td', b.phone),
        el('td', `${b.preferredDate} ${b.preferredTime} (${b.timezone})`),
        el('td', b.details, 'wrap-text'),
      );
      tbody.append(tr);
    }
  }

  let current = null;
  async function load(days) {
    statusEl.textContent = 'Loading…';
    statusEl.classList.remove('is-error');
    try {
      const res = await fetch(`/api/admin/stats?days=${days}`, { cache: 'no-store' });
      if (res.status === 401) {
        location.href = '/admin/login?error=expired';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      current = data;
      $('k-views').textContent = nf.format(data.totals.views);
      $('k-uniques').textContent = nf.format(data.totals.uniques);
      $('k-bookings').textContent = nf.format(data.totals.bookings);
      $('k-rate').textContent = data.totals.uniques
        ? `${((data.totals.bookings / data.totals.uniques) * 100).toFixed(1)}%`
        : '–';
      drawChart(data.daily);
      fillDailyTable(data.daily);
      fillRank('pages', data.pages, PAGE_NAMES);
      fillRank('clicks', data.clicks, CLICK_NAMES);
      fillRank('referrers', data.referrers, REF_NAMES);
      fillRank('devices', data.devices);
      fillBookings(data.bookings);
      statusEl.textContent = `Last ${days} days · updated ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      statusEl.textContent = `Could not load stats (${err.message}). Refresh to try again.`;
      statusEl.classList.add('is-error');
    }
  }

  document.querySelectorAll('.range button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      load(Number(btn.dataset.days));
    });
  });
  window.addEventListener('resize', () => current && drawChart(current.daily));

  load(30);
})();
