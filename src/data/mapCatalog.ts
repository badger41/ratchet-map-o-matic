import { dlMaps } from './dlMaps';
import { gcMaps } from './gcMaps';
import { rc1Maps } from './rc1Maps';
import { uyaMaps } from './uyaMaps';
import type { MapDefinition } from './mapTypes';

export type {
  MapCategory,
  MapDefinition,
  MapSourceKind,
  RatchetGameId
} from './mapTypes';

export const mapCatalog: MapDefinition[] = [
  ...rc1Maps,
  ...gcMaps,
  ...uyaMaps,
  ...dlMaps
];

export const defaultMap = mapCatalog[0];
