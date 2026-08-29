import type { MobyClassFactory } from '../../MobyClass';
import {
  createWaterTristripMobyClass,
  waterTristripMobyClassId
} from '../../WaterTristrip';
import { parseWaterTristripPvar } from './WaterTristripData';

export { waterTristripMobyClassId };

export const createDlWaterTristripMobyClass: MobyClassFactory = (context) =>
  createWaterTristripMobyClass(context, parseWaterTristripPvar);
