import {createContext, useContext, useSyncExternalStore} from 'react';
import type {ReactElement, ReactNode} from 'react';
import type {ViewRoute} from '../../shared/routing';
import type {UiPrefs} from '../../shared/persistence';
import type {ShellServices} from './services';

const ShellContext = createContext<ShellServices | null>(null);

/** Provides the shell services to the tree. */
export function ShellProvider({
  services,
  children,
}: {
  readonly services: ShellServices;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <ShellContext.Provider value={services}>{children}</ShellContext.Provider>
  );
}

/** The shell services. Views use this for routing, prefs, the document store and the registry. */
export function useShell(): ShellServices {
  const services = useContext(ShellContext);
  if (services === null) throw new Error('useShell outside ShellProvider');
  return services;
}

/** The current view route. */
export function useRoute(): ViewRoute {
  const {router} = useShell();
  return useSyncExternalStore(router.subscribe, router.current);
}

/** The UI preferences. */
export function usePrefs(): UiPrefs {
  const {prefs} = useShell();
  return useSyncExternalStore(prefs.subscribe, prefs.get);
}
