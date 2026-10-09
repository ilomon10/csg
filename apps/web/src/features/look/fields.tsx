import {t} from '../../shared/i18n';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {IconButton} from '../../shared/ui';
import type {RenderIssue} from './render-model';

/** Shared props of the field components. */
interface FieldBase {
  readonly label: string;
  /** Focus hand-off key (`look.<id>` or `render.<id>`). */
  readonly focusKey: string;
  readonly errors?: readonly RenderIssue[];
  /** Restores the control's baseline; omit for controls without a reset. */
  readonly onReset?: (() => void) | undefined;
  readonly resetDisabled?: boolean;
}

function FieldShell({
  id,
  label,
  focusKey,
  errors = [],
  onReset,
  resetDisabled,
  children,
}: FieldBase & {
  readonly id: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="csg-look-field" data-focus-key={focusKey}>
      <label className="csg-look-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="csg-look-field__control">{children}</div>
      {onReset ? (
        <IconButton
          icon="undo"
          label={t('look.reset.control', {label})}
          disabled={resetDisabled === true}
          onClick={onReset}
        />
      ) : null}
      {errors.length > 0 ? (
        <div id={`${id}-err`} className="csg-look-field__errors" role="alert">
          {errors.map(e => (
            <p key={`${e.path}:${e.code}`}>
              {t('render.error', {code: e.code, message: e.message})}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, errors?: readonly RenderIssue[]) =>
  errors && errors.length > 0 ? `${id}-err` : undefined;

/** A native select. `value` must be one of `options`. */
export function SelectField(
  props: FieldBase & {
    readonly value: string;
    readonly options: ReadonlyArray<{
      readonly value: string;
      readonly label: string;
    }>;
    readonly onChange: (value: string) => void;
  },
): ReactElement {
  const id = useId();
  return (
    <FieldShell id={id} {...props}>
      <select
        id={id}
        className="csg-look-input"
        value={props.value}
        aria-invalid={
          props.errors && props.errors.length > 0 ? true : undefined
        }
        aria-describedby={describedBy(id, props.errors)}
        onChange={e => props.onChange(e.target.value)}
      >
        {props.options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** An on/off switch. */
export function SwitchField(
  props: FieldBase & {
    readonly checked: boolean;
    readonly onChange: (checked: boolean) => void;
  },
): ReactElement {
  const id = useId();
  return (
    <FieldShell id={id} {...props}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="csg-look-switch"
        checked={props.checked}
        aria-describedby={describedBy(id, props.errors)}
        onChange={e => props.onChange(e.target.checked)}
      />
    </FieldShell>
  );
}

/** Begin/end of one undo step around a pointer drag (`DocumentStore`). */
export interface RangeGesture {
  beginGesture(key: string): void;
  endGesture(): void;
}

/** A slider with a numeric readout; a pointer drag is one undo step. */
export function RangeField(
  props: FieldBase & {
    readonly value: number;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly gestureKey: string;
    readonly gesture?: RangeGesture | undefined;
    readonly onChange: (value: number) => void;
  },
): ReactElement {
  const id = useId();
  const dragging = useRef(false);
  const gesture = useRef(props.gesture);
  gesture.current = props.gesture;
  useEffect(() => {
    const stop = () => {
      if (!dragging.current) return;
      dragging.current = false;
      gesture.current?.endGesture();
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      stop();
    };
  }, []);
  return (
    <FieldShell id={id} {...props}>
      <input
        id={id}
        type="range"
        className="csg-look-range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-valuetext={props.value.toFixed(2)}
        aria-describedby={describedBy(id, props.errors)}
        onPointerDown={() => {
          if (dragging.current || !gesture.current) return;
          dragging.current = true;
          gesture.current.beginGesture(props.gestureKey);
        }}
        onChange={e => props.onChange(Number(e.target.value))}
      />
      <output htmlFor={id} className="csg-look-value csg-mono">
        {props.value.toFixed(2)}
      </output>
    </FieldShell>
  );
}

/**
 * A numeric text entry that commits on blur or Enter and keeps what the user typed while the
 * value is rejected, so the field error stays next to it.
 */
export function NumberField(
  props: FieldBase & {
    readonly value: number;
    readonly min: number;
    readonly max: number;
    /** Returns the errors of the commit; an empty list accepts it. */
    readonly onCommit: (value: number) => readonly RenderIssue[];
  },
): ReactElement {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const issues = props.onCommit(
      draft.trim() === '' ? Number.NaN : Number(draft),
    );
    if (issues.length === 0) setDraft(null);
  };
  return (
    <FieldShell id={id} {...props}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        className="csg-look-input csg-mono"
        min={props.min}
        max={props.max}
        step={1}
        value={draft ?? String(props.value)}
        aria-invalid={
          props.errors && props.errors.length > 0 ? true : undefined
        }
        aria-describedby={describedBy(id, props.errors)}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    </FieldShell>
  );
}

/** A text entry that commits on blur or Enter (custom palette colors). */
export function TextField(
  props: FieldBase & {
    readonly value: string;
    readonly hint?: string;
    readonly onCommit: (value: string) => readonly RenderIssue[];
  },
): ReactElement {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const issues = props.onCommit(draft);
    if (issues.length === 0) setDraft(null);
  };
  return (
    <FieldShell id={id} {...props}>
      <input
        id={id}
        type="text"
        spellCheck={false}
        className="csg-look-input csg-mono"
        value={draft ?? props.value}
        placeholder={props.hint}
        aria-invalid={
          props.errors && props.errors.length > 0 ? true : undefined
        }
        aria-describedby={describedBy(id, props.errors)}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    </FieldShell>
  );
}
