import type {ChannelFactory, ChannelLike} from '../../shared/persistence';

/** In-memory BroadcastChannel hub: delivers to every other channel, asynchronously. */
export function hub(): ChannelFactory {
  const members = new Set<{
    listeners: Set<(e: MessageEvent) => void>;
  }>();
  return () => {
    const self = {listeners: new Set<(e: MessageEvent) => void>()};
    members.add(self);
    const channel: ChannelLike = {
      postMessage(message) {
        for (const m of members) {
          if (m === self) continue;
          queueMicrotask(() => {
            for (const l of m.listeners) l({data: message} as MessageEvent);
          });
        }
      },
      addEventListener: (_t, l) => void self.listeners.add(l),
      removeEventListener: (_t, l) => void self.listeners.delete(l),
      close: () => void members.delete(self),
    };
    return channel;
  };
}
