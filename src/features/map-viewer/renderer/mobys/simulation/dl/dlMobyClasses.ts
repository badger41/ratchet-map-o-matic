import type { MobyClassFactory } from '../MobyClass';
import {
  RotatingTieGroupMobyClass,
  rotatingTieGroupMobyClassId
} from './3174/RotatingTieGroup';
import {
  TieGlowColorMobyClass,
  tieGlowColorMobyClassId
} from './3305/TieGlowColor';
import {
  WaterPlaneMobyClass,
  waterPlaneMobyClassId
} from './2871/WaterPlane';

export const dlMobyClassFactories = new Map<number, MobyClassFactory>([
  [rotatingTieGroupMobyClassId, RotatingTieGroupMobyClass.create],
  [tieGlowColorMobyClassId, TieGlowColorMobyClass.create],
  [waterPlaneMobyClassId, WaterPlaneMobyClass.create]
]);
