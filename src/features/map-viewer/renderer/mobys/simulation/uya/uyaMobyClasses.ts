import type { MobyClassFactory } from '../MobyClass';
import { dlMobyClassFactories } from '../dl/dlMobyClasses';
import {
  createUyaWaterTristripMobyClass,
  waterTristripMobyClassId
} from './6576/WaterTristrip';

export const uyaMobyClassFactories = new Map<number, MobyClassFactory>(dlMobyClassFactories);
uyaMobyClassFactories.set(waterTristripMobyClassId, createUyaWaterTristripMobyClass);
