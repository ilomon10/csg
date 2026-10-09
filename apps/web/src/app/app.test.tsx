// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {beforeAll, afterEach, describe, expect, it} from 'vitest';
import {App} from './app';
import {FramedNotice, isFramed} from './shell';
import {warmViews} from './shell/warm-views';

afterEach(cleanup);

beforeAll(async () => {
  await warmViews();
}, 60_000);

describe('App', () => {
  it('GEN smoke: renders the heading', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Character Sprite Generator',
      }),
    ).toBeTruthy();
  });

  it('AC-GEN-012.1: a framed editor renders only an "Open in a new tab" link', () => {
    expect(isFramed({self: {}, top: {}} as unknown as Window)).toBe(true);
    const win = {self: 1} as unknown as Window;
    Object.defineProperty(win, 'top', {
      get() {
        throw new Error('cross-origin');
      },
    });
    expect(isFramed(win)).toBe(true);
    render(<FramedNotice href="https://example.test/app/#home" />);
    const link = screen.getByRole('link', {name: 'Open in a new tab'});
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('AC-GEN-012.3: a top-level window is not framed', () => {
    expect(isFramed(window)).toBe(false);
  });
});
