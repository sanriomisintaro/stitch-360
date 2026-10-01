/**
 * Minimal dependency-free ZIP writer using the "store" method (no compression).
 * Intended only for reproducible research artifact bundles generated in-browser.
 */

const encoder = new TextEncoder();

function crc32Table() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crc32Table();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(view, offset, value) { view.setUint16(offset, value, true); }
function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

function concat(parts) {
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(new Uint8Array(p.buffer ?? p, p.byteOffset ?? 0, p.byteLength), pos); pos += p.byteLength; }
  return out;
}

export async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Create a ZIP Blob. entries: [{name, data}], where data is string, Blob,
 * ArrayBuffer, or Uint8Array. Filenames are UTF-8 and paths use '/'.
 */
export async function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const normalized = [];

  for (const entry of entries) {
    const name = String(entry.name).replaceAll('\\', '/').replace(/^\/+/, '');
    if (!name || name.includes('..')) throw new Error(`Unsafe ZIP entry path: ${entry.name}`);
    const nameBytes = encoder.encode(name);
    let dataBytes;
    if (typeof entry.data === 'string') dataBytes = encoder.encode(entry.data);
    else if (entry.data instanceof Blob) dataBytes = await blobToBytes(entry.data);
    else if (entry.data instanceof Uint8Array) dataBytes = entry.data;
    else if (entry.data instanceof ArrayBuffer) dataBytes = new Uint8Array(entry.data);
    else throw new TypeError(`Unsupported ZIP entry data for ${name}`);
    normalized.push({ nameBytes, dataBytes, crc: crc32(dataBytes), localOffset });

    const header = new Uint8Array(30);
    const v = new DataView(header.buffer);
    u32(v, 0, 0x04034b50); // local header signature
    u16(v, 4, 20);         // version needed
    u16(v, 6, 0x0800);     // UTF-8 names
    u16(v, 8, 0);          // store
    u16(v, 10, 0); u16(v, 12, 0); // deterministic DOS time/date
    u32(v, 14, normalized.at(-1).crc);
    u32(v, 18, dataBytes.byteLength);
    u32(v, 22, dataBytes.byteLength);
    u16(v, 26, nameBytes.byteLength);
    u16(v, 28, 0);
    localParts.push(header, nameBytes, dataBytes);
    localOffset += header.byteLength + nameBytes.byteLength + dataBytes.byteLength;
  }

  let centralSize = 0;
  for (const item of normalized) {
    const header = new Uint8Array(46);
    const v = new DataView(header.buffer);
    u32(v, 0, 0x02014b50);
    u16(v, 4, 20); u16(v, 6, 20);
    u16(v, 8, 0x0800); u16(v, 10, 0);
    u16(v, 12, 0); u16(v, 14, 0);
    u32(v, 16, item.crc);
    u32(v, 20, item.dataBytes.byteLength);
    u32(v, 24, item.dataBytes.byteLength);
    u16(v, 28, item.nameBytes.byteLength);
    u16(v, 30, 0); u16(v, 32, 0); u16(v, 34, 0); u16(v, 36, 0);
    u32(v, 38, 0); u32(v, 42, item.localOffset);
    centralParts.push(header, item.nameBytes);
    centralSize += header.byteLength + item.nameBytes.byteLength;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 4, 0); u16(ev, 6, 0);
  u16(ev, 8, normalized.length); u16(ev, 10, normalized.length);
  u32(ev, 12, centralSize);
  u32(ev, 16, localOffset);
  u16(ev, 20, 0);

  const all = concat([...localParts, ...centralParts, eocd]);
  return new Blob([all], { type: 'application/zip' });
}
