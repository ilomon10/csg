import {useId, useState, type ReactElement} from 'react';

/** Props of {@link CommitField}. */
export interface CommitFieldProps {
  readonly label: string;
  readonly value: string;
  /** Returns an error message to show (and revert), or null once the value is applied. */
  readonly onCommit: (text: string) => string | null;
  readonly type?: 'text' | 'number';
  readonly step?: number;
  readonly placeholder?: string;
}

/**
 * Labelled input that validates on blur or Enter. A rejected value shows its error and the
 * previous value is kept (AC-ANM-005.1).
 */
export function CommitField({
  label,
  value,
  onCommit,
  type = 'text',
  step,
  placeholder,
}: CommitFieldProps): ReactElement {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const message = onCommit(draft);
    setError(message);
    setDraft(null);
  };
  return (
    <div className="csg-anim-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="csg-anim-input csg-mono"
        type={type}
        step={step}
        placeholder={placeholder}
        value={draft ?? value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
        }}
      />
      {error ? (
        <p id={`${id}-err`} className="csg-anim-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
