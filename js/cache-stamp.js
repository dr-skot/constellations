// ═══════════════════════════════════════════════════════════
// CACHE STAMP FOR RUNTIME FETCHES
// ═══════════════════════════════════════════════════════════
// tools/bump-stamp.js versions everything the HTML references as src= or href=. It
// finds those by scanning the markup, which means a file fetched from JavaScript at
// runtime is invisible to it: no ?v=, no busting, and an iOS Safari client can serve
// the old copy indefinitely.
//
// Three files were in exactly that position (found 2026-08-20, while checking whether
// a rewrite of the 88 blurbs would actually reach a returning learner — it would not):
//
//     js/constellation-blurbs.json     js/main.js
//     js/finding-guides.json           js/find-guide.js
//     js/sky-objects.json              js/find-guide.js
//
// The fix reads the stamp back off the page rather than having the build write it
// into a global. The markup already carries it on every script and stylesheet, so
// there is one source of truth and nothing new to keep in step. A page served without
// a stamp (an ad-hoc test harness) degrades to the bare path instead of throwing.
//
// test/cache-stamp.js fails if a fetch() in js/ does not go through stampedUrl, which
// is what stops the next runtime fetch from quietly reopening the hole.

let _stamp = null;

// The stamp this page was served with, or '' if it carries none.
function cacheStamp() {
  if (_stamp !== null) return _stamp;
  _stamp = '';
  try {
    const el = document.querySelector('script[src*="?v="], link[href*="?v="]');
    const url = el ? (el.getAttribute('src') || el.getAttribute('href') || '') : '';
    const m = /[?&]v=([^&"']+)/.exec(url);
    if (m) _stamp = m[1];
  } catch (e) { /* no DOM (a test harness) — the bare path is correct there */ }
  return _stamp;
}

// Append the page's cache stamp to a same-origin path. Use this for every fetch of a
// versioned asset; a bare fetch() is the bug this file exists to prevent.
function stampedUrl(pathname) {
  const v = cacheStamp();
  if (!v) return pathname;
  return pathname + (pathname.indexOf('?') === -1 ? '?' : '&') + 'v=' + v;
}
