import {describe, expect, it, vi} from 'vitest';
import {handleExportRequest} from './export.worker';
import type {ExportWorkerPost} from './export.worker';
import {
  makeContext,
  makeFrames,
  renderSettings,
  settings,
} from './test-fixtures';
import {readZip} from './test-helpers';
import {createExportWorkerClient} from './worker-client';
import {readExportReply, readExportRequest} from './worker-protocol';

const CLIPS = [{label: 'idle', frames: 2}];

function request(over: Record<string, unknown> = {}) {
  const render = renderSettings(CLIPS, 2, 32);
  return {
    type: 'export',
    id: 1,
    frames: makeFrames(CLIPS, 2, 4, 4),
    settings: settings(),
    context: makeContext(render),
    ...over,
  };
}

/** In-process worker: runs the real handler; `messages` lets a test inject replies. */
class FakeWorker extends EventTarget {
  terminated = false;
  silent = false;
  postMessage(data: unknown): void {
    if (this.silent) return;
    const posts: ExportWorkerPost[] = [];
    void handleExportRequest(structuredClone(data), m => posts.push(m)).then(
      () => {
        for (const m of posts) {
          if (!this.terminated) this.emit(m.reply);
        }
      },
    );
  }
  emit(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', {data}));
  }
  terminate(): void {
    this.terminated = true;
  }
}

const start = () => {
  const fake = new FakeWorker();
  const client = createExportWorkerClient({
    createWorker: () => fake as unknown as Worker,
    timeoutMs: 200,
  });
  return {fake, client};
};

describe('export worker requests (REQ-GEN-016)', () => {
  it('REQ-GEN-016: a valid request parses', () => {
    expect(readExportRequest(request()).ok).toBe(true);
  });

  it('REQ-GEN-016: malformed requests are rejected with a reason', () => {
    const bad: unknown[] = [
      null,
      'x',
      {},
      request({id: -1}),
      request({id: 1.5}),
      request({type: 'other'}),
      request({frames: []}),
      request({frames: 'x'}),
      request({frames: [{clipId: 'idle'}]}),
      request({
        frames: [
          {...makeFrames(CLIPS, 1, 4, 4)[0], pixels: new Uint8ClampedArray(3)},
        ],
      }),
      request({
        frames: [{...makeFrames(CLIPS, 1, 4, 4)[0], pixels: [1, 2, 3]}],
      }),
      request({frames: [{...makeFrames(CLIPS, 1, 4, 4)[0], width: 99999}]}),
      request({context: null}),
      request({
        context: {
          ...makeContext(renderSettings(CLIPS, 2, 32)),
          projectSha256: 'zz',
        },
      }),
      request({
        context: {
          ...makeContext(renderSettings(CLIPS, 2, 32)),
          credits: [{ref: 'x', kind: 'part', license: {}}],
        },
      }),
    ];
    for (const b of bad) expect(readExportRequest(b).ok).toBe(false);
  });

  it('REQ-GEN-016: the handler never throws and answers an error reply', async () => {
    const posts: ExportWorkerPost[] = [];
    await handleExportRequest({type: 'export', id: 7}, m => posts.push(m));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.reply).toMatchObject({type: 'error', id: 7});
  });

  it('invalid export settings come back as EXP_INVALID_SETTINGS', async () => {
    const posts: ExportWorkerPost[] = [];
    await handleExportRequest(request({settings: {scales: []}}), m =>
      posts.push(m),
    );
    expect(posts[0]?.reply).toMatchObject({
      type: 'error',
      code: 'EXP_INVALID_SETTINGS',
    });
  });

  it('AC-EXP-023.1: progress replies precede one done reply carrying the ZIP', async () => {
    const posts: ExportWorkerPost[] = [];
    await handleExportRequest(request(), m => posts.push(m));
    const types = posts.map(p => p.reply.type);
    expect(types[types.length - 1]).toBe('done');
    expect(types.filter(t => t === 'done')).toHaveLength(1);
    expect(types.slice(0, -1).every(t => t === 'progress')).toBe(true);
  });
});

describe('export worker replies (REQ-GEN-016)', () => {
  it('AC-GEN-016.1: unknown or malformed replies read as null', () => {
    for (const bad of [
      null,
      {},
      {type: 'done'},
      {type: 'progress', id: 1, phase: 'x', done: 0, total: 1},
      {type: 'progress', id: 1, phase: 'encode', done: -1, total: 1},
      {
        type: 'done',
        id: 1,
        zipName: 'a.zip',
        zip: [1],
        files: [],
        warnings: [],
      },
      {
        type: 'done',
        id: 1,
        zipName: 'a.zip',
        zip: new Uint8Array(1),
        files: [],
        warnings: [{code: 'NOPE'}],
      },
      {type: 'whatever', id: 1},
    ]) {
      expect(readExportReply(bad)).toBeNull();
    }
  });
});

describe('export worker client', () => {
  it('AC-EXP-017.1: runs an export through the worker and returns the ZIP', async () => {
    const {client} = start();
    const r = request();
    const progress: string[] = [];
    const res = await client.run(r.frames, r.settings, r.context, {
      onProgress: p => progress.push(p.phase),
    });
    if (!res.ok) throw new Error(res.error.message);
    expect(res.value.zipName).toBe('sir-knight-2-blue.zip');
    expect(Object.keys(readZip(res.value.zip))).toContain('CREDITS.txt');
    expect(progress).toContain('encode');
    expect(progress).toContain('package');
  });

  it('AC-EXP-024.1: aborting terminates the worker and rejects with EXP_CANCELLED', async () => {
    const {fake, client} = start();
    fake.silent = true;
    const r = request();
    const ctl = new AbortController();
    const p = client.run(r.frames, r.settings, r.context, {signal: ctl.signal});
    ctl.abort();
    await expect(p).rejects.toMatchObject({code: 'EXP_CANCELLED'});
    expect(fake.terminated).toBe(true);
  });

  it('AC-EXP-024.1: an already aborted signal rejects without a worker call', async () => {
    const {fake, client} = start();
    const r = request();
    const ctl = new AbortController();
    ctl.abort();
    await expect(
      client.run(r.frames, r.settings, r.context, {signal: ctl.signal}),
    ).rejects.toMatchObject({code: 'EXP_CANCELLED'});
    expect(fake.terminated).toBe(false);
  });

  it('AC-GEN-016.1/.2: invalid replies are ignored, and a silent worker times out', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const {fake, client} = start();
    fake.silent = true;
    const r = request();
    const p = client.run(r.frames, r.settings, r.context);
    fake.emit({type: 'done', id: 1, zip: 'not bytes'});
    fake.emit({type: 'progress', id: 99, phase: 'encode', done: 1, total: 1});
    const res = await p;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('EXP_WORKER_FAILED');
      expect(res.error.message).toContain('timed out');
    }
    expect(fake.terminated).toBe(true);
  });

  it('AC-GEN-016.3: a worker error event fails the run instead of hanging', async () => {
    const {fake, client} = start();
    fake.silent = true;
    const r = request();
    const p = client.run(r.frames, r.settings, r.context);
    fake.dispatchEvent(new Event('error'));
    const res = await p;
    expect(res.ok).toBe(false);
  });

  it('an error reply from the worker becomes a failed result with its code', async () => {
    const {client} = start();
    const r = request();
    const res = await client.run(r.frames, {scales: []}, r.context);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('EXP_INVALID_SETTINGS');
  });

  it('REQ-GEN-014: the client never builds a Worker from a URL itself', async () => {
    const created = vi.fn(() => {
      throw new Error('blocked');
    });
    const client = createExportWorkerClient({createWorker: created});
    const r = request();
    const res = await client.run(r.frames, r.settings, r.context);
    expect(created).toHaveBeenCalledOnce();
    expect(res.ok).toBe(false);
  });
});
