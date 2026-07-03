import type { MobyClassFactory } from '../MobyClass';
import {
  WaterPlaneMobyClass,
  waterPlaneMobyClassId
} from './2871/WaterPlane';

export const dlMobyClassFactories = new Map<number, MobyClassFactory>([
  [waterPlaneMobyClassId, WaterPlaneMobyClass.create]
]);
