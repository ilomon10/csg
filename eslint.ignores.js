// Shared ignore list for eslint.config.js (gts defaults plus build outputs).
export const ignores = [
  '**/dist/',
  '**/coverage/',
  '**/node_modules/',
  '**/playwright-report/',
  '**/test-results/',
  '**/.next/',
  'apps/site/out/',
  'apps/site/.source/',
  'apps/site/next-env.d.ts',
  'assets/',
  'assets-src/',
  'docs/',
  'specs/',
  '.tagconn/',
  'test/fixtures/',
];
