import type {CommandDef} from './types';

/** Runtime registry of commands shared by shortcuts, palette, menus and buttons. */
export interface CommandRegistry {
  register(defs: readonly CommandDef[]): () => void;
  get(id: string): CommandDef | undefined;
  all(): readonly CommandDef[];
  /** Runs an enabled command; unknown or disabled commands are a no-op. */
  run(id: string): Promise<void>;
  /** The most recently run command ids, newest first, at most {@link RECENT_LIMIT}. */
  recent(): readonly string[];
}

/** Recent commands listed first in an empty palette (REQ-UX-019). */
export const RECENT_LIMIT = 5;

/** Creates a command registry. */
export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, CommandDef>();
  let recent: string[] = [];
  return {
    register(defs) {
      for (const def of defs) commands.set(def.id, def);
      return () => {
        for (const def of defs) {
          if (commands.get(def.id) === def) commands.delete(def.id);
        }
      };
    },
    get: id => commands.get(id),
    all: () => [...commands.values()],
    async run(id) {
      const command = commands.get(id);
      if (!command) return;
      const reason = command.disabledReason?.() ?? null;
      if (reason !== null) return;
      recent = [id, ...recent.filter(entry => entry !== id)].slice(
        0,
        RECENT_LIMIT,
      );
      await command.run();
    },
    recent: () => recent,
  };
}
