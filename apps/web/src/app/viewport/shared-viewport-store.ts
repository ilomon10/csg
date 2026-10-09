import {createViewportStore} from '../../shared/viewport';

/**
 * The viewport state shared by Easy and Pro (REQ-UX-051): Pixel/3D, direction, preview clip,
 * playing and zoom. Never in history (REQ-UX-024). The wizard creates its own store.
 */
export const sharedViewportStore = createViewportStore();
