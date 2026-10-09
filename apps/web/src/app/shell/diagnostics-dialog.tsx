import {t} from '../../shared/i18n';
import {useEffect, useRef, useState} from 'react';
import type {ReactElement} from 'react';
import {useShortcutScope} from '../../shared/shortcuts';
import {Button, Dialog, announce} from '../../shared/ui';
import {useMiniStore} from './mini-store';
import {APP_VERSION} from './renderer-status';
import {useShell} from './shell-context';

/**
 * Plain-text diagnostic report (AC-UX-042.2): backend, versions, storage state and error codes.
 * Never includes file bytes or project content.
 */
export function buildReport(input: {
  backend: string;
  threeVersion: string;
  adapter: string | null;
  persisted: boolean | null;
  codes: readonly string[];
}): string {
  return [
    `Renderer: ${input.backend}`,
    `three.js: ${input.threeVersion}`,
    `Adapter: ${input.adapter ?? t('diag.unknown')}`,
    `App version: ${APP_VERSION}`,
    `Persistent storage: ${input.persisted === null ? t('diag.unknown') : input.persisted ? t('diag.yes') : t('diag.no')}`,
    `Last error codes: ${input.codes.length === 0 ? t('diag.none') : input.codes.join(', ')}`,
  ].join('\n');
}

function DiagnosticsBody(): ReactElement {
  const {diagnostics, win} = useShell();
  const ref = useRef<HTMLDivElement>(null);
  useShortcutScope('modal', ref);
  const status = useMiniStore(diagnostics.status, s => s);
  const codes = useMiniStore(diagnostics.errors, s => s.codes);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    let live = true;
    win.navigator.storage?.persisted?.().then(
      v => live && setPersisted(v),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [win]);
  const backend =
    status.backend === null
      ? t('diag.unknown')
      : t(`renderer.${status.backend}`);
  const report = buildReport({
    backend,
    threeVersion: status.threeVersion,
    adapter: status.adapter,
    persisted,
    codes,
  });
  return (
    <div ref={ref} className="shell-diag">
      <pre
        className="csg-mono shell-diag__report"
        tabIndex={0}
        aria-label={t('diag.title')}
      >
        {report}
      </pre>
      <div>
        <Button
          onClick={async () => {
            try {
              await win.navigator.clipboard.writeText(report);
              setNote(t('diag.copied'));
              announce(t('diag.copied'));
            } catch {
              setNote(report);
            }
          }}
        >
          {t('diag.copy')}
        </Button>
        <span role="status" className="shell-hint">
          {note === report ? '' : note}
        </span>
      </div>
    </div>
  );
}

/** Diagnostics opened from the renderer badge (REQ-UX-042, REQ-GEN-002). */
export function DiagnosticsDialog(): ReactElement {
  const {overlays} = useShell();
  const open = useMiniStore(overlays, o => o.diagnostics);
  return (
    <Dialog
      open={open}
      onClose={() => overlays.update({diagnostics: false})}
      title={t('diag.title')}
      width={520}
    >
      {open ? <DiagnosticsBody /> : null}
    </Dialog>
  );
}
