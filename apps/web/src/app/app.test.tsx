import {renderToString} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {App} from './app';

describe('App', () => {
  it('GEN smoke: renders the heading', () => {
    expect(renderToString(<App />)).toContain('Character Sprite Generator');
  });
});
