import {lazy} from 'react';

/**
 * Lazy view slots (spec 014 NFR, REQ-UX-083): each view is its own chunk, so home and wizard
 * paint before the engine and Easy and Pro load on demand. Other tasks replace the import
 * target of one line each; the shell does not change.
 */
export const HomeView = lazy(async () => ({
  default: (await import('../views/home')).HomeView,
}));
export const WizardView = lazy(async () => ({
  default: (await import('../views/wizard')).WizardView,
}));
export const EasyView = lazy(async () => ({
  default: (await import('../workspaces/easy')).EasyView,
}));
export const ProView = lazy(async () => ({
  default: (await import('../workspaces/pro')).ProView,
}));
