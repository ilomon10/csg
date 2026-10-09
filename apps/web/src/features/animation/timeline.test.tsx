// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {axeViolations, focused} from '../../shared/ui/test-utils';
import {Announcer, resetAnnouncer} from '../../shared/ui';
import {Timeline} from './timeline';
import {useTimelinePlayback} from './use-timeline-playback';

afterEach(() => {
  cleanup();
  resetAnnouncer();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Harness({count = 8}: {count?: number}) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  return (
    <>
      <Timeline
        frameCount={count}
        frame={frame}
        playing={playing}
        onFrameChange={setFrame}
        onPlayingChange={setPlaying}
        onLoopChange={() => {}}
        onSpeedChange={() => {}}
      />
      <output data-testid="state">{`${frame}:${playing}`}</output>
    </>
  );
}
const state = () => screen.getByTestId('state').textContent;
const track = () => screen.getByRole('slider', {name: 'Timeline'});

describe('timeline', () => {
  it('AC-UX-040.2: focusing the playhead and pressing Right advances one frame without dragging', async () => {
    render(<Harness />);
    track().focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(state()).toBe('1:false');
    expect(track().getAttribute('aria-valuenow')).toBe('2');
  });

  it('AC-ANM-017.1: Space toggles playback; "," and "." pause and step one frame', async () => {
    render(<Harness />);
    track().focus();
    await userEvent.keyboard(' ');
    expect(state()).toBe('0:false');
    await userEvent.keyboard(' ');
    expect(state()).toBe('0:true');
    await userEvent.keyboard('.');
    expect(state()).toBe('1:false');
    await userEvent.keyboard(',');
    expect(state()).toBe('0:false');
  });

  it('AC-ANM-017.2: arrows step one sampled frame and announce "Frame 3 of 8"; Home and End jump', async () => {
    const {container} = render(
      <>
        <Announcer />
        <Harness />
      </>,
    );
    track().focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(track().getAttribute('aria-valuetext')).toBe('Frame 3 of 8');
    expect(container.textContent).toContain('Frame 3 of 8');
    await userEvent.keyboard('{End}');
    expect(state()).toBe('7:false');
    await userEvent.keyboard('{ArrowRight}');
    expect(state()).toBe('7:false');
    await userEvent.keyboard('{Home}');
    expect(state()).toBe('0:false');
  });

  it('AC-UX-040.2: clicking a frame cell seeks, and moving across cells with the button held scrubs', () => {
    const {container} = render(<Harness />);
    const cell = (i: number) =>
      container.querySelector<HTMLElement>(
        `[data-frame="${i}"]`,
      ) as HTMLElement;
    fireEvent.pointerDown(cell(4), {buttons: 1});
    expect(state()).toBe('4:true');
    expect(focused()).toBe(track());
    fireEvent.pointerEnter(cell(5), {buttons: 1});
    expect(state()).toBe('5:true');
    fireEvent.pointerEnter(cell(6), {buttons: 0});
    expect(state()).toBe('5:true');
  });

  it('AC-UX-040.2: transport buttons step without keyboard focus on the track', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', {name: 'Next frame'}));
    expect(state()).toBe('1:false');
    await userEvent.click(screen.getByRole('button', {name: 'Previous frame'}));
    expect(state()).toBe('0:false');
  });

  it('AC-UX-102.1: the timeline has no axe violations', async () => {
    const {container} = render(<Harness />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('timeline playback', () => {
  it('AC-ANM-018.1: playback cycles the sampled frames at the clip fps (stepped)', () => {
    vi.useFakeTimers();
    const {result} = renderHook(() =>
      useTimelinePlayback({frameCount: 4, fps: 8, initialPlaying: true}),
    );
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current.frame).toBe(2);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current.frame).toBe(0);
  });

  it('AC-ANM-019.1: with reduced motion the preview starts paused on frame 0', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.useFakeTimers();
    const {result} = renderHook(() =>
      useTimelinePlayback({frameCount: 8, fps: 8}),
    );
    expect(result.current.playing).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.frame).toBe(0);
  });

  it('AC-ANM-017.1: a non-looping clip pauses on its last frame', () => {
    vi.useFakeTimers();
    const {result} = renderHook(() =>
      useTimelinePlayback({
        frameCount: 3,
        fps: 10,
        loop: false,
        initialPlaying: true,
      }),
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.frame).toBe(2);
    expect(result.current.playing).toBe(false);
  });
});
