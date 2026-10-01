import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, createStoredZip } from '../docs/core/zip-store.js';

test('CRC32 known vector', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xcbf43926);
});

test('stored ZIP has local and EOCD signatures', async () => {
  const blob = await createStoredZip([{name:'hello.txt', data:'hello'}]);
  const b = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...b.slice(0,4)], [0x50,0x4b,0x03,0x04]);
  assert.ok(b.length > 30);
  const n=b.length;
  assert.deepEqual([...b.slice(n-22,n-18)], [0x50,0x4b,0x05,0x06]);
});
