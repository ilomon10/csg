import {useEffect, useId, useRef} from 'react';
import type {ReactElement} from 'react';
import type {ExportWarning} from '@csg/engine';
import {Button, Dialog} from '../../shared/ui';
import {closeExport, useExportOpen} from './export-store';
import {ExportSettingsForm} from './export-settings-form';
import {
  EXPORT_TEXT,
  LICENCE_HEADINGS,
  LICENCE_NOTES,
  formatSize,
  styleBlockedText,
} from './export-text';
import type {ExportHostDeps} from './export-types';
import {useExportController} from './use-export-controller';
import type {ExportController} from './use-export-controller';
import './export.css';

/** Props of {@link ExportDialog}. */
export interface ExportDialogProps {
  readonly deps: ExportHostDeps;
}

function sanitizedName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base === '' ? 'character' : base;
}

function warningLabel(w: ExportWarning): string {
  return LICENCE_HEADINGS[w.code] ?? w.code;
}

function PlanSummary({c}: {c: ExportController}): ReactElement {
  if (c.plan.kind === 'loading') {
    return <p className="exp-note">{EXPORT_TEXT.planLoading}</p>;
  }
  if (c.plan.kind === 'refused') {
    return (
      <p className="exp-error" role="alert">
        <span className="csg-mono">{c.plan.error.code}</span>{' '}
        {c.plan.error.message}
      </p>
    );
  }
  const {plan} = c.plan;
  return (
    <div className="exp-plan">
      <p className="exp-note">
        {plan.frameCount} frames, {plan.cell.width} × {plan.cell.height} px
        cells
      </p>
      {plan.scales.map(s => (
        <p key={s.scale} className="exp-note">
          {s.scale}×:{' '}
          {s.sheets.length === 0
            ? 'one PNG per frame'
            : s.sheets.map(h => `${h.width} × ${h.height}`).join(', ')}
        </p>
      ))}
      {plan.warnings.map(w => (
        <p key={w.code} className="exp-warn">
          <span className="csg-mono">{w.code}</span>{' '}
          {w.message ??
            'A sheet is wider than 4096 px; some engines cap textures there.'}
        </p>
      ))}
    </div>
  );
}

function ProgressBlock({c}: {c: ExportController}): ReactElement {
  const p = c.progress;
  const label =
    p === null
      ? EXPORT_TEXT.preparing
      : p.phase === 'render'
        ? EXPORT_TEXT.rendering
        : p.phase === 'encode'
          ? EXPORT_TEXT.encoding
          : EXPORT_TEXT.packaging;
  const id = useId();
  return (
    <div className="exp-progress">
      <p id={id} className="exp-note" data-testid="export-progress-text">
        {label}
        {p === null ? '' : ` ${p.done} / ${p.total}`}
      </p>
      <progress
        aria-labelledby={id}
        max={p?.total ?? 1}
        value={p === null ? undefined : p.done}
      />
    </div>
  );
}

function LicenceDialog({
  c,
  onClose,
}: {
  c: ExportController;
  onClose: () => void;
}): ReactElement {
  const confirm = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={c.stage === 'licence'}
      role="alertdialog"
      title={EXPORT_TEXT.licenceTitle}
      width={520}
      dismissOnBackdrop={false}
      initialFocus={cancel}
      onClose={() => {
        c.backToSettings();
        onClose();
      }}
      footer={
        <>
          <Button
            ref={cancel}
            onClick={() => c.backToSettings()}
            data-testid="licence-cancel"
          >
            {EXPORT_TEXT.licenceCancel}
          </Button>
          <Button
            ref={confirm}
            variant="primary"
            onClick={c.confirmLicences}
            data-testid="licence-confirm"
          >
            {EXPORT_TEXT.licenceConfirm}
          </Button>
        </>
      }
    >
      <p>{EXPORT_TEXT.licenceIntro}</p>
      {c.licenceWarnings.map(w => (
        <section key={w.code} className="exp-licence" data-code={w.code}>
          <h3 className="exp-licence__head">{warningLabel(w)}</h3>
          <p className="exp-note">{LICENCE_NOTES[w.code]}</p>
          <ul>
            {(w.assets ?? []).map(a => (
              <li key={a} className="csg-mono">
                {a}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Dialog>
  );
}

/**
 * The export dialog (spec 005 REQ-EXP-017, 021, 023, 024, 025; spec 001 REQ-CMP-044). Mount it
 * once in the shell and open it with `openExport()`. It reads the document through
 * `deps.getDocument()` only when the user clicks Export and works on a deep copy from then on.
 */
export function ExportDialog({deps}: ExportDialogProps): ReactElement {
  const open = useExportOpen();
  const c = useExportController(deps, open);
  const blockId = useId();
  const primary = useRef<HTMLButtonElement>(null);
  const notice = deps.styleNotice ?? null;
  const blocked = notice !== null;
  const running = c.stage === 'running';

  // Move focus to the action of the new stage, so keyboard users never lose their place.
  useEffect(() => {
    if (open) primary.current?.focus();
  }, [open, c.stage]);

  const close = () => {
    if (running) c.cancel();
    closeExport();
  };

  const exportDisabled = blocked || c.plan.kind !== 'ok' || c.doc === null;

  let body: ReactElement;
  let footer: ReactElement;
  if (running) {
    body = <ProgressBlock c={c} />;
    footer = (
      <Button ref={primary} onClick={c.cancel} data-testid="export-cancel">
        {EXPORT_TEXT.cancel}
      </Button>
    );
  } else if (c.stage === 'done' && c.done !== null) {
    body = (
      <div data-testid="export-done">
        <p>
          <strong>{c.done.zipName}</strong> ({formatSize(c.done.size)})
        </p>
        <ul className="exp-files">
          {c.done.files.map(f => (
            <li key={f.name} className="csg-mono">
              {f.name} <span className="exp-muted">{formatSize(f.size)}</span>
            </li>
          ))}
        </ul>
        {c.done.warnings.map(w => (
          <p key={w.code} className="exp-warn">
            <span className="csg-mono">{w.code}</span>{' '}
            {w.message ?? (w.assets ?? []).join(', ')}
          </p>
        ))}
        {c.done.notes.map(n => (
          <p key={n.code} className="exp-warn">
            <span className="csg-mono">{n.code}</span> {n.message}
          </p>
        ))}
      </div>
    );
    footer = (
      <>
        <Button onClick={c.downloadAgain}>{EXPORT_TEXT.downloadAgain}</Button>
        <Button ref={primary} variant="primary" onClick={close}>
          {EXPORT_TEXT.close}
        </Button>
      </>
    );
  } else if (c.stage === 'cancelled') {
    body = (
      <p data-testid="export-cancelled" role="status">
        {EXPORT_TEXT.cancelled}
      </p>
    );
    footer = (
      <>
        <Button onClick={close}>{EXPORT_TEXT.close}</Button>
        <Button ref={primary} variant="primary" onClick={c.backToSettings}>
          {EXPORT_TEXT.back}
        </Button>
      </>
    );
  } else if (c.stage === 'failed' && c.error !== null) {
    body = (
      <p className="exp-error" role="alert" data-testid="export-failed">
        <span className="csg-mono">{c.error.code}</span> {c.error.message}
      </p>
    );
    footer = (
      <>
        <Button onClick={close}>{EXPORT_TEXT.close}</Button>
        <Button ref={primary} variant="primary" onClick={c.backToSettings}>
          {EXPORT_TEXT.back}
        </Button>
      </>
    );
  } else {
    body = (
      <>
        {blocked ? (
          <p id={blockId} className="exp-error" data-testid="export-blocked">
            <span className="csg-mono">{notice.code}</span>{' '}
            {styleBlockedText(notice.label)}
          </p>
        ) : null}
        <ExportSettingsForm
          settings={c.settings}
          onChange={c.patch}
          namePlaceholder={sanitizedName(c.doc?.character.name ?? '')}
        />
        <h3 className="csg-label exp-plan-head">{EXPORT_TEXT.planHeading}</h3>
        <PlanSummary c={c} />
      </>
    );
    footer = (
      <>
        <Button onClick={close}>{EXPORT_TEXT.cancel}</Button>
        <Button
          ref={primary}
          variant="primary"
          disabled={exportDisabled}
          aria-describedby={blocked ? blockId : undefined}
          onClick={c.start}
          data-testid="export-start"
        >
          {EXPORT_TEXT.export}
        </Button>
      </>
    );
  }

  return (
    <>
      <Dialog
        open={open && c.stage !== 'licence'}
        onClose={close}
        title={EXPORT_TEXT.title}
        width={560}
        dismissOnBackdrop={!running}
        footer={footer}
      >
        <div data-testid="export-dialog" data-stage={c.stage}>
          {body}
        </div>
        <div
          className="csg-sr"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="export-live"
        >
          {c.live}
        </div>
      </Dialog>
      {open ? <LicenceDialog c={c} onClose={() => undefined} /> : null}
    </>
  );
}
