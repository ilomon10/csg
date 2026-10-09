import {useEffect, useId, useRef, useState, type ReactElement} from 'react';
import {t} from '../../shared/i18n';
import {SwatchRow, type Swatch} from '../../shared/ui';
import {hexToHsv, hsvToHex, isHex6, type Hsv} from './color-math';

/** Props of {@link ColorPicker}. */
export interface ColorPickerProps {
  /** Current color, `#rrggbb`. */
  readonly value: string;
  /** Called with a valid lowercase `#rrggbb` (hex field, HSV sliders or a swatch). */
  readonly onChange: (hex: string) => void;
  /** Swatches shown under the controls: active palette colors or swatch sets (REQ-CMP-016). */
  readonly swatches?: ReadonlyArray<{
    readonly hex: string;
    readonly name?: string;
  }>;
  /** Heading of the swatch row; defaults to "Swatches". */
  readonly swatchLabel?: string;
  /** Pointer drag or key burst on an HSV slider starts and ends (one undo step, REQ-CMP-017). */
  readonly onGestureStart?: () => void;
  readonly onGestureEnd?: () => void;
  /** Id of the hex field, so a host can focus it. */
  readonly hexId?: string;
}

/**
 * Color picker (REQ-CMP-016): hex text field with validation, hue, saturation and value
 * sliders (native range inputs, so every one is keyboard-operable) and swatches whose names
 * include their hex. An invalid hex is rejected with a message and leaves the color unchanged.
 */
export function ColorPicker({
  value,
  onChange,
  swatches = [],
  swatchLabel,
  onGestureStart,
  onGestureEnd,
  hexId,
}: ColorPickerProps): ReactElement {
  const base = useId();
  const [text, setText] = useState(value);
  const [error, setError] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(
    () => hexToHsv(value) ?? {h: 0, s: 0, v: 0},
  );
  const own = useRef(value);

  // Follow outside changes (undo, swatch, another control) without losing the hue of a grey.
  useEffect(() => {
    if (value === own.current) return;
    own.current = value;
    setText(value);
    setError(false);
    const next = hexToHsv(value);
    if (next) setHsv(next);
  }, [value]);

  const emit = (hex: string) => {
    own.current = hex;
    onChange(hex);
  };
  const commitHsv = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setText(hex);
    setError(false);
    emit(hex);
  };
  const onText = (raw: string) => {
    setText(raw);
    if (isHex6(raw)) {
      setError(false);
      const hex = raw.toLowerCase();
      const next = hexToHsv(hex);
      if (next) setHsv(next);
      emit(hex);
    } else {
      setError(true);
    }
  };

  const items: Swatch[] = swatches.map(s => {
    const hex = s.hex.toLowerCase();
    return {
      id: hex,
      name: s.name ? t('composer.color.swatchName', {name: s.name, hex}) : hex,
      color: hex,
    };
  });
  const gesture = {
    onPointerDown: onGestureStart,
    onPointerUp: onGestureEnd,
    onPointerCancel: onGestureEnd,
    onBlur: onGestureEnd,
  };
  const errorId = `${base}-err`;

  return (
    <div className="cmp-picker">
      <div
        className="cmp-picker__preview"
        style={{backgroundColor: isHex6(value) ? value : undefined}}
        aria-hidden="true"
      />
      <label className="cmp-field">
        <span className="cmp-field__label">{t('composer.color.hex')}</span>
        <input
          id={hexId}
          type="text"
          className="cmp-input csg-mono"
          spellCheck={false}
          autoComplete="off"
          value={text}
          aria-invalid={error || undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={e => onText(e.target.value)}
        />
      </label>
      {error ? (
        <p id={errorId} className="cmp-field__error" role="alert">
          {t('composer.color.hexError')}
        </p>
      ) : null}
      <div className="cmp-picker__sliders">
        <label className="cmp-slider">
          <span>{t('composer.color.hue')}</span>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={Math.round(hsv.h)}
            style={{
              background:
                'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)',
            }}
            onChange={e => commitHsv({...hsv, h: Number(e.target.value)})}
            {...gesture}
          />
        </label>
        <label className="cmp-slider">
          <span>{t('composer.color.saturation')}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(hsv.s * 100)}
            style={{
              background: `linear-gradient(90deg,${hsvToHex({...hsv, s: 0})},${hsvToHex({...hsv, s: 1})})`,
            }}
            onChange={e => commitHsv({...hsv, s: Number(e.target.value) / 100})}
            {...gesture}
          />
        </label>
        <label className="cmp-slider">
          <span>{t('composer.color.value')}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(hsv.v * 100)}
            style={{
              background: `linear-gradient(90deg,#000,${hsvToHex({...hsv, v: 1})})`,
            }}
            onChange={e => commitHsv({...hsv, v: Number(e.target.value) / 100})}
            {...gesture}
          />
        </label>
      </div>
      {items.length > 0 ? (
        <SwatchRow
          label={swatchLabel ?? t('composer.color.swatches')}
          swatches={items}
          value={
            items.some(s => s.id === value.toLowerCase())
              ? value.toLowerCase()
              : null
          }
          onChange={id => {
            setText(id);
            setError(false);
            const next = hexToHsv(id);
            if (next) setHsv(next);
            emit(id);
          }}
        />
      ) : null}
    </div>
  );
}
