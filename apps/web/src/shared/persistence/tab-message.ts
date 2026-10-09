import {z} from 'zod';
import {devWarn} from './types';

/** Largest accepted message, in characters of a string payload (AC-GEN-013.3). */
export const MAX_TAB_MESSAGE_CHARS = 65_536;

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/**
 * Cross-tab message (REQ-UX-029). Strict: unknown fields fail. Messages carry only IDs and lock
 * events, never project content. `changed` tells other tabs which project records were written.
 */
export const tabMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.enum(['claim', 'release', 'takeover']),
      projectId: idSchema,
      tabId: idSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('changed'),
      projectIds: z.array(idSchema).max(64),
    })
    .strict(),
]);

/** A validated cross-tab message. */
export type TabMessage = z.infer<typeof tabMessageSchema>;

/** Most nodes a legitimate message has; the walk gives up above this (AC-GEN-013.3). */
const MAX_MESSAGE_NODES = 256;
const MAX_MESSAGE_DEPTH = 4;

/** Bounded walk over untrusted structured-clone data: false for cycles, DAGs, deep or big input. */
function withinBounds(data: unknown): boolean {
  const seen = new WeakSet<object>();
  const stack: Array<{node: unknown; depth: number}> = [{node: data, depth: 0}];
  let count = 0;
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    if (typeof item.node !== 'object' || item.node === null) continue;
    if (seen.has(item.node) || item.depth > MAX_MESSAGE_DEPTH) return false;
    seen.add(item.node);
    for (const child of Object.values(item.node)) {
      if (++count > MAX_MESSAGE_NODES) return false;
      stack.push({node: child, depth: item.depth + 1});
    }
  }
  return true;
}

/**
 * Validates a received BroadcastChannel payload. Anything invalid is ignored (`null`) with a
 * dev-mode warning naming the failure (AC-UX-029.2, AC-GEN-013.3).
 */
export function parseTabMessage(
  data: unknown,
  warn: (message: string) => void = devWarn,
): TabMessage | null {
  if (typeof data === 'string' && data.length > MAX_TAB_MESSAGE_CHARS) {
    warn(
      `TabMessage ignored: payload exceeds ${MAX_TAB_MESSAGE_CHARS} characters`,
    );
    return null;
  }
  if (typeof data === 'object' && data !== null) {
    const ids = (data as {projectIds?: unknown}).projectIds;
    if (Array.isArray(ids) && ids.length > 64) {
      warn('TabMessage ignored: projectIds longer than 64');
      return null;
    }
    if (!withinBounds(data)) {
      warn('TabMessage ignored: payload is too large, too deep or cyclic');
      return null;
    }
  }
  const parsed = tabMessageSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    warn(
      `TabMessage ignored: schema failure at "${first?.path.join('.') ?? ''}": ${first?.message ?? 'invalid'}`,
    );
    return null;
  }
  return parsed.data;
}

/** The part of `BroadcastChannel` this module uses. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', l: (e: MessageEvent) => void): void;
  removeEventListener(type: 'message', l: (e: MessageEvent) => void): void;
  close(): void;
}

/** Creates a channel by name; `null` when BroadcastChannel is unavailable. */
export type ChannelFactory = (name: string) => ChannelLike | null;

/** Default factory over the global `BroadcastChannel`. */
export const defaultChannelFactory: ChannelFactory = name =>
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name);

/** A validated message channel. */
export interface TabChannel {
  post(message: TabMessage): void;
  /** Subscribes to valid messages only; returns an unsubscribe function. */
  subscribe(listener: (message: TabMessage) => void): () => void;
  close(): void;
}

/** Opens a Zod-validated channel (REQ-UX-029). Without BroadcastChannel it is a no-op. */
export function createTabChannel(
  name: string,
  factory: ChannelFactory = defaultChannelFactory,
  warn?: (message: string) => void,
): TabChannel {
  const channel = factory(name);
  return {
    post(message) {
      channel?.postMessage(message);
    },
    subscribe(listener) {
      if (channel === null) return () => {};
      const handler = (event: MessageEvent) => {
        const message = parseTabMessage(event.data, warn);
        if (message !== null) listener(message);
      };
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },
    close() {
      channel?.close();
    },
  };
}
