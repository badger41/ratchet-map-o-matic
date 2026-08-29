import type { MobyClassFactory } from '../MobyClass';
import { waterTristripMobyClassId } from '../dl/6576/WaterTristrip';
import { dlMobyClassFactories } from '../dl/dlMobyClasses';

export const uyaMobyClassFactories = new Map<number, MobyClassFactory>(dlMobyClassFactories);
uyaMobyClassFactories.delete(waterTristripMobyClassId);
