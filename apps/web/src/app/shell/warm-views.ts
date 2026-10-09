/**
 * Test support: imports the lazily loaded view modules once, so a test's first `findBy*` is not
 * charged for cold module transforms on a loaded machine (the shell renders `Loading…` until the
 * lazy view resolves).
 */
export async function warmViews(): Promise<void> {
  await Promise.all([
    import('../views/home'),
    import('../views/wizard'),
    import('../workspaces/easy'),
    import('../workspaces/pro'),
  ]);
}
