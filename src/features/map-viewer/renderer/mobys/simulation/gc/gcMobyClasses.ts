import type { MobyClassFactory } from '../MobyClass';
import { dlMobyClassFactories } from '../dl/dlMobyClasses';
import { waterTristripMobyClassId } from '../WaterTristrip';
import {
  GcTieGlowColorMobyClass,
  gcTieGlowColorMobyClassId
} from './3305/TieGlowColor';

export const gcMobyClassFactories = new Map<number, MobyClassFactory>(dlMobyClassFactories);
gcMobyClassFactories.delete(waterTristripMobyClassId);
gcMobyClassFactories.set(gcTieGlowColorMobyClassId, GcTieGlowColorMobyClass.create);
