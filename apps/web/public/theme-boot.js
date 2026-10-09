/* global window, document */
/*
 * Applies the stored theme and reduce-motion preference before first paint (REQ-UX-034,
 * AC-UX-034.1). A classic external script: the CSP allows `script-src 'self'` and no inline
 * scripts. Keep in sync with `src/app/shell/prefs-store.ts` (key `csg.prefs`, fields `theme`
 * and `reduceMotion`). Does nothing in a frame (AC-GEN-012.1). Any failure leaves the dark default from index.html.
 */
(function () {
  // REQ-GEN-012: a framed editor reads no storage, so the guard runs before localStorage.
  try {
    if (window.self !== window.top) return;
  } catch {
    return;
  }
  const root = document.documentElement;
  try {
    const raw = window.localStorage.getItem('csg.prefs');
    if (raw && raw.length <= 65536) {
      const prefs = JSON.parse(raw);
      if (prefs && typeof prefs === 'object') {
        if (
          prefs.theme === 'light' ||
          prefs.theme === 'dark' ||
          prefs.theme === 'system'
        ) {
          root.setAttribute('data-theme', prefs.theme);
        }
        if (prefs.reduceMotion === true) {
          root.setAttribute('data-reduce-motion', 'true');
        } else if (prefs.reduceMotion === false) {
          root.setAttribute('data-reduce-motion', 'false');
        }
      }
    }
  } catch {
    /* storage blocked or corrupt: keep the defaults */
  }
})();
