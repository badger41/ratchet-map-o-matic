import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findDlMissionGameplayEntries,
  mobyMissionVisible
} from '../src/services/mapLoading/dlMobyMissions.ts';

test('finds packaged DL missions and keeps core mobys visible', () => {
  assert.deepEqual(findDlMissionGameplayEntries([
    { path: 'missions/mission_12/gameplay.bin' },
    { path: 'missions/mission_2/moby/1234/moby.gltf' },
    { path: 'missions\\mission_2\\gameplay.bin' },
    { path: 'gameplay/gameplay_core.bin' }
  ]), [
    { missionIndex: 2, path: 'missions\\mission_2\\gameplay.bin' },
    { missionIndex: 12, path: 'missions/mission_12/gameplay.bin' }
  ]);

  assert.equal(mobyMissionVisible(-1, null), true);
  assert.equal(mobyMissionVisible(-1, 2), true);
  assert.equal(mobyMissionVisible(2, 2), true);
  assert.equal(mobyMissionVisible(12, 2), false);
  assert.equal(mobyMissionVisible(2, null), false);
});
