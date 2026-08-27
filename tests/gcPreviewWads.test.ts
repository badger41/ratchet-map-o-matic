import assert from 'node:assert/strict';
import test from 'node:test';
import { GcPreviewWadsPlugin } from '../vite/previewWads/GcPreviewWadsPlugin.ts';
import { UyaPreviewWadsPlugin } from '../vite/previewWads/UyaPreviewWadsPlugin.ts';

test('serves only WADs present in the GC preview ISO', () => {
  let middleware: ((request: { url: string; method: string }, response: HeadResponse, next: () => void) => void) | undefined;
  new GcPreviewWadsPlugin().configureServer({
    middlewares: {
      use(_path: string, handler: typeof middleware) {
        middleware = handler;
      }
    }
  } as never);

  assert.ok(middleware);
  const headers = new Map<string, number | string>();
  let ended = false;
  middleware(
    { url: '/level24.wad', method: 'HEAD' },
    {
      setHeader(name, value) { headers.set(name, value); },
      end() { ended = true; }
    },
    () => assert.fail('Known preview WAD fell through middleware')
  );
  assert.equal(headers.get('Content-Length'), 8298496);
  assert.equal(ended, true);

  let fellThrough = false;
  middleware(
    { url: '/level27.wad', method: 'HEAD' },
    { setHeader() {}, end() {} },
    () => { fellThrough = true; }
  );
  assert.equal(fellThrough, true);
});

test('normalizes the shifted GC preview header and final sector', () => {
  const preview = new Uint8Array(0x701);
  const view = new DataView(preview.buffer);
  view.setUint32(0, 0x68, true);
  for (let offset = 0x0c; offset < 0x5c; offset += 4) {
    view.setUint32(offset, offset, true);
  }

  const normalized = new GcPreviewWadsPlugin().normalize(preview);
  assert.equal(normalized.byteLength, 0x800);
  assert.equal(normalized.readUInt32LE(0), 0x60);
  assert.equal(normalized.readUInt32LE(0x0c), 0);
  assert.equal(normalized.readUInt32LE(0x10), 0x0c);
  assert.equal(normalized.readUInt32LE(0x5c), 0x58);
});

test('serves and sector-pads UYA preview WADs', () => {
  let middleware: ((request: { url: string; method: string }, response: HeadResponse, next: () => void) => void) | undefined;
  const plugin = new UyaPreviewWadsPlugin();
  plugin.configureServer({
    middlewares: {
      use(_path: string, handler: typeof middleware) {
        middleware = handler;
      }
    }
  } as never);

  assert.ok(middleware);
  const headers = new Map<string, number | string>();
  middleware(
    { url: '/level33.wad', method: 'HEAD' },
    { setHeader(name, value) { headers.set(name, value); }, end() {} },
    () => assert.fail('Known UYA preview WAD fell through middleware')
  );
  assert.equal(headers.get('Content-Length'), 12064768);

  const preview = new Uint8Array(0x601);
  new DataView(preview.buffer).setUint32(0, 0x60, true);
  const normalized = plugin.normalize(preview);
  assert.equal(normalized.byteLength, 0x800);
  assert.equal(normalized.subarray(0, preview.byteLength).compare(preview), 0);
});

interface HeadResponse {
  setHeader(name: string, value: number | string): void;
  end(): void;
}
