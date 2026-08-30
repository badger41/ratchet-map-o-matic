import type { MobyClassFactory } from '../MobyClass';
import {
  RotatingTieGroupMobyClass,
  rotatingTieGroupMobyClassId
} from './3174/RotatingTieGroup';
import {
  SplineMoverMobyClass,
  splineMoverMobyClassId
} from './5992/SplineMover';
import {
  TieGlowColorMobyClass,
  tieGlowColorMobyClassId
} from './3305/TieGlowColor';
import {
  WaterPlaneMobyClass,
  waterPlaneMobyClassId
} from './2871/WaterPlane';
import {
  createDlWaterTristripMobyClass,
  waterTristripMobyClassId
} from './6576/WaterTristrip';

export const dlMobyClassFactories = new Map<number, MobyClassFactory>([
  [splineMoverMobyClassId, SplineMoverMobyClass.create],
  [rotatingTieGroupMobyClassId, RotatingTieGroupMobyClass.create],
  [tieGlowColorMobyClassId, TieGlowColorMobyClass.create],
  [waterPlaneMobyClassId, WaterPlaneMobyClass.create],
  [waterTristripMobyClassId, createDlWaterTristripMobyClass]
]);
