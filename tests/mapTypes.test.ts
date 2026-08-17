import assert from 'node:assert/strict';
import test from 'node:test';
import { defineWadMaps } from '../src/data/mapTypes.ts';

test('uses a separate WAD index without changing the map level', () => {
  const [museum] = defineWadMaps('GC', [
    { category: 'SP', level: 30, wadIndex: 21, name: 'Insomniac Museum' }
  ]);

  assert.equal(museum.level, 30);
  assert.equal(museum.wadUrl, 'https://box.rac-horizon.com/downloads/vanilla_wads/gc/level21.wad');
});
