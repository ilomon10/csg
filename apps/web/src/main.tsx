// Order matters (AC-GEN-014.6, REQ-GEN-010): the Trusted Types policy is created before any
// other application module runs, then Zod's JIT is turned off before the first schema parse.
import './app/trusted-types';
import './app/csp-setup';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './app/app';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
