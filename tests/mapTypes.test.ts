import assert from 'node:assert/strict';
import test from 'node:test';
import { rc1Maps } from '../src/data/rc1Maps.ts';
import { defineWadMaps } from '../src/data/mapTypes.ts';

test('uses a separate WAD index without changing the map level', () => {
  const [museum] = defineWadMaps('GC', [
    { category: 'SP', level: 30, wadIndex: 21, name: 'Insomniac Museum' }
  ]);

  assert.equal(museum.level, 30);
  assert.equal(museum.wadUrl, 'https://box.rac-horizon.com/downloads/vanilla_wads/gc/level21.wad');
});

test('routes RC1 WADs through the Horizon vanilla WAD endpoint', () => {
  const [novalis] = defineWadMaps('RC1', [
    { category: 'SP', level: 1, name: 'Novalis' }
  ]);

  assert.equal(novalis.wadUrl, 'https://box.rac-horizon.com/downloads/vanilla_wads/rc1/level01.wad');
});

test('lists every RC1 level WAD slot', () => {
  assert.deepEqual(rc1Maps.map(map => map.level), Array.from({ length: 19 }, (_, level) => level));
});
