/** View selected by the URL fragment (REQ-UX-069). */
export type ViewRoute =
  | {readonly view: 'home'}
  | {readonly view: 'wizard'}
  | {readonly view: 'project'; readonly projectId: string}
  | {readonly view: 'share'; readonly payload: string}
  /** Empty fragment: the startup rule decides (REQ-UX-070, REQ-UX-087). */
  | {readonly view: 'startup'};

/** A project ID in the fragment (REQ-UX-069); anything else is never looked up. */
export const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Longest share payload the parser hands on; the codec enforces its own byte caps. */
const MAX_SHARE_PAYLOAD_CHARS = 65_536;

/** Parses a `location.hash`. Untrusted input: never throws, unknown values map to home. */
export function parseViewRoute(hash: string): ViewRoute {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (fragment === '') return {view: 'startup'};
  if (fragment === 'home') return {view: 'home'};
  if (fragment === 'new') return {view: 'wizard'};
  if (fragment.startsWith('p=')) {
    const projectId = fragment.slice(2);
    return PROJECT_ID_PATTERN.test(projectId)
      ? {view: 'project', projectId}
      : {view: 'home'};
  }
  if (fragment.startsWith('c=')) {
    const payload = fragment.slice(2);
    return payload.length > 0 && payload.length <= MAX_SHARE_PAYLOAD_CHARS
      ? {view: 'share', payload}
      : {view: 'home'};
  }
  return {view: 'home'};
}

/** Formats a route as a fragment. Share links are produced by the share codec, not here. */
export function formatViewRoute(
  route: Exclude<ViewRoute, {view: 'startup' | 'share'}>,
): string {
  switch (route.view) {
    case 'home':
      return '#home';
    case 'wizard':
      return '#new';
    case 'project':
      return PROJECT_ID_PATTERN.test(route.projectId)
        ? `#p=${route.projectId}`
        : '#home';
  }
}
