import {useLayoutEffect, useState} from 'react';
import type {RefObject} from 'react';

/** Width and height of an element in CSS px, kept current with a `ResizeObserver`. */
export function useElementSize(ref: RefObject<HTMLElement | null>): {
  readonly width: number;
  readonly height: number;
} {
  const [size, setSize] = useState({width: 0, height: 0});
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      setSize(prev =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : {width: rect.width, height: rect.height},
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
