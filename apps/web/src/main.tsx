// Order matters (AC-GEN-014.6, REQ-GEN-010): the Trusted Types policy is created before any
// other application module runs, then Zod's JIT is turned off before the first schema parse.
import './app/trusted-types';
import './app/csp-setup';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './app/app';
import {FramedNotice, isFramed} from './app/shell';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}
// REQ-GEN-012: a framed editor renders only an "Open in a new tab" link and touches no storage.
createRoot(root).render(
  <StrictMode>
    {isFramed() ? <FramedNotice href={window.location.href} /> : <App />}
  </StrictMode>,
);
