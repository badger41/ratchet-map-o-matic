import type { MobyClassFactory } from '../../MobyClass';
import {
  createWaterTristripMobyClass,
  waterTristripMobyClassId
} from '../../WaterTristrip';
import { parseUyaWaterTristripPvar } from './WaterTristripData';

export { waterTristripMobyClassId };

export const createUyaWaterTristripMobyClass: MobyClassFactory = (context) =>
  createWaterTristripMobyClass(context, parseUyaWaterTristripPvar);
