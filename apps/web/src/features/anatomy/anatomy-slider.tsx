import {t} from '../../shared/i18n';
import type {MessageKey} from '../../shared/i18n';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import {ANATOMY_PARAM_SPECS} from '@csg/parts-schema';
import {IconButton, announce} from '../../shared/ui';
import {clampAnatomyValue, stepAnatomyValue} from './anatomy-model';
import type {AnatomyKey} from './anatomy-model';

/** Begin/end of one undo step around a pointer drag (`DocumentStore.beginGesture`/`endGesture`). */
export interface AnatomyGesture {
  beginGesture(key: string): void;
  endGesture(): void;
}

/** Props of {@link AnatomySlider}. */
export interface AnatomySliderProps {
  readonly paramKey: AnatomyKey;
  readonly value: number;
  /** Value the per-slider reset restores (the preset's value, else the default). */
  readonly resetValue: number;
  readonly onChange: (value: number) => void;
  readonly gesture?: AnatomyGesture | undefined;
}

const SMALL_STEP = 0.01;
const LARGE_STEP = 0.1;

/**
 * One anatomy parameter (REQ-ANA-017): labelled slider plus numeric input, arrows step 0.01,
 * Page Up/Down step 0.10, a per-slider reset, and typed values clamp with an announcement. A
 * pointer drag is one undo step through the gesture; keyboard bursts coalesce in the store.
 */
export function AnatomySlider({
  paramKey,
  value,
  resetValue,
  onChange,
  gesture,
}: AnatomySliderProps): ReactElement {
  const id = useId();
  const {min, max} = ANATOMY_PARAM_SPECS[paramKey];
  const label = t(`anatomy.param.${paramKey}` as MessageKey);
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const dragging = useRef(false);
  const gestureRef = useRef(gesture);
  gestureRef.current = gesture;

  const endDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    gestureRef.current?.endGesture();
  }, []);

  useEffect(() => {
    const stop = () => endDrag();
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      endDrag();
    };
  }, [endDrag]);

  const say = (text: string) => {
    setNote(text);
    if (text) announce(text);
  };

  const commit = (next: number) => {
    setNote('');
    onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = stepAnatomyValue(paramKey, value, SMALL_STEP);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = stepAnatomyValue(paramKey, value, -SMALL_STEP);
        break;
      case 'PageUp':
        next = stepAnatomyValue(paramKey, value, LARGE_STEP);
        break;
      case 'PageDown':
        next = stepAnatomyValue(paramKey, value, -LARGE_STEP);
        break;
      case 'Home':
        if (event.currentTarget.type === 'range') next = min;
        break;
      case 'End':
        if (event.currentTarget.type === 'range') next = max;
        break;
      case 'Enter':
        if (event.currentTarget.type === 'number') commitDraft();
        return;
      default:
        return;
    }
    if (next === null) return;
    event.preventDefault();
    setDraft(null);
    commit(next);
  };

  function commitDraft() {
    if (draft === null) return;
    const typed = Number(draft);
    setDraft(null);
    if (draft.trim() === '' || !Number.isFinite(typed)) {
      say(t('anatomy.invalid'));
      return;
    }
    const next = clampAnatomyValue(paramKey, typed);
    if (typed > max) say(t('anatomy.max', {value: max.toFixed(2)}));
    else if (typed < min) say(t('anatomy.min', {value: min.toFixed(2)}));
    else setNote('');
    onChange(next);
  }

  const percent = ((value - min) / (max - min)) * 100;
  const noteId = `${id}-note`;
  return (
    <div className="csg-anat-row" data-focus-key={`anatomy.${paramKey}`}>
      <label className="csg-anat-row__label" htmlFor={`${id}-range`}>
        {label}
      </label>
      <input
        id={`${id}-num`}
        className="csg-anat-row__num csg-mono"
        type="number"
        inputMode="decimal"
        aria-label={t('anatomy.value', {label})}
        aria-describedby={note ? noteId : undefined}
        min={min}
        max={max}
        step={SMALL_STEP}
        value={draft ?? value.toFixed(2)}
        onChange={e => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={onKeyDown}
      />
      <IconButton
        icon="undo"
        label={t('anatomy.reset.value', {label})}
        disabled={value === resetValue}
        onClick={() => commit(resetValue)}
      />
      <input
        id={`${id}-range`}
        className="csg-anat-row__range"
        type="range"
        min={min}
        max={max}
        step={SMALL_STEP}
        value={value}
        style={{['--p' as string]: `${percent}%`}}
        aria-valuetext={value.toFixed(2)}
        aria-describedby={note ? noteId : undefined}
        onPointerDown={() => {
          if (dragging.current || !gestureRef.current) return;
          dragging.current = true;
          gestureRef.current.beginGesture(`anatomy:${paramKey}`);
        }}
        onChange={e => {
          setDraft(null);
          commit(clampAnatomyValue(paramKey, Number(e.target.value)));
        }}
        onKeyDown={onKeyDown}
      />
      <p
        id={noteId}
        className="csg-anat-row__note"
        role="status"
        hidden={note === ''}
      >
        {note}
      </p>
    </div>
  );
}
