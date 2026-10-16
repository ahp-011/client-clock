// ---------------------------------------------------------------------------
// Reads *who you are currently looking at* on Dribbble and ships it to the
// Client Clock widget. Deliberately selector-free: Dribbble can rename every
// class tomorrow and this keeps working, because it goes by page geometry and
// text shape, not by markup.
//
// It never reads message bodies, and never sends anything but the person's
// name and the short strings from their profile card.
// ---------------------------------------------------------------------------
(() => {
  const POLL_MS = 900;           // safety net only; switching is event-driven
  // When the conversation changes, the new sidebar paints over the next few
  // frames. Re-read on this ladder until the person actually changes, instead
  // of waiting for the next poll.
  const BURST_MS = [0, 50, 120, 220, 350, 520, 750, 1050, 1500];
  // Re-send even when nothing changed, so the widget knows the conversation is
  // still open and keeps itself unfolded.
  const HEARTBEAT_MS = 12000;
  const MAX_CANDIDATES = 24;

  const NOISE = /^(message|messages|inbox|back to inbox|follow|following|hire me|save|share|like|likes|view profile|schedule a meeting|create a new proposal|view proposal|visit help center|pro|team|about|work|shots|collections|boards|settings|sign out|get hired|hire talent|explore|community)$/i;

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && +st.opacity !== 0;
  }

  // Short, leaf-ish texts — the shape a name, a location or a badge has.
  function shortTexts(root, limit) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = clean(n.nodeValue);
      if (!t || t.length > 48 || t.length < 2) continue;
      if (NOISE.test(t)) continue;
      const el = n.parentElement;
      if (!el || !visible(el)) continue;
      if (el.closest('script,style,textarea,input,nav,header[role=banner]')) continue;
      if (out.indexOf(t) === -1) out.push(t);
      if (out.length >= limit) break;
    }
    return out;
  }

  // The conversation heading: the biggest piece of text on the page that reads
  // like a person's name.
  // Status lines Dribbble tucks inside the same heading element.
  const STATUS = /\s*(last active|online|offline|active)\b.*$/i;

  function ownText(el) {
    // Only the heading's own text, not a nested "Last active: 4 hours ago".
    let t = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) t += n.nodeValue;
    }
    t = clean(t);
    return t || clean(el.textContent);
  }

  function headingName() {
    const nodes = [...document.querySelectorAll('h1,h2,h3')].filter(visible);
    let best = null, bestSize = 0;
    for (const el of nodes) {
      let t = clean(ownText(el).replace(STATUS, ''));
      if (!t || t.length > 48 || NOISE.test(t)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (size > bestSize) { best = t; bestSize = size; }
    }
    return best;
  }

  // The profile card: the right-hand column that repeats the person's name.
  // Walk up from that repeat to the card, then read the card's short texts —
  // the location line lives there, right under the name.
  function profileCard(name) {
    const W = window.innerWidth;
    if (name) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if (clean(n.nodeValue) !== name) continue;
        const el = n.parentElement;
        if (!el || !visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.left < W * 0.5) continue;              // centre column, not the card
        let card = el;
        for (let i = 0; i < 5 && card.parentElement; i++) {
          card = card.parentElement;
          const cr = card.getBoundingClientRect();
          if (cr.height > 80 && cr.width > 140) break;
        }
        return [card];
      }
    }
    // No repeated name (profile pages, narrow windows): fall back to the live
    // elements sitting in the right-hand third of the viewport. These must stay
    // attached to the document — detached clones have no geometry, so nothing
    // in them would ever count as visible.
    const picked = [...document.body.querySelectorAll('div,section,aside')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return visible(el) && r.left > W * 0.55 && r.height > 60 && r.height < 900;
      })
      .slice(0, 6);
    return picked.length ? picked : null;
  }

  function extract() {
    const url = location.href;
    const onMessages = /\/messages\//.test(location.pathname);
    const onProfile = /^\/[A-Za-z0-9_-]+\/?$/.test(location.pathname);
    if (!onMessages && !onProfile) return null;

    const name = headingName();
    if (!name) return null;

    const roots = profileCard(name);
    let candidates = [];
    for (const root of roots || []) {
      for (const t of shortTexts(root, MAX_CANDIDATES)) {
        if (candidates.indexOf(t) === -1) candidates.push(t);
      }
      if (candidates.length >= MAX_CANDIDATES) break;
    }
    // Last resort: a profile with no sidebar at all still has its own heading
    // area worth reading.
    if (!candidates.length) candidates = shortTexts(document.body, MAX_CANDIDATES);

    // A profile link in the card gives us a stable key for this person, so a
    // zone you correct once stays corrected.
    let handle = null;
    const linkScopes = (roots && roots.length) ? roots : [document];
    const links = [];
    for (const r of linkScopes) links.push(...r.querySelectorAll('a[href]'));
    for (const a of links) {
      const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_-]{2,})\/?$/);
      if (m && !/^(messages|shots|designers|teams|jobs|search|following|signup|session|pro)$/i.test(m[1])) {
        handle = m[1]; break;
      }
    }
    // Best signal of all: an anchor whose own text is this person's name.
    if (!handle) {
      for (const a of document.querySelectorAll('a[href]')) {
        if (clean(a.textContent) !== name) continue;
        const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_-]{2,})\/?$/);
        if (m) { handle = m[1]; break; }
      }
    }
    if (!handle && onProfile) handle = location.pathname.replace(/\//g, '');

    const key = handle || (onMessages ? 'thread:' + location.pathname.split('/').pop() : 'name:' + name.toLowerCase());
    return { key, name, candidates, url, source: onMessages ? 'conversation' : 'profile' };
  }

  // -------------------------------------------------------------------------
  let lastSent = '';
  let lastSentAt = 0;
  let toldIdle = false;
  let lastKey = null;
  let burstTimers = [];
  let awaitingNewKey = false;   // mid-switch: the sidebar may still be stale

  function send(type, payload) {
    try { chrome.runtime.sendMessage({ type, payload }, () => void chrome.runtime.lastError); }
    catch { /* extension reloaded */ }
  }

  function pump() {
    // Only the window you're actually looking at may drive the clock.
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;

    let data;
    try { data = extract(); } catch { return; }

    // On Dribbble, but not in anyone's conversation or profile: let the widget
    // fold away instead of showing a stale name.
    if (!data) {
      if (!toldIdle) { toldIdle = true; lastSent = ''; send('idle', {}); }
      return;
    }
    toldIdle = false;

    // Straight after a conversation switch the old person can still be in the
    // DOM for a frame or two. Don't flash them back onto the widget.
    if (awaitingNewKey && data.key === lastKey) return;
    awaitingNewKey = false;

    const sig = JSON.stringify(data);
    const now = Date.now();
    if (sig === lastSent && now - lastSentAt < HEARTBEAT_MS) return;
    lastSent = sig;
    lastSentAt = now;
    lastKey = data.key;
    send('prospect', data);
  }

  // Re-read across the next ~1.5s of rendering, stopping as soon as the person
  // has actually changed. Cheap: each pass is one scoped DOM read.
  function burst(expectNew) {
    burstTimers.forEach(clearTimeout);
    burstTimers = [];
    if (expectNew) awaitingNewKey = true;
    for (const d of BURST_MS) {
      burstTimers.push(setTimeout(() => {
        if (!awaitingNewKey && d > 0 && !expectNew) return;
        pump();
      }, d));
    }
    // Never leave the guard up: if nothing new ever appears, let the next poll
    // report whatever is actually on screen.
    burstTimers.push(setTimeout(() => { awaitingNewKey = false; }, BURST_MS[BURST_MS.length - 1] + 200));
  }

  // Leaving the conversation — another tab, another app — means there is no
  // live chat any more, so tell the widget to fold away. Debounced, because a
  // click on the widget itself also blurs this window.
  let blurTimer = null;
  function goneQuiet() {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      if (document.hasFocus() && document.visibilityState === 'visible') return;
      lastSent = '';
      send('idle', {});
    }, 1500);
  }

  setInterval(pump, POLL_MS);
  window.addEventListener('focus', () => { clearTimeout(blurTimer); burst(false); });
  window.addEventListener('blur', goneQuiet);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { clearTimeout(blurTimer); burst(false); }
    else goneQuiet();
  });

  // Dribbble swaps conversations without a page load, so the URL changing is
  // the earliest possible signal. Catch it three ways: the History API calls
  // themselves, back/forward, and the DOM churn that follows.
  let lastPath = location.pathname;
  function pathChanged() {
    if (location.pathname === lastPath) return false;
    lastPath = location.pathname;
    lastSent = '';
    burst(true);
    return true;
  }

  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function () {
      const r = orig.apply(this, arguments);
      pathChanged();
      return r;
    };
  }
  window.addEventListener('popstate', pathChanged);
  new MutationObserver(pathChanged).observe(document.body, { childList: true, subtree: true });

  // Clicking a conversation in the list happens a beat before the URL changes,
  // so start reading immediately rather than waiting for it.
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href*="/messages/"], [data-conversation-id], li, tr');
    if (a) burst(true);
  }, true);

  setTimeout(pump, 400);
})();
