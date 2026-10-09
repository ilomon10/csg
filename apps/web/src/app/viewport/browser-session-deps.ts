import type {EngineHost} from './engine-host';
import type {PreviewSessionDeps} from './preview-session';

/** Watches `devicePixelRatio`: a `resolution` media query fires once per change and is re-armed. */
function observeDevicePixelRatio(onChange: () => void): () => void {
  let query: MediaQueryList | null = null;
  const arm = (): void => {
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', handle, {once: true});
  };
  const handle = (): void => {
    onChange();
    arm();
  };
  arm();
  return () => query?.removeEventListener('change', handle);
}

/**
 * The browser entry points of a preview session: the renderer comes from the engine host's
 * lease, the layout follows `ResizeObserver` and `devicePixelRatio`.
 *
 * @param host The engine host.
 * @returns Session deps.
 */
export function browserSessionDeps(host: EngineHost): PreviewSessionDeps {
  return {
    devicePixelRatio: () => window.devicePixelRatio,
    lease: (canvas, options) =>
      host.lease(canvas as HTMLCanvasElement, {...options, shareable: true}),
    observeDevicePixelRatio,
    observeResize: (element, onResize) => {
      const observer = new ResizeObserver(onResize);
      observer.observe(element as HTMLElement);
      return () => observer.disconnect();
    },
  };
}
