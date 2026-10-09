import {useEffect, useRef} from 'react';
import {openExport} from '../../features/export';
import type {CommandDef} from '../../shared/shortcuts';
import {useShell} from '../shell/shell-context';

/**
 * Registers the commands a workspace owns while it is mounted, so the palette, the shortcut
 * dispatcher and the buttons run the same code (REQ-UX-018). `extra` may change every render;
 * the latest handlers run.
 */
export function useWorkspaceCommands(
  extra: (() => readonly CommandDef[]) | null = null,
): void {
  const {registry} = useShell();
  const build = useRef(extra);
  build.current = extra;
  useEffect(() => {
    const defs: CommandDef[] = [
      {
        id: 'export.open',
        titleKey: 'cmd.export.open',
        category: 'export',
        synonyms: ['render', 'sprite sheet', 'download'],
        run: () => openExport(),
      },
      ...(build.current?.() ?? []).map((def): CommandDef => ({
        ...def,
        run: () =>
          build
            .current?.()
            .find(d => d.id === def.id)
            ?.run(),
      })),
    ];
    return registry.register(defs);
  }, [registry]);
}
