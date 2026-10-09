import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {expect, test} from '@playwright/test';
import type {Download, Page} from '@playwright/test';

/** The test host page mounts the real `ExportDialog` (see src/app/e2e-host/export-host.tsx). */
const HOST = '/export-host.html';

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Minimal ZIP reader over the central directory (stored and deflate entries). */
function readZip(buf: Buffer): ZipEntry[] {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    out.push({
      name,
      data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function exportOnce(
  page: Page,
): Promise<{download: Download; bytes: Buffer}> {
  await page.getByRole('button', {name: 'Export', exact: true}).click();
  const start = page.getByTestId('export-start');
  await expect(start).toBeEnabled({timeout: 30_000});
  const downloadPromise = page.waitForEvent('download');
  await start.click();
  const download = await downloadPromise;
  const path = await download.path();
  await expect(page.getByTestId('export-done')).toBeVisible({timeout: 120_000});
  return {download, bytes: readFileSync(path)};
}

test.describe('export dialog', () => {
  test('AC-EXP-017.1, AC-EXP-018.1, AC-GEN-003.1: exports one ZIP with sheet, Aseprite JSON, manifest and CREDITS.txt, byte-identical after a reload, with no network use', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const requests: Array<{url: string; method: string; body: string | null}> =
      [];
    page.on('request', r =>
      requests.push({url: r.url(), method: r.method(), body: r.postData()}),
    );
    await page.goto(HOST);
    const first = await exportOnce(page);
    expect(first.download.suggestedFilename()).toMatch(/\.zip$/);
    const entries = readZip(first.bytes);
    const names = entries.map(e => e.name);
    expect(names.some(n => n.endsWith('.png'))).toBe(true);
    expect(
      names.some(n => n.endsWith('.json') && !n.endsWith('manifest.json')),
    ).toBe(true);
    expect(names.some(n => n.endsWith('.manifest.json'))).toBe(true);
    expect(names).toContain('CREDITS.txt');
    const png = entries.find(e => e.name.endsWith('.png'));
    expect([...(png?.data.subarray(0, 8) ?? [])]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    await page.screenshot({path: testInfo.outputPath('export-done.png')});
    await testInfo.attach('export-done', {
      path: testInfo.outputPath('export-done.png'),
      contentType: 'image/png',
    });

    // AC-GEN-003.1: nothing but same-origin GETs, and no request body.
    const origin = new URL(page.url()).origin;
    for (const r of requests) {
      if (r.url.startsWith('blob:') || r.url.startsWith('data:')) continue;
      expect(r.url.startsWith(origin), r.url).toBe(true);
      expect(r.method, r.url).toBe('GET');
      expect(r.body, r.url).toBeNull();
    }

    // Same document after a reload: identical bytes.
    await page.reload();
    const second = await exportOnce(page);
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    expect(sha(second.bytes)).toBe(sha(first.bytes));
    const again = readZip(second.bytes);
    for (const e of entries) {
      const other = again.find(x => x.name === e.name);
      expect(other?.data.equals(e.data), e.name).toBe(true);
    }
  });

  test('AC-EXP-024.1: cancel stops the export within 250 ms and offers no download', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.goto(`${HOST}?frames=48`);
    await page.getByRole('button', {name: 'Export', exact: true}).click();
    const start = page.getByTestId('export-start');
    await expect(start).toBeEnabled({timeout: 30_000});
    await start.click();
    await expect(page.getByTestId('export-cancel')).toBeVisible();
    await expect(page.getByTestId('export-progress-text')).toContainText(
      /Rendering frames [1-9]/,
      {timeout: 120_000},
    );
    await page.screenshot({path: testInfo.outputPath('export-progress.png')});
    const ms = await page.evaluate(
      () =>
        new Promise<number>(resolve => {
          const dialog = document.querySelector(
            '[data-testid="export-dialog"]',
          );
          const button = document.querySelector<HTMLButtonElement>(
            '[data-testid="export-cancel"]',
          );
          if (!dialog || !button)
            throw new Error('export dialog is not running');
          const t0 = performance.now();
          const obs = new MutationObserver(() => {
            if (dialog.getAttribute('data-stage') === 'cancelled') {
              obs.disconnect();
              resolve(performance.now() - t0);
            }
          });
          obs.observe(dialog, {
            attributes: true,
            attributeFilter: ['data-stage'],
          });
          button.click();
        }),
    );
    expect(ms).toBeLessThanOrEqual(250);
    await expect(page.getByTestId('export-cancelled')).toBeVisible();
    await page.waitForTimeout(500);
    expect(downloads).toBe(0);
  });
});
