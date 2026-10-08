'use client';
import {RootProvider} from 'fumadocs-ui/provider/next';
import {lazy} from 'react';
import type {ReactNode} from 'react';

// Search code and the index load on first open (Ctrl/Cmd+K or the search
// button), not on page load, to keep the landing page's main thread free.
const StaticSearchDialog = lazy(() =>
  import('./search-dialog').then(m => ({default: m.StaticSearchDialog})),
);

/** Theme (next-themes, no flash) and static search for every page. */
export function Provider({children}: {children: ReactNode}) {
  return (
    <RootProvider
      search={{SearchDialog: StaticSearchDialog, preload: false}}
      theme={{storageKey: 'csg-theme'}}
    >
      {children}
    </RootProvider>
  );
}
