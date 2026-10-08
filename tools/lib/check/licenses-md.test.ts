import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {writeTestPack} from './check-fixtures.js';
import {syncLicenses} from './licenses-io.js';
import {runAssetCheck} from './run.js';
import {
  applyLicensesSection,
  extractLicensesSection,
  mdText,
  renderLicensesSection,
  SECTION_BEGIN,
  SECTION_END,
} from './licenses-md.js';

const pack = {
  packId: 'p1',
  name: 'Pack One',
  license: {
    license: 'CC0-1.0',
    author: 'Quaternius',
    sourceUrl: 'https://q.example',
  },
  parts: [{id: 'a'}],
  clips: [],
};

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'assets-lic-'));
});
afterEach(() => rmSync(root, {recursive: true, force: true}));

describe('AC-AST-018.1 generated license section', () => {
  it('renders deterministically, sorted by pack id, with overrides', () => {
    const second = {
      ...pack,
      packId: 'a0',
      name: 'Alpha',
      parts: [
        {
          id: 'z',
          license: {
            license: 'CC-BY-4.0',
            author: 'Y',
            sourceUrl: 'https://y.example',
          },
        },
      ],
    };
    const out = renderLicensesSection([pack, second]);
    expect(out).toBe(renderLicensesSection([second, pack]));
    expect(out.indexOf('Alpha')).toBeLessThan(out.indexOf('Pack One'));
    expect(out).toContain('Override, part `z`: Y, CC-BY-4.0');
    expect(out.startsWith(SECTION_BEGIN)).toBe(true);
    expect(out.endsWith(SECTION_END)).toBe(true);
  });

  it('sanitizes control characters and angle brackets', () => {
    expect(mdText('a\nb<script>`x`')).toBe('a bscriptx');
  });

  it('replaces only the marked block and keeps the rest', () => {
    const doc = `intro\n\n${renderLicensesSection([])}\n\n## Tail\n`;
    const next = applyLicensesSection(doc, renderLicensesSection([pack]));
    expect(next.startsWith('intro')).toBe(true);
    expect(next.endsWith('## Tail\n')).toBe(true);
    expect(extractLicensesSection(next)).toContain('Pack One');
  });

  it('inserts before ## Palettes when no markers exist', () => {
    const next = applyLicensesSection(
      '# T\n\n## Palettes\nx\n',
      renderLicensesSection([pack]),
    );
    expect(next.indexOf(SECTION_BEGIN)).toBeLessThan(
      next.indexOf('## Palettes'),
    );
  });

  it('--check reports a pack added without regenerating, with a diff; write fixes it', async () => {
    const {repo} = await writeTestPack(root, 'p1', [{id: 'shirt'}]);
    const file = join(root, 'ASSETS_LICENSE.md');
    writeFileSync(file, `# L\n\n${renderLicensesSection([])}\n`);
    const check = await syncLicenses(repo.packsDir, file, false);
    expect(check.changed).toBe(true);
    expect(check.diff.join('\n')).toContain('Test pack');
    expect(readFileSync(file, 'utf8')).not.toContain('Test pack');
    const report = await runAssetCheck({...repo, licenseFile: file});
    expect(report.issues.map(i => i.code)).toContain('AST_LICENSES_STALE');
    expect((await syncLicenses(repo.packsDir, file, true)).changed).toBe(true);
    expect((await syncLicenses(repo.packsDir, file, true)).changed).toBe(false);
    expect(readFileSync(file, 'utf8')).toContain('Test pack');
    const after = await runAssetCheck({...repo, licenseFile: file});
    expect(after.issues.filter(i => i.code === 'AST_LICENSES_STALE')).toEqual(
      [],
    );
  });

  it('no packs and no markers leaves the file untouched', async () => {
    const file = join(root, 'ASSETS_LICENSE.md');
    writeFileSync(file, '# L\n');
    expect((await syncLicenses(join(root, 'none'), file, true)).changed).toBe(
      false,
    );
    expect(readFileSync(file, 'utf8')).toBe('# L\n');
  });
});
