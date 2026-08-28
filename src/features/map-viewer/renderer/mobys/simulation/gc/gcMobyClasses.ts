import type { MobyClassFactory } from '../MobyClass';
import { dlMobyClassFactories } from '../dl/dlMobyClasses';
import {
  GcTieGlowColorMobyClass,
  gcTieGlowColorMobyClassId
} from './3305/TieGlowColor';

export const gcMobyClassFactories = new Map<number, MobyClassFactory>(dlMobyClassFactories);
gcMobyClassFactories.set(gcTieGlowColorMobyClassId, GcTieGlowColorMobyClass.create);
