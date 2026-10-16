(() => {
  // Mobile navigation
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', (e) => {
      if (e.target.closest('a')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Reveal sections as they scroll into view
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }

  // "How a session works" video player. The scenes are CSS animations; this drives
  // them like a video: play/pause, progress, chapters, looping and autoplay on view.
  const demo = document.getElementById('demo');
  if (demo) {
    const DURATION = 10;
    const chapters = [0, 2, 4, 6.6];
    const subtitles = [
      'We start with a friendly video call about your week.',
      'You approve a secure, encrypted remote session.',
      'We set up your AI tools and connect your apps while you watch.',
      'Every Monday at 7:00 your report now runs by itself.',
    ];
    const stage = demo.querySelector('.scene-wrap');
    const toggleBtn = document.getElementById('demo-toggle');
    const restartBtn = document.getElementById('demo-restart');
    const fill = document.getElementById('demo-fill');
    const timeEl = document.getElementById('demo-time');
    const subtitle = document.getElementById('demo-subtitle');
    const steps = [...document.querySelectorAll('#demo-steps li')];
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let elapsed = 0;
    let startedAt = 0;
    let running = false;
    let userPaused = false;
    let raf = 0;

    const fmt = (s) => `0:${String(Math.floor(s)).padStart(2, '0')}`;

    // Restart all scene animations, optionally jumping to time t (seconds).
    const restartAt = (t) => {
      demo.classList.remove('is-playing');
      void demo.offsetWidth;
      demo.classList.add('is-playing', 'is-started');
      if (t > 0 && demo.getAnimations) {
        for (const anim of demo.getAnimations({ subtree: true })) {
          try {
            anim.currentTime = t * 1000;
          } catch {
            /* ignore animations that can't seek */
          }
        }
      }
      elapsed = t;
      startedAt = performance.now() - t * 1000;
    };

    const render = () => {
      fill.style.setProperty('--progress', String(Math.min(elapsed / DURATION, 1)));
      timeEl.textContent = `${fmt(elapsed)} / ${fmt(DURATION)}`;
      let current = 0;
      steps.forEach((li, i) => {
        const start = chapters[i];
        const end = chapters[i + 1] ?? DURATION;
        const p = Math.max(0, Math.min((elapsed - start) / (end - start), 1));
        li.style.setProperty('--p', String(p));
        li.classList.toggle('is-active', elapsed >= start && elapsed < end);
        li.classList.toggle('is-done', elapsed >= end);
        if (elapsed >= start) current = i;
      });
      if (subtitle.textContent !== subtitles[current]) subtitle.textContent = subtitles[current];
      subtitle.classList.toggle('is-on', demo.classList.contains('is-started'));
      toggleBtn.setAttribute('aria-label', running ? 'Pause' : 'Play');
    };

    const tick = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!running) return;
        elapsed = (performance.now() - startedAt) / 1000;
        if (elapsed >= DURATION) restartAt(0); // loop
        render();
        tick();
      });
    };

    const play = () => {
      if (!demo.classList.contains('is-playing')) restartAt(0);
      demo.classList.remove('is-paused');
      startedAt = performance.now() - elapsed * 1000;
      running = true;
      tick();
      render();
    };

    const pause = () => {
      running = false;
      cancelAnimationFrame(raf);
      demo.classList.add('is-paused');
      render();
    };

    stage.addEventListener('click', () => {
      if (running) {
        userPaused = true;
        pause();
      } else {
        userPaused = false;
        play();
      }
    });
    toggleBtn.addEventListener('click', () => stage.click());
    const replay = () => {
      userPaused = false;
      restartAt(0);
      play();
    };
    restartBtn.addEventListener('click', replay);
    document.getElementById('replay').addEventListener('click', replay);
    steps.forEach((li, i) => {
      li.querySelector('button').addEventListener('click', () => {
        userPaused = false;
        restartAt(chapters[i]);
        play();
      });
    });

    // Autoplay while on screen (unless the visitor paused it or prefers less motion).
    if ('IntersectionObserver' in window && !reduceMotion) {
      new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && !running && !userPaused) play();
          else if (!entry.isIntersecting && running) pause();
        },
        { threshold: 0.5 },
      ).observe(demo);
    }
    render();
  }

  // Example automations panel: click to rotate through examples.
  // Each step is [title, detail]; icons stay the same (trigger, source, AI, output, done).
  const pipeline = document.getElementById('pipeline');
  const pipe = document.getElementById('pipe');
  if (pipeline && pipe) {
    const examples = [
      {
        title: 'Daily site report',
        steps: [
          ['Every day, 5:00 PM', 'Scheduled trigger'],
          ['Collects site notes & updates', 'Email, SharePoint, Excel'],
          ['AI writes the daily report', 'In your company format'],
          ['Updates the project tracker', 'Excel on SharePoint'],
          ['Ready for your review', 'You approve & send'],
        ],
        foot: 'Time saved: about <b>45 minutes</b> every day. You still have the final say.',
      },
      {
        title: 'Job search assistant',
        steps: [
          ['Every morning, 7:00 AM', 'Scheduled trigger'],
          ['Scans job boards & LinkedIn', 'Your saved searches'],
          ['AI ranks roles by fit', 'Matched to your CV'],
          ['Drafts tailored cover notes', 'Your template & tone'],
          ['Shortlist in your inbox', 'You choose & apply'],
        ],
        foot: 'Time saved: about <b>5 hours</b> of searching every week.',
      },
      {
        title: 'AI news briefing',
        steps: [
          ['Every weekday, 8:00 AM', 'Scheduled trigger'],
          ['Reads 40+ trusted sources', 'Blogs, papers, release notes'],
          ['AI picks what matters to you', 'Your industry & tools'],
          ['Writes a 2-minute brief', 'Plain English, with links'],
          ['Delivered to your inbox', 'Outlook or Gmail'],
        ],
        foot: 'Stay current in <b>2 minutes</b> a day instead of an hour.',
      },
      {
        title: 'Slack & email catch-up',
        steps: [
          ['Every 2 hours', 'During your work day'],
          ['Reads Slack, Teams & email', 'Connected securely'],
          ['AI spots requests & deadlines', 'Ranked by urgency'],
          ['Drafts replies for you', 'Nothing sent without your OK'],
          ['One summary of what needs you', 'Pinned to your inbox'],
        ],
        foot: 'Never miss the <b>one message</b> that matters.',
      },
      {
        title: 'LinkedIn & X updates',
        steps: [
          ['Every Tuesday & Thursday', 'Scheduled trigger'],
          ['Picks topics from your work', 'Projects, wins, industry news'],
          ['AI drafts posts in your voice', 'With images & hashtags'],
          ['Queues them on LinkedIn & X', 'Waiting for your approval'],
          ['Weekly engagement summary', 'Likes, comments, new followers'],
        ],
        foot: 'A steady online presence in about <b>15 minutes</b> a week.',
      },
      {
        title: 'Monday project digest',
        steps: [
          ['Monday, 7:00 AM', 'Scheduled trigger'],
          ["Reads last week's emails", 'Outlook connector'],
          ['AI drafts the digest', 'Your "status report" skill'],
          ['Updates the tracker', 'Excel on SharePoint'],
          ['Ready for your review', 'You approve & send'],
        ],
        foot: 'Time saved: about <b>3 hours</b> every week. You still have the final say.',
      },
    ];

    const titleEl = document.getElementById('pipe-title');
    const footEl = document.getElementById('pipe-foot');
    const countEl = document.getElementById('pipe-count');
    const nodes = [...pipe.querySelectorAll('.node')];
    let index = 0;

    // Pulse travels the exact height of the node list
    const setTravel = () => {
      if (nodes.length < 2) return;
      const first = nodes[0].getBoundingClientRect();
      const last = nodes[nodes.length - 1].getBoundingClientRect();
      pipe.style.setProperty('--travel', `${last.top - first.top}px`);
    };

    const show = (i) => {
      const ex = examples[i];
      titleEl.textContent = ex.title;
      nodes.forEach((node, n) => {
        node.querySelector('strong').textContent = ex.steps[n][0];
        node.querySelector('div > span').textContent = ex.steps[n][1];
      });
      footEl.innerHTML = ex.foot; // static strings defined above
      countEl.textContent = `${i + 1} / ${examples.length} · Click for next →`;
      setTravel();
    };

    const next = () => {
      index = (index + 1) % examples.length;
      show(index);
    };
    pipeline.addEventListener('click', next);
    pipeline.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    });

    show(0);
    window.addEventListener('resize', setTravel);
  }

  // Anonymous, cookieless stats: one page view per load, plus clicks on [data-track] elements.
  const track = (data) => {
    const body = JSON.stringify(data);
    if (!(navigator.sendBeacon && navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' })))) {
      fetch('/api/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  };
  if (location.protocol.startsWith('http')) {
    const page = /\/book(\.html)?$/.test(location.pathname) ? '/book' : '/';
    track({ type: 'pageview', page, ref: document.referrer });
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-track]');
      if (el) track({ type: 'click', label: el.dataset.track });
    });
  }

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
