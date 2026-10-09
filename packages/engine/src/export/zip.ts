/**
 * Deterministic ZIP writer (REQ-EXP-018): entries sorted by path (code-unit order), DOS time
 * 1980-01-01 00:00:00, no extra fields, no data descriptors, UTF-8 names. `.png` entries are
 * stored (already compressed); others use raw deflate at a fixed level.
 */
import {deflateSync} from 'fflate';
import {EXPORT_DEFLATE_LEVEL, concatBytes, crc32} from './png';

/** DOS date of 1980-01-01 (`(year-1980) << 9 | month << 5 | day`). */
const DOS_DATE = (1 << 5) | 1;
const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

const encoder = new TextEncoder();

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Packs files into a ZIP archive.
 *
 * @param files Entries; names are relative, `/`-separated, unique and without `.`/`..` parts.
 * @returns The ZIP bytes. The input order does not matter.
 * @throws Error on an invalid or duplicate name, or when a ZIP64 feature would be needed.
 */
export function writeZip(
  files: readonly {name: string; bytes: Uint8Array}[],
): Uint8Array {
  if (files.length > MAX_ENTRIES) throw new Error('writeZip: too many entries');
  const sorted = [...files].sort((a, b) => compareNames(a.name, b.name));
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let prev: string | null = null;
  for (const file of sorted) {
    const {name} = file;
    if (
      name === '' ||
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').some(s => s === '' || s === '.' || s === '..')
    ) {
      throw new Error(`writeZip: invalid entry name "${name}"`);
    }
    if (name === prev) throw new Error(`writeZip: duplicate entry "${name}"`);
    prev = name;
    const nameBytes = encoder.encode(name);
    const stored = name.endsWith('.png') || file.bytes.length === 0;
    const data = stored
      ? file.bytes
      : deflateSync(file.bytes, {level: EXPORT_DEFLATE_LEVEL});
    if (data.length > MAX_BYTES || file.bytes.length > MAX_BYTES) {
      throw new Error('writeZip: entry too large for a ZIP without ZIP64');
    }
    const method = stored ? 0 : 8;
    const crc = crc32(file.bytes);

    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true); // DOS time 00:00:00
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, file.bytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // no extra field
    lh.set(nameBytes, 30);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by (MS-DOS)
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, file.bytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    // extra, comment, disk, internal and external attributes stay 0
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);

    local.push(lh, data);
    central.push(ch);
    offset += lh.length + data.length;
    if (offset > MAX_BYTES) throw new Error('writeZip: archive too large');
  }
  const centralBytes = concatBytes(central);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, sorted.length, true);
  ev.setUint16(10, sorted.length, true);
  ev.setUint32(12, centralBytes.length, true);
  ev.setUint32(16, offset, true);
  return concatBytes([...local, centralBytes, end]);
}
