import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import {
  extractDlCustomMapWad,
  wrapDlCoreLevelWad
} from '../src/services/customMaps/dlCustomMapZip.ts';
import { parseHorizonCustomMapIndex } from '../src/services/customMaps/horizonMaps.ts';

test('builds DL Horizon entries and extracts their single WAD', () => {
  const maps = parseHorizonCustomMapIndex('DL', 'aquadome|Aquatos Aquadome|1\n');
  assert.equal(maps[0].wadUrl, 'https://box.rac-horizon.com/downloads/maps/dl/aquadome.zip');
  assert.equal(maps[0].customMapRouteId, 'aquadome');
  assert.equal(
    parseHorizonCustomMapIndex('UYA', 'Astro Turf|Astro Turf|1\n')[0].wadUrl,
    'https://box.rac-horizon.com/downloads/maps/uya/Astro%20Turf.ntsc.zip'
  );

  const wad = strToU8('deadlocked wad');
  const zip = zipSync({
    'dl/aquadome.wad': wad,
    'dl/aquadome.version': strToU8('1')
  });
  assert.deepEqual(extractDlCustomMapWad(zip), wad);

  const wrapped = wrapDlCoreLevelWad(wad, 6);
  const header = new DataView(wrapped.buffer);
  assert.equal(header.getInt32(0, true), 0xc68);
  assert.equal(header.getInt32(8, true), 6);
  assert.equal(header.getInt32(0x18, true), 2);
  assert.deepEqual(wrapped.subarray(0x1000, 0x1000 + wad.byteLength), wad);
});
