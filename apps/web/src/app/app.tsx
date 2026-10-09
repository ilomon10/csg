import './app.css';
import type {ReactElement} from 'react';
import {Shell, createShellServices} from './shell';
import type {ShellServices} from './shell';

let services: ShellServices | null = null;

/** One set of shell services for the page's lifetime (StrictMode double-invokes initializers). */
function appServices(): ShellServices {
  services ??= createShellServices({win: window});
  return services;
}

/** Editor shell root (spec 009, spec 014): router, top bar, overlays and the lazy view slots. */
export function App(): ReactElement {
  return <Shell services={appServices()} />;
}
